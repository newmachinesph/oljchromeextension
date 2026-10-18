/**
 * Pure rate parsing. No DOM, no chrome APIs - just string in, structure out.
 *
 * Calibrated against 255 live listings (189 distinct rate strings). The site has
 * no house style: "4USD/hour", "PHP 20-25K", "$1,000-$1,500 p/m (paid every two
 * weeks)", "$150 AUD fixed price", "Starts at 30k PHP+ per month".
 *
 * This module decides what the extension is allowed to hide, so it reports what
 * it could not read rather than guessing. Two flags exist purely to stop the
 * caller assuming too much: `ambiguousPeriod` and `pieceRate`.
 *
 * IMPORTANT: only ever feed this a listing's rate field, never the whole card.
 * "PHP" is also a programming language here.
 */

import { buildPatterns, DEFAULT_VOCABULARY } from './vocabulary.js';

const NUMBER_PATTERN =
  /(\d{1,3}(?:[,  ]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(k\b)?/gi;

/**
 * Separators that make two adjacent numbers one range. A currency marker may
 * sit on either side: "USD 450 - USD 500", "30,000 php to 70,000 php".
 *
 * Built from the vocabulary, so a currency word added in settings is also
 * recognised between the two halves of a range. Memoised alongside it.
 */
const separators = new Map();

function rangeSeparator(patterns) {
  const cached = separators.get(patterns.token);
  if (cached) return cached;

  const built = new RegExp(
    `^\\s*${patterns.token}?\\s*(?:-|–|—|to|~)\\s*${patterns.token}?\\s*$`,
    'i',
  );
  separators.set(patterns.token, built);
  return built;
}

/**
 * Explicit currency words, checked before the bare "$" symbol because "$" is
 * ambiguous on this site - "$10 AUD/Hour" is not US dollars.
 */
/**
 * The one currency this string names, when it names exactly one.
 *
 * Two words means genuine ambiguity ("PHP 50,000 (approx USD 900)"), and
 * guessing between them is worse than reading the number's own neighbourhood.
 */
function soleCurrencyWord(text, patterns) {
  const found = patterns.words.filter(([, pattern]) => pattern.test(text));
  return found.length === 1 ? found[0][0] : null;
}

/**
 * Units that make a rate a salary. Anything else after "per" or "/" means the
 * pay is per unit of work, not per unit of time.
 *
 * Single letters are here because "p/m" and "/h" are common shorthand. "minute"
 * deliberately is not: "$3 per minute of finished video" is piecework.
 */
const TIME_UNIT =
  /^(?:h|hr|hrs|hour|hours|hourly|d|day|days|daily|w|wk|wks|week|weeks|weekly|m|mo|mos|mon|mth|mnth|month|months|monthly|y|yr|yrs|year|years|yearly|annum|annually)$/i;

/** Phrases that mark piecework outright, with no "per" to inspect. */
const EXPLICIT_TASK_RATE =
  /fixed\s*price|\bproject\b|\bmilestone\b|one[\s-]?time|commission\s*only/i;

/**
 * "per <something>" / "/<something>". The \b before "per" matters - without it
 * this fires on the "per" inside "experience", which appears constantly.
 */
const PER_UNIT = /(?:\bper\b|\/)\s*(?:\d[\d,]*\s*)?([a-z]+)/gi;

/**
 * How far past the amount to look for its pay period. Tuned against the corpus:
 * wide enough for "usd fixed per month", narrow enough that
 * "225$ plus bonuses 5.63 hr" does not attach that trailing "hr" to the 225.
 */
const TAIL_WINDOW = 20;

/** Currency read from an explicit word beats one read from a bare "$". */
const WORD_EVIDENCE = 2;
const SYMBOL_EVIDENCE = 1;

function normalizeText(text) {
  return String(text)
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Which currency a specific number is denominated in, judged only from the
 * characters hugging it. Proximity beats a whole-string scan.
 *
 * `matchEnd` is the end of the whole token including any "k" suffix, so that
 * "30k PHP" sees " PHP" rather than "k PHP".
 */
function detectCurrencyNear(text, numberStart, matchEnd, patterns) {
  const before = text.slice(Math.max(0, numberStart - 16), numberStart);
  const after = text.slice(matchEnd, matchEnd + 16);

  for (const [code, pattern] of patterns.after) {
    if (pattern.test(after)) return { code, evidence: WORD_EVIDENCE };
  }
  for (const [code, pattern] of patterns.before) {
    if (pattern.test(before)) return { code, evidence: WORD_EVIDENCE };
  }

  // Bare symbols, weakest evidence. Per the site's convention, "$" means USD.
  if (/\$\s*$/.test(before)) return { code: 'USD', evidence: SYMBOL_EVIDENCE };
  if (/^\s*\$/.test(after)) return { code: 'USD', evidence: SYMBOL_EVIDENCE };
  if (/(?:^|[^a-z])p\s*$/i.test(before)) return { code: 'PHP', evidence: SYMBOL_EVIDENCE };
  if (/\?\s*$/.test(before)) return { code: 'PHP', evidence: SYMBOL_EVIDENCE };

  return null;
}

/**
 * Is the pay quoted per unit of work? Only consulted when no pay period was
 * found, so an explicit "$1,200/month" is never second-guessed.
 */
function detectTaskRate(text) {
  if (EXPLICIT_TASK_RATE.test(text)) return true;

  PER_UNIT.lastIndex = 0;
  let match;
  while ((match = PER_UNIT.exec(text)) !== null) {
    if (!TIME_UNIT.test(match[1])) return true;
  }
  return false;
}

/** The period mentioned earliest in `text`, or null. Position beats list order. */
function detectPeriod(text, patterns) {
  let best = null;
  for (const [period, pattern] of patterns.period) {
    const match = text.match(pattern);
    if (match && (best === null || match.index < best.index)) {
      best = { period, index: match.index };
    }
  }
  return best;
}

/**
 * The "k" suffix only scales a small base. "45,000K PHP Monthly" is a typo for
 * 45,000 - taking it literally would claim a salary of 45 million pesos.
 */
const MAX_BASE_FOR_K = 1000;

function toNumber(raw) {
  const value = Number(raw.replace(/[,  ]/g, ''));
  return Number.isFinite(value) ? value : null;
}

function collectNumbers(text, patterns) {
  const tokens = [];
  NUMBER_PATTERN.lastIndex = 0;

  let match;
  while ((match = NUMBER_PATTERN.exec(text)) !== null) {
    const base = toNumber(match[1]);
    if (base === null) continue;

    const scaled = Boolean(match[2]) && base < MAX_BASE_FOR_K;
    const value = scaled ? base * 1000 : base;

    const start = match.index;
    const end = start + match[0].length;
    const found = detectCurrencyNear(text, start, end, patterns);
    tokens.push({
      value,
      hasK: scaled,
      start,
      end,
      currency: found?.code ?? null,
      evidence: found?.evidence ?? 0,
    });
  }

  return tokens;
}

/**
 * Which end of a range names the currency. "$8 - $10 AUD/Hour" is Australian:
 * the explicit word outranks the bare "$" on the other end.
 */
function strongerCurrency(low, high) {
  if (high.currency !== null && high.evidence > low.evidence) return high.currency;
  return low.currency ?? high.currency ?? null;
}

/** First adjacent pair of numbers joined by a range separator. */
function findRangePair(tokens, text, separator) {
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    if (separator.test(text.slice(tokens[i].end, tokens[i + 1].start))) {
      return [tokens[i], tokens[i + 1]];
    }
  }
  return null;
}

/**
 * "20-25K" means 20,000 to 25,000: a "k" written once applies to both ends.
 * Only rescale when the gap is large enough that no other reading makes sense.
 */
function alignRangeMagnitude(low, high) {
  if (high.hasK && !low.hasK && low.value * 100 <= high.value) {
    return { low: low.value * 1000, high: high.value };
  }
  return { low: low.value, high: high.value };
}

/**
 * @param {string} text raw rate text, e.g. "PHP 20-25K"
 * @returns {null|{
 *   raw: string, amount: number, amountLow: number, amountHigh: number,
 *   currency: 'USD'|'PHP'|'AUD'|null, period: string|null, isRange: boolean,
 *   ambiguousPeriod: boolean, taskBased: boolean,
 *   confident: boolean, reason: string|null
 * }} null when the text holds no number at all
 */
export function parseRate(text, vocabulary = DEFAULT_VOCABULARY) {
  if (text === null || text === undefined) return null;

  const normalized = normalizeText(text);
  if (!normalized) return null;

  // Compiled once per vocabulary and cached, so this costs nothing per listing.
  const patterns = buildPatterns(vocabulary);

  const tokens = collectNumbers(normalized, patterns);
  if (tokens.length === 0) return null;

  // A rate field can carry incidental numbers ("32 hours = 11-12,000 PHP").
  // Numbers next to a currency marker are the real ones.
  const withCurrency = tokens.filter((token) => token.currency !== null);
  const primary = (withCurrency.length > 0 ? withCurrency : tokens)[0];

  // A range must involve the primary amount. Otherwise "$1500/month + Bonuses
  // ( Total $5-10k/mo(" would report the bonus range as the salary.
  const candidatePair = findRangePair(tokens, normalized, rangeSeparator(patterns));
  const rangePair = candidatePair?.includes(primary) ? candidatePair : null;

  let amountLow;
  let amountHigh;
  let currency;
  let anchor;

  if (rangePair) {
    const [low, high] = rangePair;
    const aligned = alignRangeMagnitude(low, high);
    amountLow = Math.min(aligned.low, aligned.high);
    amountHigh = Math.max(aligned.low, aligned.high);
    currency = strongerCurrency(low, high);
    anchor = high;
  } else {
    amountLow = primary.value;
    amountHigh = primary.value;
    currency = primary.currency;
    anchor = primary;
  }

  // "$650/month CAD": the symbol hugs the number and the word sits past the
  // period, out of reach of the per-number lookup - which would call it USD and
  // overstate the pay by a third. When a bare symbol is the only evidence any
  // number carries, and the string names exactly one currency, the word wins.
  const strongestEvidence = Math.max(...tokens.map((token) => token.evidence));
  if (strongestEvidence <= SYMBOL_EVIDENCE) {
    currency = soleCurrencyWord(normalized, patterns) ?? currency;
  }

  // Prefer a period stated right after the amount. Fall back to the wider
  // string only for a lone number - otherwise "$1,000-$1,500 p/m (paid every
  // two weeks)" picks up "weeks" from the payment schedule.
  const tail = normalized.slice(anchor.end, anchor.end + TAIL_WINDOW);
  const wholeString = detectPeriod(normalized, patterns);
  const found = detectPeriod(tail, patterns) ?? (tokens.length === 1 ? wholeString : null);
  const period = found?.period ?? null;

  // Paid per unit of work ("$1-$5 per approved comment"). Only meaningful when
  // no pay period was found, so a stated salary is never reinterpreted.
  const taskBased = period === null && detectTaskRate(normalized);
  // A period word we saw but could not attach to this amount. Treating such a
  // rate as monthly would be a guess against visible evidence.
  const ambiguousPeriod = period === null && wholeString !== null;

  let reason = null;
  if (currency === null) reason = 'no-currency';
  else if (period === null) reason = 'no-period';
  else if (amountHigh <= 0) reason = 'non-positive';

  return {
    raw: normalized,
    amount: amountHigh,
    amountLow,
    amountHigh,
    currency,
    period,
    isRange: Boolean(rangePair),
    ambiguousPeriod,
    taskBased,
    confident: reason === null,
    reason,
  };
}
