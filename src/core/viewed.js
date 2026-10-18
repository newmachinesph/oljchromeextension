/**
 * Listings you have already opened.
 *
 * Dismissing says "no". Viewing says nothing about the job - only that you have
 * seen it. On a list you scan daily, hiding what you have already read leaves
 * just the genuinely new, which is the whole point of merging pages together.
 *
 * A bare set of keys, like dismissed: there is no state to a view, only whether
 * it happened. chrome.storage.local, because it grows without bound and is
 * purely local history.
 */

import { jobKey, addKey, removeKey, sanitizeList } from './dismissed.js';
import { createQueue } from './queue.js';

const STORAGE_KEY = 'ojRateFilterViewed';

/** All writes to this store run one at a time, so none clobbers another. */
const writes = createQueue();

/** Well past a year of heavy use, and cheap to read on every page load. */
export const MAX_VIEWED = 8000;

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

/** @returns {Promise<string[]>} in view order, oldest first */
export async function loadViewedList() {
  if (!hasStorage()) return [];
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeList(stored?.[STORAGE_KEY], MAX_VIEWED);
}

/** @returns {Promise<Set<string>>} for the O(1) lookups the filter does */
export async function loadViewed() {
  return new Set(await loadViewedList());
}

/**
 * Mark one listing viewed, or - rarely - un-view it.
 * @returns {Promise<Set<string>>} the updated set
 */
export function setViewed(key, viewed = true) {
  if (!key || !hasStorage()) return loadViewed();
  return writes(async () => {
    const current = await loadViewedList();
    const next = viewed ? addKey(current, key, MAX_VIEWED) : removeKey(current, key);
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return new Set(next);
  });
}

/** Replace the whole list, for a restore. */
export function replaceViewed(raw) {
  return writes(async () => {
    const next = sanitizeList(raw, MAX_VIEWED);
    if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return new Set(next);
  });
}

export function clearViewed() {
  return writes(async () => {
    if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: [] });
    return new Set();
  });
}

/** Subscribe to changes from anywhere - another tab, or the options page. */
export function onViewedChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};

  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(new Set(sanitizeList(changes[STORAGE_KEY].newValue, MAX_VIEWED)));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export { jobKey, sanitizeList };
