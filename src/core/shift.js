/**
 * Which shift a listing is asking for, when it says so plainly.
 *
 * OnlineJobs has no structured shift field, so this reads the words. It is
 * deliberately conservative: only clear markers count, and a post that signals
 * both (or neither) is treated as unknown. A jobseeker who can only work days,
 * or only nights, can then hide the shift they cannot take - but a post that
 * never mentions a shift is never hidden, because guessing wrong would bury a
 * job that might have been fine.
 */

/** The user's preference, and the option list for the settings UI. */
export const SHIFT_OPTIONS = Object.freeze([
  { value: 'any', label: 'Any shift' },
  { value: 'day', label: 'Day shift only' },
  { value: 'night', label: 'Night shift only' },
]);

const NIGHT = /night\s*shift|graveyard|overnight|\bus\s*hours\b|eastern\s*time|pacific\s*time|central\s*time|\bEST\b|\bPST\b|\bCST\b|\bMST\b|us\s*time\s*zone/i;
const DAY = /day\s*shift|morning\s*shift|\bPH\s*time\b|philippine\s*time|manila\s*time|\bAEST\b|australian\s*time|\bday\s*time\b|daytime/i;

/**
 * Read the shift a listing asks for.
 * @param {string} text the listing's searchable text
 * @returns {'day'|'night'|null} null when it is unclear, or says both
 */
export function detectShift(text) {
  const value = String(text ?? '');
  const night = NIGHT.test(value);
  const day = DAY.test(value);
  if (night === day) return null; // both or neither: not sure enough to act
  return night ? 'night' : 'day';
}

/**
 * Should this listing be hidden for the chosen shift preference?
 *
 * @param {'any'|'day'|'night'} want
 * @param {'day'|'night'|null} detected
 */
export function isWrongShift(want, detected) {
  return want !== 'any' && detected !== null && detected !== want;
}
