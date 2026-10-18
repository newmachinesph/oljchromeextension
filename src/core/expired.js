/**
 * Jobs the site has deleted.
 *
 * A merged list is assembled from pages fetched at different moments, and the
 * site keeps serving links to posts that are gone - opening one answers HTTP
 * 410 and "Job No Longer Posted". Once we know that, the listing should never
 * take up a row again.
 *
 * Kept apart from the dismissed list on purpose. Both collapse a listing, but
 * one is a decision you made and can undo, and the other is a fact about the
 * world that undoing would not change. Conflating them would make "restore"
 * promise something it cannot deliver.
 */

import { addKey, sanitizeList, jobKey } from './dismissed.js';

const STORAGE_KEY = 'ojRateFilterExpired';

export const MAX_EXPIRED = 5000;

/** The page the site serves in place of a deleted post. */
const GONE_TEXT =
  /job no longer posted|has been deleted|no longer available|job has been closed/i;

/**
 * Is this document the site's "gone" page rather than a job?
 *
 * Checked on the text as well as the status, because a response served from
 * cache, or a redirect, can answer 200 and still be the tombstone page.
 *
 * @param {Document|null} doc
 * @param {number} status HTTP status, 0 when unknown
 */
export function isGone(doc, status = 0) {
  if (status === 410 || status === 404) return true;
  if (!doc) return false;

  const heading = doc.querySelector('h1, h2, h3');
  if (heading && GONE_TEXT.test(heading.textContent)) return true;

  // Bounded slice: a real posting could mention the phrase somewhere in its
  // description, but the tombstone says it at the top of the page.
  return GONE_TEXT.test(String(doc.body?.textContent ?? '').slice(0, 1200));
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export async function loadExpiredList() {
  if (!hasStorage()) return [];
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeList(stored?.[STORAGE_KEY], MAX_EXPIRED);
}

/** @returns {Promise<Set<string>>} */
export async function loadExpired() {
  return new Set(await loadExpiredList());
}

/**
 * Record that a job is gone.
 * @returns {Promise<Set<string>>} the updated set
 */
export async function markExpired(key) {
  if (!key || !hasStorage()) return loadExpired();

  const current = await loadExpiredList();
  if (current.includes(key)) return new Set(current);

  const next = addKey(current, key, MAX_EXPIRED);
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return new Set(next);
}

/** Replace the whole list, for a restore. */
export async function replaceExpired(raw) {
  const next = sanitizeList(raw, MAX_EXPIRED);
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return new Set(next);
}

export async function clearExpired() {
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: [] });
  return new Set();
}

export function onExpiredChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};

  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(new Set(sanitizeList(changes[STORAGE_KEY].newValue, MAX_EXPIRED)));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export { jobKey };
