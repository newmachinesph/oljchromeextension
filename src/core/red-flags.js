/**
 * Terms that cost the applicant.
 *
 * Every other rule here optimises: is this enough money, is it the right kind
 * of work. This one protects. The people using this site are a standing target
 * for unpaid "trials", placement fees and commission-only work dressed up as a
 * salary, and all of it is visible in the listing text before you apply.
 *
 * Deliberately conservative. A false positive tells someone a real job is a
 * scam, which is its own kind of harm, so each pattern matches a specific
 * phrase rather than a suspicious-sounding word. "Commission" alone is not a
 * flag; "commission only" is.
 *
 * Flagged, not hidden, by default. A warning you can read and overrule is
 * useful; a listing silently removed teaches you nothing, and some of these
 * jobs are worth taking with your eyes open.
 */

/**
 * @typedef {object} RedFlag
 * @property {string} id
 * @property {string} label short, for a chip
 * @property {string} why one line on what it costs you
 * @property {RegExp} pattern
 */

/** @type {readonly RedFlag[]} */
export const RED_FLAGS = Object.freeze([
  {
    id: 'upfront-payment',
    label: 'asks for money',
    why: 'A real employer never charges you to start. This is the clearest scam signal there is.',
    pattern:
      /\b((placement|registration|processing|application|training)\s+fee|pay\s+a\s+(deposit|bond|fee)|security\s+deposit|send\s+(us\s+)?(money|payment)|buy\s+(your\s+own\s+)?(kit|starter\s+pack))\b/i,
  },
  {
    id: 'unpaid-trial',
    label: 'unpaid trial',
    why: 'Asks for real work up front without paying for it.',
    pattern:
      /\b(unpaid\s+(trial|test|task|work|period)|free\s+(trial\s+task|test\s+task|sample\s+work)|trial\s+period\s+is\s+unpaid|no\s+pay\s+(for|during)\s+(the\s+)?trial)\b/i,
  },
  {
    id: 'unpaid-training',
    label: 'unpaid training',
    why: 'Training you are not paid for is time worked for nothing.',
    pattern:
      /\b(unpaid\s+training|training\s+(is\s+)?(unpaid|not\s+paid)|no\s+pay\s+during\s+training)\b/i,
  },
  {
    id: 'commission-only',
    label: 'commission only',
    why: 'No base pay, so the advertised figure is a ceiling rather than an offer.',
    pattern:
      /\b(commission[-\s]?(only|based)|purely\s+commission|100%\s+commission|no\s+base\s+(pay|salary))\b/i,
  },
  {
    id: 'exposure',
    label: 'paid in exposure',
    why: 'Offers reputation instead of money.',
    pattern:
      /\b(for\s+(the\s+)?exposure|portfolio\s+building\s+only|payment\s+in\s+exposure)\b/i,
  },
  {
    id: 'off-platform',
    label: 'off-platform contact',
    why: 'Moving to Telegram or WhatsApp before hiring puts you outside the site’s protection.',
    pattern:
      /\b(telegram|whatsapp)\b[^.]{0,40}\b(only|directly|contact|message|apply|reach)\b|\b(contact|message|apply)\b[^.]{0,25}\b(telegram|whatsapp)\b/i,
  },
]);

/**
 * Which flags a listing's text trips.
 *
 * @param {string} text the listing as written, title and body together
 * @returns {RedFlag[]} in declaration order, so the wording stays stable and
 *   the most serious one leads
 */
export function findRedFlags(text) {
  const haystack = String(text ?? '');
  if (haystack.length === 0) return [];

  return RED_FLAGS.filter((flag) => flag.pattern.test(haystack));
}

/** "asks for money · commission only" - short enough for a chip. */
export function describeRedFlags(flags) {
  return (flags ?? []).map((flag) => flag.label).join(' · ');
}

/** The full reasoning, for a tooltip or the modal. */
export function explainRedFlags(flags) {
  return (flags ?? []).map((flag) => `${flag.label}: ${flag.why}`).join('\n');
}
