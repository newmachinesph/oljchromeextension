/**
 * Ordering the results.
 *
 * We already compute a comparable USD-per-month for most listings, but the page
 * keeps the site's order - so a merged list of 300 still has to be read top to
 * bottom. This turns that work into something you can act on.
 *
 * Pure on purpose: it ranks plain records and never touches the DOM. Applying a
 * ranking to the page is content/order.js, which does it with CSS `order` so no
 * site node is ever moved.
 */

export const SORT_MODES = Object.freeze([
  { value: 'site', label: 'Site order' },
  { value: 'rate-desc', label: 'Highest rate' },
  { value: 'rate-asc', label: 'Lowest rate' },
  { value: 'newest', label: 'Newest first' },
]);

const VALID_MODES = new Set(SORT_MODES.map((mode) => mode.value));

export function isSortMode(value) {
  return VALID_MODES.has(value);
}

/** Which field each mode ranks on, and in which direction. */
const RANK_BY = {
  'rate-desc': { key: 'usdPerMonth', direction: -1 },
  'rate-asc': { key: 'usdPerMonth', direction: 1 },
  newest: { key: 'postedAt', direction: -1 },
};

/**
 * Rank listings for display.
 *
 * Records without the value being sorted on keep the site's order and go last,
 * in both directions. "Lowest rate" putting every unreadable rate first would
 * bury the cheap jobs you asked to see behind the ones we could not read - an
 * unknown is not a value, so it belongs at neither extreme.
 *
 * Stable: equal records keep their incoming order, so sorting the same data
 * twice never reshuffles the page.
 *
 * @param {Array<{usdPerMonth?: number|null, postedAt?: number|null}>} entries
 * @param {string} mode one of SORT_MODES
 * @returns {Array} the same records in display order, each stamped with `index`
 *   (its original position)
 */
export function sortEntries(entries, mode) {
  const items = (entries ?? []).map((entry, index) => ({ ...entry, index }));

  const rank = RANK_BY[mode];
  if (!rank) return items;

  const known = [];
  const unknown = [];
  for (const item of items) {
    if (Number.isFinite(item[rank.key])) known.push(item);
    else unknown.push(item);
  }

  known.sort((a, b) => {
    const gap = (a[rank.key] - b[rank.key]) * rank.direction;
    return gap || a.index - b.index;
  });

  return [...known, ...unknown];
}
