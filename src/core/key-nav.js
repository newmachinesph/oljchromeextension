/**
 * Keyboard triage: the bindings, and the arithmetic of moving through a list.
 *
 * Pure, so the table that the palette's help entry prints and the wrapping
 * rule that the content script follows can be tested without a browser, and
 * can never drift apart.
 */

/** The bindings, in the order the help entry lists them. */
export const KEY_BINDINGS = Object.freeze([
  { keys: ['j', 'k'], does: 'Next / previous listing' },
  { keys: ['Enter', 'o'], does: 'Open the focused listing' },
  { keys: ['d'], does: 'Dismiss it' },
  { keys: ['a'], does: 'Open its apply page, and record that you applied' },
  { keys: ['n'], does: 'Note on its employer' },
  { keys: ['b'], does: 'Block its employer' },
  { keys: ['?'], does: 'This list' },
]);

/** "j / k: next / previous listing · Enter / o: open …" - one line. */
export function describeBindings() {
  return KEY_BINDINGS.map((b) => `${b.keys.join(' / ')}: ${b.does.toLowerCase()}`).join(' · ');
}

/**
 * Where focus lands after a step.
 *
 * Wraps at both ends. From nothing focused, a step forward lands on the first
 * and a step back on the last. A stale index (the list shrank) is treated as
 * "past the end" so a step forward starts over rather than erroring.
 *
 * @returns {number} -1 when there is nothing to focus
 */
export function nextIndex(count, current, delta) {
  if (!Number.isFinite(count) || count <= 0) return -1;
  if (!Number.isFinite(current) || current < 0 || current >= count) {
    if (delta > 0) return 0;
    if (delta < 0) return count - 1;
    return count - 1;
  }
  return (((current + delta) % count) + count) % count;
}
