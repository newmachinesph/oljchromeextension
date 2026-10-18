/**
 * Pages we already fetched, remembered for the length of a tab.
 *
 * Ten search terms over five pages is fifty requests. Without this, every
 * refresh made all fifty again - and a signed-in account making fifty requests
 * each time someone presses F5 is exactly the pattern a site rate-limits.
 *
 * sessionStorage rather than chrome.storage on purpose. It survives a reload,
 * which is the case worth solving, and dies with the tab, which means the cache
 * can never be the reason you fail to see a job posted this morning.
 *
 * The page you actually navigated to is never cached here: that HTML comes from
 * the server as the ordinary page load. Only the extra pages the fan-out
 * fetches are stored, so new postings still appear immediately on the first
 * page while the merged tail comes back for free.
 */

const PREFIX = 'ojrf:page:';

/** Long enough to cover a session of reading, short enough to stay current. */
export const CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Roughly 3MB of card markup. sessionStorage is usually good for 5-10MB per
 * origin, and we would rather evict early than have writes start failing.
 */
export const MAX_CACHE_CHARS = 3_000_000;

function store() {
  try {
    // Access can throw outright when storage is disabled by policy.
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function keysOf(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  return keys;
}

/** Every entry, newest first, with the space it takes. */
function entries(storage) {
  const list = [];

  for (const key of keysOf(storage)) {
    const raw = storage.getItem(key);
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      list.push({ key, at: Number(parsed.at) || 0, size: raw.length });
    } catch {
      // Unreadable entries are ours and worthless; drop them on sight.
      storage.removeItem(key);
    }
  }

  return list.sort((a, b) => b.at - a.at);
}

/** Drop the oldest until the cache is under the limit. */
function evictTo(storage, limit) {
  const list = entries(storage);
  let total = list.reduce((sum, entry) => sum + entry.size, 0);

  while (total > limit && list.length > 0) {
    const oldest = list.pop();
    storage.removeItem(oldest.key);
    total -= oldest.size;
  }
}

/**
 * The markup previously stored for a URL, if it is still fresh.
 *
 * @returns {string|null}
 */
export function readCached(url, now = Date.now(), ttl = CACHE_TTL_MS) {
  const storage = store();
  if (!storage) return null;

  const key = PREFIX + url;
  const raw = storage.getItem(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.html !== 'string') return null;

    if (now - (Number(parsed.at) || 0) > ttl) {
      storage.removeItem(key);
      return null;
    }

    return parsed.html;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

/**
 * Remember a page's markup.
 *
 * Never throws. A cache that fails is a slower extension; a cache that throws
 * is a broken one, and this sits directly in the fetch path.
 *
 * @returns {boolean} whether it was stored
 */
export function writeCached(url, html, now = Date.now()) {
  const storage = store();
  if (!storage || typeof html !== 'string' || html.length === 0) return false;

  const key = PREFIX + url;
  const raw = JSON.stringify({ at: now, html });

  // A single page bigger than the whole budget is not worth evicting the rest
  // of the cache to hold.
  if (raw.length > MAX_CACHE_CHARS) return false;

  try {
    evictTo(storage, MAX_CACHE_CHARS - raw.length);
    storage.setItem(key, raw);
    return true;
  } catch {
    // Out of quota despite the eviction, or storage refused the write. Clear
    // what is ours and try once more before giving up.
    try {
      clearCache();
      storage.setItem(key, raw);
      return true;
    } catch {
      return false;
    }
  }
}

/** How much is held, for the bar to report and for tests to assert on. */
export function cacheStats(now = Date.now(), ttl = CACHE_TTL_MS) {
  const storage = store();
  if (!storage) return { pages: 0, chars: 0, fresh: 0 };

  const list = entries(storage);

  return {
    pages: list.length,
    chars: list.reduce((sum, entry) => sum + entry.size, 0),
    fresh: list.filter((entry) => now - entry.at <= ttl).length,
  };
}

/** Forget every page, so the next load genuinely refetches. */
export function clearCache() {
  const storage = store();
  if (!storage) return 0;

  const keys = keysOf(storage);
  for (const key of keys) storage.removeItem(key);
  return keys.length;
}
