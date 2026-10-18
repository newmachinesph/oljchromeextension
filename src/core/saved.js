/**
 * Jobs you have set aside to come back to.
 *
 * Dismissing a listing says "not this one". Saving one says the opposite: worth
 * a second look, later, when you have time to write a proper application. On a
 * merged list of several hundred that scrolls past once, a bookmark is the only
 * way a good posting survives to tomorrow.
 *
 * Like applications, this keeps a small snapshot rather than a bare key - title,
 * link, employer, the pay the modal showed - so the Saved list can stand on its
 * own without the job still being on the page.
 *
 * chrome.storage.local, like the other job stores: a local log that grows, and
 * sync caps a single item at 8KB.
 */

import { jobKey } from './dismissed.js';
import { cleanUrl } from './safe-url.js';
import { createQueue } from './queue.js';

const STORAGE_KEY = 'ojRateFilterSaved';

/** All writes to this store run one at a time, so none clobbers another. */
const writes = createQueue();

/** How many to remember, oldest saved dropped first. */
export const MAX_SAVED = 2000;

/**
 * One saved job, as stored.
 *
 * @typedef {{savedAt: number, title: string, url: string, employer: string,
 *   usdPerMonth: number|null}} SavedJob
 */

function sanitizeRecord(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    savedAt: Number.isFinite(raw.savedAt) ? raw.savedAt : now,
    title: String(raw.title ?? '').slice(0, 200),
    url: cleanUrl(raw.url),
    employer: String(raw.employer ?? '').slice(0, 200),
    usdPerMonth: Number.isFinite(raw.usdPerMonth) ? raw.usdPerMonth : null,
  };
}

/**
 * Coerce whatever storage held into a map every caller can trust.
 *
 * Over the cap the oldest saves are dropped first - if you saved it months ago
 * and never came back, it is the least likely to still matter.
 */
export function sanitizeSaved(raw, now = 0, max = MAX_SAVED) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map();

  const entries = [];
  for (const [key, value] of Object.entries(raw)) {
    const id = String(key).trim();
    if (id.length === 0 || id.length > 120) continue;

    const record = sanitizeRecord(value, now);
    if (record) entries.push([id, record]);
  }

  if (entries.length > max) {
    entries.sort((a, b) => a[1].savedAt - b[1].savedAt);
    entries.splice(0, entries.length - max);
  }

  return new Map(entries);
}

function toStored(saved) {
  return Object.fromEntries(saved);
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

/** Read the current map, sanitised. Reads do not need the write queue. */
async function readMap() {
  if (!hasStorage()) return new Map();
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeSaved(stored?.[STORAGE_KEY]);
}

/** Bound, persist (when there is storage), and return the map. */
async function commit(map, now = Date.now()) {
  const bounded = sanitizeSaved(toStored(map), now);
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: toStored(bounded) });
  return bounded;
}

/** @returns {Promise<Map<string, SavedJob>>} */
export async function loadSaved() {
  return readMap();
}

/**
 * Save a job, or - when it is already saved - refresh its snapshot without
 * moving `savedAt`, so the position in the list stays put.
 *
 * @returns {Promise<Map<string, SavedJob>>}
 */
export function setSaved(key, { title, url, employer, usdPerMonth } = {}) {
  if (!key || !hasStorage()) return loadSaved();
  return writes(async () => {
    const now = Date.now();
    const saved = await readMap();
    const existing = saved.get(key);
    saved.set(key, {
      savedAt: existing?.savedAt ?? now,
      title: String(title ?? existing?.title ?? '').slice(0, 200),
      url: String(url ?? existing?.url ?? '').slice(0, 300),
      employer: String(employer ?? existing?.employer ?? '').slice(0, 200),
      usdPerMonth: Number.isFinite(usdPerMonth) ? usdPerMonth : (existing?.usdPerMonth ?? null),
    });
    return commit(saved, now);
  });
}

/** Un-save one - you dealt with it, or changed your mind. */
export function removeSaved(key) {
  if (!key || !hasStorage()) return loadSaved();
  return writes(async () => {
    const saved = await readMap();
    if (!saved.delete(key)) return saved;
    return commit(saved);
  });
}

/**
 * Save if not saved, un-save if saved. What a bookmark toggle actually needs.
 * One queued read-decide-write, so a rapid double-tap cannot leave it half-set.
 * @returns {Promise<{saved: Map<string, SavedJob>, isSaved: boolean}>}
 */
export function toggleSaved(key, { title, url, employer, usdPerMonth } = {}) {
  if (!key || !hasStorage()) return loadSaved().then((saved) => ({ saved, isSaved: false }));
  return writes(async () => {
    const now = Date.now();
    const saved = await readMap();
    if (saved.has(key)) {
      saved.delete(key);
      return { saved: await commit(saved, now), isSaved: false };
    }
    saved.set(key, {
      savedAt: now,
      title: String(title ?? '').slice(0, 200),
      url: String(url ?? '').slice(0, 300),
      employer: String(employer ?? '').slice(0, 200),
      usdPerMonth: Number.isFinite(usdPerMonth) ? usdPerMonth : null,
    });
    return { saved: await commit(saved, now), isSaved: true };
  });
}

/** Replace the whole store, for a restore. */
export function replaceSaved(raw) {
  return writes(async () => {
    const map = sanitizeSaved(raw instanceof Map ? Object.fromEntries(raw) : raw, Date.now());
    return commit(map);
  });
}

export function clearSaved() {
  return writes(async () => {
    if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: {} });
    return new Map();
  });
}

/** Subscribe to changes from anywhere - another tab, or the options page. */
export function onSavedChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};

  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(sanitizeSaved(changes[STORAGE_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export { jobKey };
