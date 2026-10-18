/**
 * Pulling several result pages into the current one.
 *
 * The site paginates 30 listings at a time, so a strict filter can empty a page
 * and leave you clicking "next" repeatedly. Fetching the following pages and
 * appending their cards turns that into one long, filterable list.
 *
 * Same-origin fetch plus DOMParser is all this needs - no extra permissions.
 * Only cards we appended are ours to remove; the site's own nodes are untouched.
 */

const SEARCH_PATH = /\/jobseekers\/jobsearch(?:\/(\d+))?/;
const CARD_SELECTOR = '.jobpost-cat-box';
const JOB_LINK = 'a[href*="/jobseekers/job/"]';
const IMPORTED_ATTR = 'data-ojrf-imported';

import { readCached, writeCached } from './page-cache.js';
import { searchUrl } from '../core/search-url.js';

export const PAGE_SIZE = 30;

/**
 * The most pages one load will ever ask for, however many terms are set.
 *
 * Ten terms over five pages is fifty requests, repeated on every refresh - the
 * shape of traffic that gets a signed-in account rate-limited. Past this the
 * pages-per-term is reduced rather than the terms dropped, since losing a whole
 * search silently is worse than seeing fewer pages of each.
 */
export const MAX_REQUESTS_PER_LOAD = 24;

/**
 * How many requests may be in flight at once.
 *
 * One. Four keywords across five pages is twenty requests, and firing even a
 * handful at once at a signed-in session is how you get rate-limited on an
 * account you actually need. Strictly serial costs a few seconds and keeps the
 * traffic indistinguishable from someone clicking "next" quickly - which is the
 * whole point, since the account doing the browsing is the user's real one.
 */
export const FETCH_CONCURRENCY = 1;

/**
 * Run `worker` over `items`, at most `limit` at a time. Results keep input order.
 *
 * A pool of `limit` runners pulling from a shared cursor: no batching, so a slow
 * request never leaves the others idle waiting for its batch to finish.
 */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const size = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: size }, runner));
  return results;
}

/**
 * One gate shared by every fetch this module makes.
 *
 * A per-call pool is enough on a clean page load, where a page merge and a
 * keyword search never run together - but not when you add a search term while
 * a merge is still in flight. Two pools of four would then put eight requests
 * on the wire, so the cap belongs to the module rather than to one call.
 */
let inFlight = 0;
const waiting = [];

function acquireSlot() {
  if (inFlight < FETCH_CONCURRENCY) {
    inFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function releaseSlot() {
  const next = waiting.shift();
  // Hand the slot straight to whoever is waiting rather than dropping the
  // count and letting it be re-taken, which could let a third caller in.
  if (next) next();
  else inFlight -= 1;
}

/**
 * Fetch one result page and return its card elements.
 * A page that fails contributes nothing rather than failing the whole batch.
 */
function cardsFromHtml(html) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(parsed.querySelectorAll(CARD_SELECTOR));
}

/**
 * One page of results, from the tab's cache when we already have it.
 *
 * The cache is checked before the concurrency slot is taken: a cached page
 * costs nothing and should not queue behind a real request.
 */
async function fetchCards(url, fetchImpl, useCache = true) {
  if (useCache) {
    const cached = readCached(url);
    if (cached !== null) return cardsFromHtml(cached);
  }

  await acquireSlot();
  try {
    const response = await fetchImpl(url, { credentials: 'include' });
    if (!response.ok) return [];

    const cards = cardsFromHtml(await response.text());
    // Only the cards are kept, not the whole document - the rest is the site's
    // chrome, which we already have and which dwarfs the part we use.
    if (useCache && cards.length > 0) {
      writeCached(url, cards.map((card) => card.outerHTML).join(''));
    }

    return cards;
  } catch {
    return [];
  } finally {
    releaseSlot();
  }
}

/** Requests currently on the wire. Exposed for tests. */
export function requestsInFlight() {
  return inFlight;
}

/**
 * Fetch any page on the site and hand back its parsed document.
 *
 * Shares the same gate as page merging, so opening a job in the modal cannot
 * add a request on top of a merge already running. The status comes back too:
 * a deleted job answers 410, which is the cheapest way to know it is gone.
 *
 * @returns {{ok: boolean, status: number, doc: Document|null}}
 */
export async function fetchDocument(url, fetchImpl = fetch) {
  await acquireSlot();
  try {
    const response = await fetchImpl(url, { credentials: 'include' });
    const html = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      doc: new DOMParser().parseFromString(html, 'text/html'),
    };
  } catch {
    return { ok: false, status: 0, doc: null };
  } finally {
    releaseSlot();
  }
}

/** Which offset the current page is showing. */
export function currentOffset(loc = window.location) {
  const match = SEARCH_PATH.exec(loc.pathname);
  return match?.[1] ? Number(match[1]) : 0;
}

/** The same search, at a different offset. Keeps the query string intact. */
export function pageUrl(offset, loc = window.location) {
  return `/jobseekers/jobsearch/${offset}${loc.search}`;
}

/**
 * Fetch the next `count` pages and return their card elements.
 * One page at a time, in order - see FETCH_CONCURRENCY.
 */
export async function fetchAdditionalPages({
  count,
  pageSize = PAGE_SIZE,
  loc = window.location,
  fetchImpl = fetch,
  concurrency = FETCH_CONCURRENCY,
} = {}) {
  if (!Number.isFinite(count) || count < 1) return [];

  const start = currentOffset(loc);
  const offsets = Array.from({ length: count }, (_, index) => start + pageSize * (index + 1));

  const pages = await mapLimit(offsets, concurrency, (offset) =>
    fetchCards(pageUrl(offset, loc), fetchImpl),
  );

  return pages.flat();
}

// The URL builder lives in core so the service worker and the popup can share
// it; re-exported here so the page code's callers do not change.
export { searchUrl };

/**
 * Run several keyword searches and return every card they produce.
 *
 * The site searches one phrase at a time, so "engineer" and "full stack" are two
 * result sets to compare by hand. Fetched together they become one list, which
 * mergeCards then deduplicates - the same job matching two keywords appears once.
 */
export async function fetchSearches({
  keywords,
  pages = 1,
  pageSize = PAGE_SIZE,
  fetchImpl = fetch,
  concurrency = FETCH_CONCURRENCY,
  maxRequests = MAX_REQUESTS_PER_LOAD,
  useCache = true,
} = {}) {
  const terms = (keywords ?? []).map((term) => String(term).trim()).filter(Boolean);
  if (terms.length === 0) return { cards: [], requested: 0, pagesPerTerm: 0, capped: false };

  // Every term keeps at least its first page: dropping a search outright would
  // quietly remove results you asked for, whereas fetching fewer pages of each
  // only shortens the tail.
  const wanted = Math.max(1, pages);
  const pagesPerTerm = Math.max(1, Math.min(wanted, Math.floor(maxRequests / terms.length)));
  const capped = pagesPerTerm < wanted;

  const requests = [];
  for (const term of terms) {
    for (let index = 0; index < pagesPerTerm; index += 1) {
      requests.push(searchUrl(term, index * pageSize));
    }
  }

  // The concurrency cap keeps these from arriving as one burst; the ceiling
  // above keeps the total from being unreasonable in the first place.
  const results = await mapLimit(requests, concurrency, (url) =>
    fetchCards(url, fetchImpl, useCache),
  );

  return { cards: results.flat(), requested: requests.length, pagesPerTerm, capped };
}

function hrefOf(card) {
  return card.querySelector(JOB_LINK)?.getAttribute('href') ?? null;
}

/**
 * Marks a card the site itself returned for one of the search terms.
 *
 * The reason it has to be recorded rather than re-derived: a card is an
 * excerpt, and the site searches the whole post. Searching "claude" returns
 * thirty listings of which none show the word on the card - so re-testing the
 * card text hid every result and the search looked broken. The site has already
 * answered the question; this remembers the answer.
 */
export const SEARCH_HIT_ATTR = 'data-ojrf-search-hit';

/** Forget which search vouched for what, before a new one starts. */
export function clearSearchHits(doc = document) {
  for (const card of doc.querySelectorAll(`[${SEARCH_HIT_ATTR}]`)) {
    card.removeAttribute(SEARCH_HIT_ATTR);
  }
}

/**
 * Append cards that are not already on the page.
 *
 * Deduplicated by job URL: new postings shift the offsets, so the same listing
 * can legitimately turn up on two pages fetched moments apart.
 *
 * `searchHit` marks the arrivals as results of a keyword search. The duplicates
 * are marked too, and that is why the nodes are kept rather than only their
 * URLs: a listing the site returns for your term is often already on the page,
 * and skipping it silently left a genuine hit looking like an unrelated one.
 *
 * @returns {number} how many were added
 */
export function mergeCards(cards, container, doc = document, { searchHit = false } = {}) {
  if (!container) return 0;

  const seen = new Map();
  for (const card of container.querySelectorAll(CARD_SELECTOR)) {
    const href = hrefOf(card);
    if (href && !seen.has(href)) seen.set(href, card);
  }

  let added = 0;
  for (const card of cards) {
    const href = hrefOf(card);
    if (!href) continue;

    const existing = seen.get(href);
    if (existing) {
      if (searchHit) existing.setAttribute(SEARCH_HIT_ATTR, '1');
      continue;
    }

    const imported = doc.importNode(card, true);
    imported.setAttribute(IMPORTED_ATTR, '1');
    if (searchHit) imported.setAttribute(SEARCH_HIT_ATTR, '1');
    container.appendChild(imported);
    seen.set(href, imported);
    added += 1;
  }

  return added;
}

/** Remove everything we appended, leaving the site's own page behind. */
export function removeImported(doc = document) {
  for (const card of doc.querySelectorAll(`[${IMPORTED_ATTR}]`)) card.remove();
}

/** Marks a card the auto-refresh brought in, so it can be styled and counted. */
export const FRESH_ATTR = 'data-ojrf-fresh';

/**
 * The first page of the current search, fetched live.
 *
 * Always cache-bypassed: a poll that reads its own cache would never see
 * anything new, which is the entire point. Offset 0 because the site lists
 * newest first, so that is where a new posting lands regardless of which page
 * you happen to be reading.
 */
export async function fetchLatestCards({ loc = window.location, fetchImpl = fetch } = {}) {
  return fetchCards(pageUrl(0, loc), fetchImpl, false);
}

/**
 * Put cards the page has never seen at the top of the list.
 *
 * The mirror of mergeCards: same dedupe by job URL, opposite end. Insertion is
 * in reverse so a batch keeps the site's own ordering once it lands, and each
 * card is tagged so the "new since you looked" styling has something to hang
 * off and so a later pass can clear it.
 *
 * @returns {number} how many were added
 */
/**
 * The first listing that comes after `after` in document order.
 *
 * The site puts our control bar and its listings in the same container, and the
 * bar is not first among them - so "the first card" is not necessarily a card
 * below the bar. Anchoring on it once put a new arrival above the bar, and from
 * then on every later arrival anchored on THAT one, so the stack above the bar
 * only ever grew. Asking for the first card after the bar is the version that
 * cannot drift.
 *
 * Null when nothing follows, which callers treat as "append".
 */
function firstCardAfter(container, after) {
  const cards = Array.from(container.querySelectorAll(CARD_SELECTOR));
  if (!after) return cards[0] ?? null;

  return (
    cards.find(
      (card) =>
        after.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ) ?? null
  );
}

export function prependCards(cards, container, doc = document, { after = null } = {}) {
  if (!container) return 0;

  const seen = new Set(
    Array.from(container.querySelectorAll(CARD_SELECTOR), hrefOf).filter(Boolean),
  );

  const fresh = [];
  for (const card of cards) {
    const href = hrefOf(card);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    fresh.push(card);
  }

  /*
   * Anchored to the first listing BELOW our own UI.
   *
   * The site's results container holds the control bar as well as the cards,
   * and the bar is not the first thing in it. Two earlier versions got this
   * wrong in the same direction: container.firstChild put arrivals above
   * everything, and "the first card" put them above the bar as soon as one
   * arrival had landed there - after which each new batch anchored on the
   * previous one and the pile above the bar only grew.
   *
   * `after` is the bar, so the anchor is the first card genuinely beneath it.
   * "Top of the list" means the top of the listings, not the top of the page.
   *
   * No reverse pass: the anchor is fixed, so each insertion lands immediately
   * before it and after the one before, preserving the site's own ordering.
   * (Reversing was only needed while the reference kept moving.) A null anchor
   * appends, which is right when there is nothing to sit on top of.
   */
  const anchor = firstCardAfter(container, after);

  for (const card of fresh) {
    const imported = doc.importNode(card, true);
    imported.setAttribute(IMPORTED_ATTR, '1');
    imported.setAttribute(FRESH_ATTR, '1');
    container.insertBefore(imported, anchor);
  }

  return fresh.length;
}

/** Drop the "new" marking, once you have seen them. */
export function clearFresh(doc = document) {
  for (const card of doc.querySelectorAll(`[${FRESH_ATTR}]`)) card.removeAttribute(FRESH_ATTR);
}
