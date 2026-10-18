/**
 * Listings you have already looked at and decided against.
 *
 * At 30 a page you remember what you have seen. At 300 merged across five pages
 * and four searches you do not, and the same job you rejected on Monday is back
 * at the top on Tuesday. Dismissing one records it, and it stays collapsed on
 * every later visit - which is what turns a filter into a triage tool.
 *
 * Kept in chrome.storage.local, not sync: this list grows to thousands of
 * entries, and sync caps a single item at 8KB. It is also genuinely local -
 * what you have read on this machine, not a preference worth carrying about.
 */

const STORAGE_KEY = 'ojRateFilterDismissed';

/**
 * How many to remember. Well past a year of heavy use, and small enough that
 * the whole list stays a cheap read on every page load.
 */
export const MAX_DISMISSED = 5000;

/** Job URLs end in the numeric job id, which outlives any title edit. */
const JOB_PATH = /\/jobseekers\/job\/(.+)$/i;
const TRAILING_ID = /(\d+)$/;

/**
 * A stable key for a listing, from its job link.
 *
 * Prefers the trailing job id over the whole slug: the slug carries the title,
 * and an employer editing their title would otherwise resurrect a job you had
 * already dismissed.
 *
 * @param {string|null|undefined} href
 * @returns {string|null} null when the link is not a job link
 */
export function jobKey(href) {
  if (!href) return null;

  const path = String(href).split(/[?#]/)[0].replace(/\/+$/, '');
  const match = JOB_PATH.exec(path);
  if (!match) return null;

  const slug = match[1].trim();
  if (slug.length === 0) return null;

  const id = TRAILING_ID.exec(slug);
  return id ? id[1] : slug.toLowerCase();
}

/**
 * Add a key, newest last, bounded.
 *
 * Re-adding an existing key moves it to the end rather than duplicating it, so
 * the cap always drops the least recently dismissed.
 */
export function addKey(list, key, max = MAX_DISMISSED) {
  const without = list.filter((entry) => entry !== key);
  without.push(key);
  return without.length > max ? without.slice(without.length - max) : without;
}

export function removeKey(list, key) {
  return list.filter((entry) => entry !== key);
}

/** Coerce whatever storage handed back into a clean list of keys. */
export function sanitizeList(raw, max = MAX_DISMISSED) {
  if (!Array.isArray(raw)) return [];
  const cleaned = raw
    .map((entry) => String(entry ?? '').trim())
    .filter((entry) => entry.length > 0 && entry.length <= 120);
  const unique = [...new Set(cleaned)];
  return unique.length > max ? unique.slice(unique.length - max) : unique;
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

/** @returns {Promise<string[]>} in dismissal order, oldest first */
export async function loadDismissedList() {
  if (!hasStorage()) return [];
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeList(stored?.[STORAGE_KEY]);
}

/** @returns {Promise<Set<string>>} for the O(1) lookups the filter does per pass */
export async function loadDismissed() {
  return new Set(await loadDismissedList());
}

/**
 * Mark one listing dismissed, or bring it back.
 * @returns {Promise<Set<string>>} the updated set
 */
export async function setDismissed(key, dismissed) {
  if (!key || !hasStorage()) return loadDismissed();

  const current = await loadDismissedList();
  const next = dismissed ? addKey(current, key) : removeKey(current, key);

  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return new Set(next);
}

/** Replace the whole list, for a restore. */
export async function replaceDismissed(raw) {
  const next = sanitizeList(raw);
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return new Set(next);
}

export async function clearDismissed() {
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: [] });
  return new Set();
}

/**
 * Subscribe to changes from anywhere - another tab, or the options page.
 * Returns an unsubscribe function.
 */
export function onDismissedChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};

  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(new Set(sanitizeList(changes[STORAGE_KEY].newValue)));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
