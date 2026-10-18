/**
 * Rate formats you teach the extension yourself.
 *
 * The built-in parser is regex all the way down, calibrated against a live
 * corpus - but the site has no house style and employers invent wording all the
 * time. Rather than wait for the parser to be updated, a rule lets you point at
 * a pattern and say what it means.
 *
 * Rules run *before* the built-in parser, so they serve both purposes: reading a
 * format we cannot, and overriding one we read wrongly. The first rule that
 * matches wins; if none do, nothing changes and the built-in parser runs as
 * usual. A rule that fails to compile is skipped rather than throwing, so a
 * half-typed pattern in the options page can never break the page you are on.
 */

import { parseRate } from './parse-rate.js';

export const RULE_CURRENCIES = Object.freeze([
  { value: '', label: 'Detect automatically' },
  { value: 'USD', label: 'USD' },
  { value: 'PHP', label: 'PHP' },
  { value: 'AUD', label: 'AUD' },
  { value: 'CAD', label: 'CAD' },
  { value: 'GBP', label: 'GBP' },
  { value: 'EUR', label: 'EUR' },
]);

export const RULE_PERIODS = Object.freeze([
  { value: '', label: 'Detect automatically' },
  { value: 'hour', label: 'Per hour' },
  { value: 'day', label: 'Per day' },
  { value: 'week', label: 'Per week' },
  { value: 'month', label: 'Per month' },
  { value: 'year', label: 'Per year' },
]);

const VALID_CURRENCIES = RULE_CURRENCIES.map((entry) => entry.value);
const VALID_PERIODS = RULE_PERIODS.map((entry) => entry.value);

/** Long enough for anything reasonable, short enough to bound the damage. */
const MAX_PATTERN = 200;
const MAX_RULES = 25;
const MAX_NAME = 60;

/** A number as employers write it: "20", "20,000", "20k", "1.5k". */
const AMOUNT = /(\d[\d,. ]*)\s*(k\b)?/i;

function toAmount(raw, kSuffix) {
  if (raw === undefined || raw === null) return null;

  const cleaned = String(raw).replace(/[,\s]/g, '');
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;

  // "20k" is 20,000, but "45,000k" is a typo - the built-in parser makes the
  // same call, and for the same reason.
  return kSuffix && value < 1000 ? value * 1000 : value;
}

/** The first number inside a piece of text, for rules with no capture group. */
function firstAmount(text) {
  const match = AMOUNT.exec(String(text ?? ''));
  return match ? toAmount(match[1], Boolean(match[2])) : null;
}

/**
 * Why a rule is not usable, in words fit for the options page.
 * @returns {string|null} null when the rule is fine
 */
export function ruleError(rule) {
  const pattern = String(rule?.pattern ?? '').trim();
  if (pattern.length === 0) return 'Give it a pattern to match.';
  if (pattern.length > MAX_PATTERN) return `Keep the pattern under ${MAX_PATTERN} characters.`;

  try {
    new RegExp(pattern, 'i');
  } catch (error) {
    return `Not a valid regular expression: ${error.message}`;
  }

  return null;
}

function compile(rule) {
  if (ruleError(rule) !== null) return null;
  try {
    return new RegExp(String(rule.pattern).trim(), 'i');
  } catch {
    return null;
  }
}

/**
 * Run one rule against a rate string.
 *
 * Amounts come from the capture groups: the first is the figure, and a second,
 * if present, makes it a range. With no capture groups at all, the first number
 * inside the match is used - which is what you want for a pattern written just
 * to recognise a format.
 *
 * @returns {object|null} a parse in the same shape parseRate produces, or null
 */
export function applyRule(rule, text) {
  if (!rule || rule.enabled === false) return null;

  const regex = compile(rule);
  if (!regex) return null;

  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (raw.length === 0) return null;

  const match = regex.exec(raw);
  if (!match) return null;

  const groups = match.slice(1).filter((value) => value !== undefined);
  const low = groups.length > 0 ? toAmount(groups[0]) : firstAmount(match[0]);
  if (low === null) return null;

  const high = groups.length > 1 ? toAmount(groups[1]) : null;

  const amountLow = high === null ? low : Math.min(low, high);
  const amountHigh = high === null ? low : Math.max(low, high);

  const currency = rule.currency || null;
  const period = rule.period || null;

  let reason = null;
  if (currency === null) reason = 'no-currency';
  else if (period === null) reason = 'no-period';
  else if (amountHigh <= 0) reason = 'non-positive';

  return {
    raw,
    amount: amountHigh,
    amountLow,
    amountHigh,
    currency,
    period,
    isRange: high !== null && amountLow !== amountHigh,
    // A rule is an explicit statement about this format, so it never leaves set
    // the ambiguity flags that would block the assumptions from filling gaps.
    ambiguousPeriod: false,
    taskBased: false,
    confident: reason === null,
    reason,
    /** Which rule read it, for the options-page tester and for debugging. */
    matchedRule: rule.name || rule.pattern,
  };
}

/**
 * Read a rate, custom rules first.
 *
 * @param {string|null} text the listing's rate field
 * @param {Array} rules sanitized custom rules, in priority order
 * @returns {object|null} parseRate's shape, or null when there is no number
 */
export function readRate(text, rules = [], vocabulary = undefined) {
  for (const rule of rules) {
    let result = null;
    try {
      result = applyRule(rule, text);
    } catch {
      result = null; // One bad rule must never cost a listing.
    }
    if (result) return result;
  }

  try {
    return vocabulary ? parseRate(text, vocabulary) : parseRate(text);
  } catch {
    return null;
  }
}

/** A cheap signature, so the filter knows when rules changed and must re-parse. */
export function rulesSignature(rules = []) {
  return rules
    .map((rule) => `${rule.enabled ? 1 : 0}|${rule.pattern}|${rule.currency}|${rule.period}`)
    .join('||');
}

/** Coerce whatever came out of storage into rules every caller can trust. */
export function sanitizeRules(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((rule) => rule && typeof rule === 'object')
    .map((rule, index) => {
      const pattern = String(rule.pattern ?? '')
        .trim()
        .slice(0, MAX_PATTERN);

      return {
        id: String(rule.id ?? `rule-${index}`).slice(0, 40),
        /*
         * A rule with no pattern yet is a draft you are still typing into.
         *
         * These used to be dropped here, which quietly broke "Add a rule": the
         * editor takes its list straight from saved settings, so the new blank
         * row was sanitised away before it could render and the button did
         * nothing at all. Keeping it lets the row survive its own save.
         *
         * Forced off rather than trusted, because an empty pattern compiles to
         * a regex that matches everything - exactly the rule you do not want
         * running against every listing on the page. applyRule skips anything
         * disabled, so a draft can never affect a reading.
         */
        enabled: pattern.length > 0 ? rule.enabled !== false : false,
        name: String(rule.name ?? '')
          .trim()
          .slice(0, MAX_NAME),
        pattern,
        currency: VALID_CURRENCIES.includes(rule.currency) ? rule.currency : '',
        period: VALID_PERIODS.includes(rule.period) ? rule.period : '',
      };
    })
    .slice(0, MAX_RULES);
}

export const RULE_LIMITS = Object.freeze({ MAX_PATTERN, MAX_RULES, MAX_NAME });
