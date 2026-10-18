/**
 * The site's own "Displaying 30 out of 299 jobs" line.
 *
 * True when the site rendered it and false a second later: we merge several
 * pages into the page, so the count becomes the one visibly wrong thing on
 * screen. It is the site's copy rather than ours, so the original is stashed
 * and put back verbatim the moment the filter is switched off.
 *
 * The site's own total is kept in the new wording. It can legitimately be lower
 * than the number loaded - merging pulls in following pages while new postings
 * shift the offsets - and hiding that would trade one confusing number for
 * another.
 */

const ORIGINAL_ATTR = 'data-ojrf-original-count';
const COUNT_PATTERN = /displaying\s+([\d,]+)\s+out\s+of\s+([\d,]+)/i;

/** Our own class on the site's line, so something can be parked beside it. */
const LINE_CLASS = 'ojrf-count-line';

/**
 * On the line's container, so the two can share a row properly.
 *
 * Two inline-blocks was not enough. The summary is an atomic inline box, so
 * once "Showing 588 of 1,237 loaded" plus a five-part breakdown exceeded the
 * 730px column it jumped to its own line whole, looking detached. As flex items
 * the summary can shrink and wrap its own chips instead, and stays beside the
 * count.
 *
 * Applied only when the container holds nothing but those two, checked rather
 * than assumed: turning an arbitrary site container into a flex row would
 * rearrange whatever else it happened to hold.
 */
const HOST_CLASS = 'ojrf-count-host';

/**
 * The paragraph holding the count.
 *
 * Matched on its text, not its class: `fs-12` is a font-size utility used all
 * over the page, and the wording is the only thing identifying this line.
 */
export function findCountLine(doc = document) {
  for (const node of doc.querySelectorAll('.results p, .results span')) {
    if (COUNT_PATTERN.test(node.textContent)) return node;
  }
  return null;
}

/** The total the site claimed, read from its own wording. */
export function readSiteTotal(text) {
  const match = COUNT_PATTERN.exec(text ?? '');
  if (!match) return null;

  const total = Number(match[2].replace(/,/g, ''));
  return Number.isFinite(total) ? total : null;
}

/** "Showing 108 of 307 loaded · 299 on the site" */
export function countText({ loaded, hidden, siteTotal }) {
  const number = (value) => value.toLocaleString('en-US');
  const visible = Math.max(0, loaded - hidden);

  const parts = [
    hidden > 0
      ? `Showing ${number(visible)} of ${number(loaded)} loaded`
      : `${number(loaded)} loaded`,
  ];
  if (Number.isFinite(siteTotal)) parts.push(`${number(siteTotal)} on the site`);

  return parts.join(' · ');
}

/**
 * Restate the count for what is actually on the page.
 *
 * @param {{loaded: number, hidden: number}} counts
 * @returns {string|null} the text written, or null when the line was not found
 */
export function updateResultCount({ loaded, hidden }, doc = document) {
  // Either the site's line, or the one we already rewrote - which no longer
  // matches the pattern, so it has to be found by our own marker.
  const element = findCountLine(doc) ?? doc.querySelector(`[${ORIGINAL_ATTR}]`);
  if (!element) return null;

  // Stashed on the first pass only, so re-running never records our own text
  // as the original.
  if (!element.hasAttribute(ORIGINAL_ATTR)) {
    element.setAttribute(ORIGINAL_ATTR, element.textContent.replace(/\s+/g, ' ').trim());
  }

  const text = countText({
    loaded,
    hidden,
    siteTotal: readSiteTotal(element.getAttribute(ORIGINAL_ATTR)),
  });

  element.textContent = text;
  return text;
}

/**
 * Park the filter's summary immediately after the count line.
 *
 * The two say the same kind of thing - how many of what you asked for are on
 * screen - so they read as one sentence together and as two unrelated facts
 * apart. It also gets the growing half out of the control strip, where every
 * new reason for hiding something nudged the sort field and the cog along.
 *
 * Inserted as a sibling, never inside: `updateResultCount` rewrites that line's
 * text wholesale, which would take the summary with it.
 *
 * @param {Element} summary
 * @returns {boolean} false when the line is not on the page
 */
export function dockSummary(summary, doc = document) {
  const element = findCountLine(doc) ?? doc.querySelector(`[${ORIGINAL_ATTR}]`);
  if (!element || !summary) return false;

  element.classList.add(LINE_CLASS);
  // Idempotent: render runs on every change, and re-inserting a focused node
  // would drop the focus.
  if (summary.previousElementSibling !== element) element.after(summary);

  const host = element.parentElement;
  if (host) {
    const others = Array.from(host.children).filter(
      (child) => child !== element && child !== summary,
    );
    host.classList.toggle(HOST_CLASS, others.length === 0);
  }

  return true;
}

/**
 * Leave the site's line as we found it.
 *
 * Only the class is ours to take back. Where the summary itself belongs is the
 * caller's business, since it was the caller that lent it to us.
 */
export function undockSummary(doc = document) {
  for (const line of doc.querySelectorAll(`.${LINE_CLASS}`)) line.classList.remove(LINE_CLASS);
  for (const host of doc.querySelectorAll(`.${HOST_CLASS}`)) host.classList.remove(HOST_CLASS);
}

/** Put the site's own wording back, exactly as it rendered it. */
export function restoreResultCount(doc = document) {
  const element = doc.querySelector(`[${ORIGINAL_ATTR}]`);
  if (!element) return;

  element.textContent = element.getAttribute(ORIGINAL_ATTR);
  element.removeAttribute(ORIGINAL_ATTR);
}
