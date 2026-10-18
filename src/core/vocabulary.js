/**
 * The words the built-in parser knows, made editable.
 *
 * The parser's currency and period detection is two lists of markers compiled
 * into regular expressions. Keeping them locked inside the module meant a new
 * piece of employer vocabulary needed a code change, so they live here instead
 * - as plain words, not patterns.
 *
 * Words rather than regular expressions on purpose: they are what actually
 * varies between listings, they are safe to escape, and anyone can read them.
 * The regex escape hatch is custom-rules.js, for shapes a word list cannot
 * express.
 *
 * Symbols stay out of these lists. A bare "$" is deliberately weaker evidence
 * than the word "USD" - that precedence is what makes "$10 AUD/Hour" come out
 * Australian - so the symbol fallbacks remain in the parser, where the ordering
 * is enforced.
 */

/** Every currency the extension can convert, and the words that name it. */
export const DEFAULT_VOCABULARY = Object.freeze({
  currency: Object.freeze({
    PHP: ['php', 'ph', 'peso', 'pesos', '₱'],
    AUD: ['aud', 'a$'],
    CAD: ['cad', 'c$'],
    GBP: ['gbp', 'pound', 'pounds', '£'],
    EUR: ['eur', 'euro', 'euros', '€'],
    USD: ['usd', 'us$'],
    /*
     * Codes always; symbols only where they cannot be read as something else.
     *
     * Matching is plain alternation, not word-bounded, so a bare "kr" would
     * fire inside "workroom" and "dh" inside "dhl". The spelled-out names are
     * safe because nobody writes them by accident.
     */
    NZD: ['nzd', 'nz$'],
    AED: ['aed', 'dirham', 'dirhams'],
    SGD: ['sgd', 's$'],
    JPY: ['jpy', 'yen', '¥'],
    KRW: ['krw', 'won', '₩'],
    HKD: ['hkd', 'hk$'],
    NOK: ['nok', 'krone', 'kroner'],
    THB: ['thb', 'baht', '฿'],
  }),
  period: Object.freeze({
    hour: ['hour', 'hours', 'hourly', 'hr', 'hrs', 'p/h', '/h', '/hr'],
    day: ['day', 'days', 'daily', '/d'],
    week: ['week', 'weeks', 'weekly', 'wk', 'wks', '/w', '/wk'],
    month: ['month', 'months', 'monthly', 'mo', 'mos', 'mon', 'mth', 'mnth', 'p/m', 'pcm', '/m', '/mo'],
    year: ['year', 'years', 'yearly', 'yr', 'yrs', 'annual', 'annually', 'per annum', '/y', '/yr'],
  }),
});

/** The order groups are tested in. Specific words before general ones. */
/*
 * Precedence, most specific first.
 *
 * The new codes sit AFTER USD on purpose: "US$" contains "S$", so a
 * Singapore-dollar check running first would read every US dollar as Singapore.
 * Nothing USD matches appears inside the others, so this order is safe both
 * ways round.
 */
export const CURRENCY_ORDER = Object.freeze([
  'PHP', 'AUD', 'CAD', 'GBP', 'EUR', 'USD',
  'NZD', 'AED', 'SGD', 'JPY', 'KRW', 'HKD', 'NOK', 'THB',
]);
export const PERIOD_ORDER = Object.freeze(['hour', 'day', 'week', 'month', 'year']);

const MAX_WORDS = 40;
const MAX_WORD_LENGTH = 24;

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One alternation from a word list, with boundaries only where they mean
 * something.
 *
 * "\b" before "£" or "/h" never matches, neither beginning with a word
 * character - so the boundary is decided per word rather than for the group.
 */
function alternation(words) {
  return words
    .map((word) => {
      const escaped = escapeRegex(word);
      const open = /^\w/.test(word) ? '\\b' : '';
      const close = /\w$/.test(word) ? '\\b' : '';
      return `${open}${escaped}${close}`;
    })
    .join('|');
}

/** Stable across key order, so an unchanged vocabulary keeps its cache entry. */
export function vocabularySignature(vocabulary = DEFAULT_VOCABULARY) {
  const part = (group, order) =>
    order.map((name) => `${name}:${(group?.[name] ?? []).join(',')}`).join(';');

  return `${part(vocabulary.currency, CURRENCY_ORDER)}|${part(vocabulary.period, PERIOD_ORDER)}`;
}

/**
 * Compile a vocabulary into the pattern sets the parser uses.
 *
 * Memoised: parsing runs once per listing across hundreds of them, while the
 * vocabulary changes only when the options page is edited.
 */
const cache = new Map();

export function buildPatterns(vocabulary = DEFAULT_VOCABULARY) {
  const key = vocabularySignature(vocabulary);
  const cached = cache.get(key);
  if (cached) return cached;

  const currencyWords = vocabulary.currency ?? DEFAULT_VOCABULARY.currency;
  const periodWords = vocabulary.period ?? DEFAULT_VOCABULARY.period;

  const currencies = CURRENCY_ORDER.filter((code) => (currencyWords[code] ?? []).length > 0).map(
    (code) => [code, alternation(currencyWords[code])],
  );

  const built = {
    /** Immediately after the amount: "1200 PHP". */
    after: currencies.map(([code, alt]) => [code, new RegExp(`^\\s*(?:${alt})`, 'i')]),

    /**
     * Immediately before it, optionally with the symbol between: "AUD $10".
     * Without that optional \$? the bare symbol would win and say US dollars.
     */
    before: currencies.map(([code, alt]) => [
      code,
      new RegExp(`(?:${alt})\\s*\\$?\\s*[:.\\-]?\\s*$`, 'i'),
    ]),

    /** Anywhere in the string, for the sole-currency fallback. */
    words: currencies.map(([code, alt]) => [code, new RegExp(alt, 'i')]),

    /** Allowed inside a range separator: "30,000 php to 70,000 php". */
    token: `(?:${currencies.map(([, alt]) => alt).join('|')}|\\?|\\$|p)`,

    period: PERIOD_ORDER.filter((name) => (periodWords[name] ?? []).length > 0).map((name) => {
      const alt = alternation(periodWords[name]);
      // "1st Year" is a tenure milestone, not an annual salary, so an ordinal
      // in front disqualifies the match.
      const guard = name === 'year' ? '(?<!\\b(?:\\d+(?:st|nd|rd|th)|first|second|third)\\s)' : '';
      return [name, new RegExp(`${guard}(?:${alt})`, 'i')];
    }),
  };

  cache.set(key, built);
  return built;
}

function sanitizeWords(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];

  const cleaned = value
    .map((word) => String(word ?? '').trim().toLowerCase())
    .filter((word) => word.length > 0 && word.length <= MAX_WORD_LENGTH);

  return [...new Set(cleaned)].slice(0, MAX_WORDS);
}

/**
 * Fill any group the stored value does not mention from the defaults, so a
 * partial or damaged vocabulary can never leave the parser unable to read a
 * currency it used to handle.
 */
export function sanitizeVocabulary(value) {
  const input = value && typeof value === 'object' ? value : {};

  const currency = {};
  for (const code of CURRENCY_ORDER) {
    currency[code] = sanitizeWords(input.currency?.[code], DEFAULT_VOCABULARY.currency[code]);
  }

  const period = {};
  for (const name of PERIOD_ORDER) {
    period[name] = sanitizeWords(input.period?.[name], DEFAULT_VOCABULARY.period[name]);
  }

  return { currency, period };
}

/** Is this still the shipped vocabulary? Used to offer a reset. */
export function isDefaultVocabulary(vocabulary) {
  return (
    vocabularySignature(sanitizeVocabulary(vocabulary)) ===
    vocabularySignature(sanitizeVocabulary(DEFAULT_VOCABULARY))
  );
}
