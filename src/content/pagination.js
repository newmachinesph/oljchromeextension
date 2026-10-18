/**
 * Our own pager, replacing the site's numbered one.
 *
 * The site's "1 2 3 4" advances 30 listings at a time. Once pages are merged the
 * screen already holds several of those, so the numbers no longer line up with
 * what you are looking at - clicking "2" would re-show listings already present.
 *
 * This steps by the whole merged span instead: with 5 extra pages loaded, Next
 * jumps 180 listings, landing exactly where the current screen ends.
 */

import { currentOffset, pageUrl, PAGE_SIZE } from './prefetch.js';

const NAV_ID = 'ojrf-pager';
const SITE_PAGINATION = 'ul.pagination';
const PART_HIDDEN = 'ojrf-part-hidden';

function arrow(direction) {
  const points = direction === 'prev' ? '15 6 9 12 15 18' : '9 6 15 12 9 18';
  return (
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"' +
    ' stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    `<polyline points="${points}"/></svg>`
  );
}

function button({ label, direction, target, disabled }) {
  const el = document.createElement(disabled ? 'span' : 'a');
  el.className = disabled ? 'ojrf-pager-button ojrf-pager-disabled' : 'ojrf-pager-button';
  if (!disabled) el.href = target;

  const text = `<span>${label}</span>`;
  el.innerHTML = direction === 'prev' ? arrow('prev') + text : text + arrow('next');
  return el;
}

/**
 * @param {object} options
 * @param {number} options.span how many listings the screen covers
 * @param {number} options.total how many are actually on the page
 */
export function replacePagination({ span, total, loc = window.location, doc = document } = {}) {
  const sitePager = doc.querySelector(SITE_PAGINATION);
  if (!sitePager) return null;

  sitePager.classList.add(PART_HIDDEN);

  const step = Math.max(PAGE_SIZE, span || PAGE_SIZE);
  const offset = currentOffset(loc);

  const nav = doc.getElementById(NAV_ID) ?? doc.createElement('nav');
  nav.id = NAV_ID;
  nav.textContent = '';
  nav.setAttribute('aria-label', 'Job results pages');

  nav.appendChild(
    button({
      label: 'Previous',
      direction: 'prev',
      target: pageUrl(Math.max(0, offset - step), loc),
      disabled: offset === 0,
    }),
  );

  const status = doc.createElement('span');
  status.className = 'ojrf-pager-status';
  status.textContent = `${offset + 1}–${offset + (total || step)}`;
  nav.appendChild(status);

  nav.appendChild(
    button({
      label: 'Next',
      direction: 'next',
      target: pageUrl(offset + step, loc),
      disabled: false,
    }),
  );

  sitePager.parentElement?.insertBefore(nav, sitePager);
  return nav;
}

/** Put the site's own pager back. */
export function restorePagination(doc = document) {
  doc.getElementById(NAV_ID)?.remove();
  doc.querySelector(SITE_PAGINATION)?.classList.remove(PART_HIDDEN);
}
