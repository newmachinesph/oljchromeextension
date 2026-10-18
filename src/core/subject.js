/**
 * The subject line for a draft.
 *
 * Some employers demand a specific subject ("put NEW VA in the subject line");
 * that is detected from the description and always wins. Otherwise the subject
 * comes from a pattern you set once, filled from the job and your name. Pure,
 * so the one rule lives in one place and is easy to test.
 */

export const DEFAULT_SUBJECT_PATTERN = 'Application: {jobTitle} — {name}';

const SEP = String.raw`\s*[—\-:|,]?\s*`;

/**
 * Fill `{placeholder}` tokens from `values`, then tidy up.
 *
 * A placeholder with no value is removed together with a separator glued to it,
 * so "VA — {missing}" becomes "VA" rather than "VA — ". Present values,
 * including multi-word ones, are left exactly as given.
 */
export function fillPattern(pattern, values = {}) {
  // 1. Fill every placeholder that has a real value; leave the rest as tokens.
  let out = String(pattern ?? '').replace(/\{(\w+)\}/g, (whole, key) => {
    const value = values[key];
    return value !== undefined && value !== null && String(value).trim() !== ''
      ? String(value)
      : whole;
  });

  // 2. Remove each leftover token with a separator glued to it (either side).
  out = out
    .replace(new RegExp(`${SEP}\\{\\w+\\}`, 'g'), '')
    .replace(new RegExp(`\\{\\w+\\}${SEP}`, 'g'), '');

  // 3. Tidy the edges and any doubled spaces.
  return out
    .replace(/^\s*[—\-:|,]\s*/, '')
    .replace(/\s*[—\-:|,]\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * @param {object} input
 * @param {string} [input.instruction] a subject the employer demanded
 * @param {string} [input.pattern] the user's pattern
 * @param {object} [input.values] {jobTitle, employer, name, profileLabel, ...}
 * @returns {string}
 */
export function resolveSubject({ instruction, pattern, values = {} } = {}) {
  const demanded = String(instruction ?? '').trim();
  if (demanded) return demanded;
  return fillPattern(pattern || DEFAULT_SUBJECT_PATTERN, values);
}
