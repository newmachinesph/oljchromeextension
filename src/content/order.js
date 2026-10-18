/**
 * Applying a ranking to the page without moving anything.
 *
 * The results container becomes a flex column and every child gets an explicit
 * CSS `order`. The DOM is left exactly as the site built it, so this keeps the
 * same promise collapsing does: switch it off and there is nothing to unwind
 * beyond one class and one inline property per child.
 *
 * Children that are not listings keep their side of the list. Anything sitting
 * above the first listing - our control bar, the gathered hidden block, the
 * site's own result count - stays above it; anything below stays below. Only
 * the listings themselves are reordered.
 */

const SORTED_CLASS = 'ojrf-sorted';

/**
 * Listings occupy their own band of order values, with room above for the
 * header children and a long way below for the footer ones.
 */
const LISTING_BASE = 10000;
const FOOTER_BASE = 10000000;

/**
 * @param {Element|null} container the results container
 * @param {Element[]} ranked the listing elements, in the order they should show
 * @returns {number} how many listings were placed
 */
export function applyOrder(container, ranked) {
  if (!container) return 0;

  const rank = new Map(ranked.map((element, index) => [element, index]));

  container.classList.add(SORTED_CLASS);

  let seenListing = false;
  let header = 0;
  let footer = 0;

  for (const child of container.children) {
    if (rank.has(child)) {
      seenListing = true;
      child.style.setProperty('order', String(LISTING_BASE + rank.get(child)));
    } else if (seenListing) {
      child.style.setProperty('order', String(FOOTER_BASE + footer));
      footer += 1;
    } else {
      child.style.setProperty('order', String(header));
      header += 1;
    }
  }

  return rank.size;
}

/** Put the container back to the site's own ordering. */
export function clearOrder(container) {
  if (!container) return;

  container.classList.remove(SORTED_CLASS);
  for (const child of container.children) child.style.removeProperty('order');
}
