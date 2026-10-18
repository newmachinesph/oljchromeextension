/**
 * Matching and ranking for the command palette.
 *
 * Pure, so the thing that decides what you see when you type two letters can be
 * tested without a browser.
 *
 * Subsequence matching rather than substring: typing "vaed" should find
 * "Virtual Assistant - Video Editor". That is what makes a palette feel quick,
 * because you type what you remember rather than what is written.
 */

/**
 * Score one candidate against a query.
 *
 * @returns {number|null} higher is better; null when the query does not match
 */
export function score(text, query) {
  const haystack = String(text ?? '').toLowerCase();
  const needle = String(query ?? '').trim().toLowerCase();

  if (needle.length === 0) return 0;
  if (haystack.length === 0) return null;

  let position = 0;
  let points = 0;
  let streak = 0;

  for (const character of needle) {
    if (character === ' ') continue;

    const found = haystack.indexOf(character, position);
    if (found === -1) return null;

    // Landing on a word boundary is worth more than landing mid-word: someone
    // typing initials means the initials.
    const boundary = found === 0 || /[\s\-/(,.|]/.test(haystack[found - 1]);
    streak = found === position ? streak + 1 : 0;

    points += 1 + (boundary ? 6 : 0) + streak * 2;
    position = found + 1;
  }

  // Among equal matches, prefer the shorter text - it is the more exact answer.
  return points - haystack.length * 0.01;
}

/**
 * Rank a list of entries against a query.
 *
 * Ties keep their incoming order, so an unfiltered palette shows commands in
 * the order they were declared rather than an arbitrary one.
 *
 * @param {Array<{label: string, hint?: string}>} entries
 * @param {string} query
 * @param {number} limit
 */
export function rank(entries, query, limit = 40) {
  const trimmed = String(query ?? '').trim();

  const scored = (entries ?? []).map((entry, index) => {
    if (trimmed.length === 0) return { entry, index, points: 0 };

    // The hint is searchable but worth less: typing an employer's name should
    // find their job, without outranking a job whose title actually says it.
    const onLabel = score(entry.label, trimmed);
    const onHint = entry.hint ? score(entry.hint, trimmed) : null;
    if (onLabel === null && onHint === null) return null;

    const points = Math.max(onLabel ?? -Infinity, (onHint ?? -Infinity) - 3);
    return { entry, index, points };
  });

  return scored
    .filter(Boolean)
    .sort((a, b) => b.points - a.points || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.entry);
}
