/**
 * What a listing means when it gives no number.
 *
 * "Rate unclear" flattens two very different statements. `TBD` means the
 * employer has not decided. `Based on Experience` means they have decided that
 * it depends on you - which is the one case where the figure could land high,
 * and worth telling apart from silence.
 *
 * Both still leave the listing visible and unranked; we cannot invent a number.
 * The point is to name them accurately, so a list of 200 unpriced jobs reads as
 * "60 open to negotiation, 140 not stated" rather than one grey blur.
 *
 * The vocabulary comes from a 102-page sweep of the live site - these are the
 * strings employers actually write, in the proportions they write them.
 */

export const RATE_INTENTS = Object.freeze({
  /** Open, and pegged to what you bring. */
  NEGOTIABLE: 'negotiable',
  /** Simply not decided, or not published. */
  UNSTATED: 'unstated',
});

/**
 * Checked first: a string can carry both cues, and the more informative one
 * should win. "TBD based on your experience" says TBD, but what it tells you is
 * that the number is yours to argue for.
 */
const NEGOTIABLE = [
  /negotiab|negotiate/i,
  /\bdoe\b/i,
  /depend(?:s|ing|ent)?\s+(?:up)?on/i,
  /based\s+(?:up)?on\s+(?:your\s+)?(?:experience|skill|qualification|performance|capabilit)/i,
  /commensurate/i,
  /competitive/i,
  /according\s+to\s+(?:your\s+)?(?:experience|skill|qualification)/i,
  /open\s+to\s+(?:discussion|offers?|negotiation)/i,
  /higher\s+than\s+(?:your\s+)?last/i,
  /\bvariable\b/i,
  /\bflexible\b/i,
];

const UNSTATED = [
  // A bare marker and nothing else. "$$$" is a wink, not a figure.
  /^\s*(?:tbd|tba|tbc|n\.?\/?a|none|nil|-+|\?+|\$+|\.+)\s*$/i,
  /to\s+be\s+(?:determined|discussed|advised|confirmed|announced|agreed|decided|arranged)/i,
  /not\s+(?:specified|disclosed|provided|mentioned|indicated|stated|given)/i,
  /(?:discuss|disclos|shar)(?:ed)?\s+(?:at|during|in|on)\s+(?:the\s+)?(?:interview|call|meeting)/i,
  /will\s+(?:be\s+)?discuss/i,
  /let'?s\s+(?:talk|discuss)/i,
  /we\s+(?:need\s+to|can|will)\s+talk/i,
  /\bupon\s+(?:interview|discussion)\b/i,
];

const matches = (patterns, text) => patterns.some((pattern) => pattern.test(text));

/**
 * @param {string|null|undefined} text the listing's raw rate field
 * @returns {'negotiable'|'unstated'|null} null when the text is neither - a
 *   figure we simply could not read is genuinely unclear, and saying so is more
 *   honest than filing it under either of these.
 */
export function readRateIntent(text) {
  if (text === null || text === undefined) return null;

  const normalized = String(text).replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return null;

  if (matches(NEGOTIABLE, normalized)) return RATE_INTENTS.NEGOTIABLE;
  if (matches(UNSTATED, normalized)) return RATE_INTENTS.UNSTATED;

  return null;
}
