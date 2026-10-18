/**
 * Named sets of filters.
 *
 * A search on this site is not one field. Looking for automation work means
 * knowing that employers write "n8n", "make.com" and "GHL" rather than
 * "automation", and that the going rate for it is not the going rate for admin
 * work. That knowledge is the thing worth saving, and the thing a newcomer does
 * not have.
 *
 * Measured across 180 live listings: the 27 matching automation vocabulary had
 * a median of $1,230/month against $800 for everything else. The cluster is
 * real, and invisible unless you already know what to type.
 *
 * Only the fields describing *what you are looking for* are captured. How the
 * results look - badges, widths, the sidebar - is a preference that should
 * survive switching between searches, so none of it is stored here.
 */

import { isExperienceFilter } from './experience-level.js';

const STORAGE_KEY = 'ojRateFilterSearches';

/** Long enough for every real workflow, short enough to stay a list. */
export const MAX_SEARCHES = 50;

const MAX_NAME = 60;

/**
 * The settings a saved search carries.
 *
 * Deliberately not the whole settings object: restoring a search should not
 * also undo the display choices you have made since saving it.
 */
export const SEARCH_FIELDS = Object.freeze([
  'thresholdUsdPerMonth',
  'searchKeywords',
  'requiredSkills',
  'excludeKeywords',
  'hiddenJobTypes',
  'maxAgeDays',
  'experienceFilter',
]);

/** Names are compared loosely, so "AI work" and "ai  work" are one entry. */
export function nameKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeFilters(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const filters = {};

  for (const field of SEARCH_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      const list = value
        .map((entry) => String(entry ?? '').trim())
        .filter((entry) => entry.length > 0);
      if (list.length > 0) filters[field] = [...new Set(list)];
    } else if (Number.isFinite(value)) {
      filters[field] = value;
    } else if (field === 'experienceFilter') {
      // 'all' is the absence of a filter, so it is not worth storing.
      if (isExperienceFilter(value) && value !== 'all') filters[field] = value;
    }
  }

  return filters;
}

export function sanitizeSearch(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const name = String(input.name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
  if (name.length === 0) return null;

  return {
    name,
    filters: sanitizeFilters(input.filters),
    savedAt: Number.isFinite(input.savedAt) ? input.savedAt : null,
  };
}

export function sanitizeSearches(raw) {
  if (!Array.isArray(raw)) return [];

  const seen = new Set();
  const searches = [];

  for (const entry of raw) {
    const search = sanitizeSearch(entry);
    if (!search) continue;

    // The first spelling of a name wins, so a corrupted file cannot produce two
    // entries that look identical in the list and behave differently.
    const key = nameKey(search.name);
    if (seen.has(key)) continue;

    seen.add(key);
    searches.push(search);
    if (searches.length >= MAX_SEARCHES) break;
  }

  return searches;
}

/** Lift the searchable half out of a full settings object. */
export function filtersFromSettings(settings) {
  return sanitizeFilters(settings ?? {});
}

/**
 * The settings patch that applying a search produces.
 *
 * Every field is written, including the ones the search left empty - otherwise
 * switching from a narrow search to a broad one would keep the narrow one's
 * excluded keywords and quietly return the wrong results.
 */
export function settingsFromSearch(search, defaults) {
  const filters = sanitizeFilters(search?.filters);
  const patch = {};

  for (const field of SEARCH_FIELDS) {
    const fallback =
      defaults?.[field] ??
      (field === 'thresholdUsdPerMonth' || field === 'maxAgeDays'
        ? 0
        : field === 'experienceFilter'
          ? 'all'
          : []);
    patch[field] = filters[field] ?? fallback;
  }

  return patch;
}

/** "6 terms · $1,000/mo · 2 skills" - enough to tell two searches apart. */
export function describeSearch(search) {
  const filters = search?.filters ?? {};
  const parts = [];

  const terms = filters.searchKeywords?.length ?? 0;
  if (terms > 0) parts.push(`${terms} term${terms === 1 ? '' : 's'}`);

  if (Number.isFinite(filters.thresholdUsdPerMonth)) {
    parts.push(`$${filters.thresholdUsdPerMonth.toLocaleString('en-US')}/mo`);
  }

  const skills = filters.requiredSkills?.length ?? 0;
  if (skills > 0) parts.push(`${skills} skill${skills === 1 ? '' : 's'}`);

  const excluded = filters.excludeKeywords?.length ?? 0;
  if (excluded > 0) parts.push(`${excluded} excluded`);

  if (filters.experienceFilter === 'beginner') parts.push('beginner-friendly');
  else if (filters.experienceFilter === 'not-experienced') parts.push('no experienced-only');

  return parts.join(' · ');
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export async function loadSearches() {
  if (!hasStorage()) return [];
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeSearches(stored?.[STORAGE_KEY]);
}

/**
 * Save under a name, replacing any search already using it.
 *
 * Keyed by name rather than by a generated id: "save this as Automation again"
 * is the ordinary case, and it should overwrite rather than leave two entries
 * called the same thing.
 */
export async function saveSearch(name, filters, now = null) {
  const search = sanitizeSearch({ name, filters, savedAt: now });
  if (!search) return loadSearches();

  const key = nameKey(search.name);
  const rest = (await loadSearches()).filter((entry) => nameKey(entry.name) !== key);
  // Newest first: the one just saved is the one about to be used.
  const next = [search, ...rest].slice(0, MAX_SEARCHES);

  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export async function removeSearch(name) {
  const key = nameKey(name);
  const next = (await loadSearches()).filter((entry) => nameKey(entry.name) !== key);

  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

/** Full replace, for restoring a backup. */
export async function replaceSearches(raw) {
  const next = sanitizeSearches(raw);
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export async function clearSearches() {
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: [] });
  return [];
}

export function onSearchesChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};

  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(sanitizeSearches(changes[STORAGE_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
