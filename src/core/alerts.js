/**
 * Alerts for saved searches: what has been seen, and what is new.
 *
 * The service worker re-runs the first page of each watched search on a timer
 * and counts the job links it has not seen before. This module is everything
 * about that which does not need a network or a DOM: which searches are
 * watched, how job keys are read out of raw HTML, how a run's findings are
 * diffed against memory, and the state kept between runs.
 *
 * Honest about its limits. A worker has no DOM, so nothing here parses a rate
 * - "new" means a new listing for those keywords, not one that clears the
 * search's rate floor. The page still filters the moment it opens.
 *
 * Opt-in, and bounded: at most MAX_WATCHED searches, the first page of each,
 * a memory of MAX_SEEN keys per search. Off by default.
 */

import { jobKey } from './dismissed.js';
import { nameKey } from './saved-searches.js';

export const ALERTS_KEY = 'ojRateFilterAlerts';

/** The alarm's name, shared with the worker that listens for it. */
export const ALARM_NAME = 'ojrf-alerts';

/** How many saved searches a tick may re-run. */
export const MAX_WATCHED = 10;

/** Keys remembered per search. A first page holds 30, so this is ten pages. */
export const MAX_SEEN = 300;

/** In minutes. Three hours is the default: often enough to be useful, rarely
 *  enough to be a burden on anyone. */
export const ALERT_INTERVALS = Object.freeze([
  { value: 60, label: 'Every hour' },
  { value: 180, label: 'Every 3 hours' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Twice a day' },
  { value: 1440, label: 'Once a day' },
]);

export function isAlertInterval(value) {
  return ALERT_INTERVALS.some((entry) => entry.value === value);
}

/**
 * The searches worth re-running: those that search for something. A search
 * that is only a rate floor has nothing to fetch. Alphabetical, so which ten
 * are watched is predictable and the options page can say.
 */
export function watchedSearches(searches, max = MAX_WATCHED) {
  if (!Array.isArray(searches)) return [];
  return searches
    .filter((search) => Array.isArray(search?.filters?.searchKeywords))
    .filter((search) => search.filters.searchKeywords.length > 0)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .slice(0, max);
}

/**
 * Every job key linked from a page of results, read without a DOM.
 *
 * A regex over href attributes is fragile in general and fine here: the job
 * link shape is the one thing this extension already depends on everywhere,
 * and jobKey() does the actual reading. Anything that is not a job link falls
 * out as null.
 */
export function jobKeysFromHtml(html) {
  const keys = new Set();
  const source = String(html ?? '');
  if (source.length === 0) return keys;

  const pattern = /href\s*=\s*["']([^"']*\/jobseekers\/job\/[^"']+)["']/gi;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const key = jobKey(match[1]);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * What is new, given what was seen before.
 *
 * The first run is a baseline: everything found is remembered and nothing is
 * reported, so turning alerts on does not announce thirty "new" listings that
 * were there all along. Memory is kept newest-last and capped; an empty fetch
 * forgets nothing, since a failed page is not an empty board.
 *
 * @returns {{newKeys: string[], seen: string[], baseline: boolean}}
 */
export function diffSeen(previousSeen, found, { max = MAX_SEEN } = {}) {
  const before = Array.isArray(previousSeen) ? previousSeen.filter(Boolean) : [];
  const baseline = before.length === 0;
  const known = new Set(before);

  const newKeys = [];
  for (const key of found ?? []) {
    if (!known.has(key)) newKeys.push(key);
  }

  const seen = [...before, ...newKeys];
  return {
    newKeys: baseline ? [] : newKeys,
    seen: seen.length > max ? seen.slice(seen.length - max) : seen,
    baseline,
  };
}

function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const seen = Array.isArray(raw.seen) ? raw.seen.filter((key) => typeof key === 'string') : [];
  return {
    seen: seen.slice(-MAX_SEEN),
    newCount: Number.isFinite(raw.newCount) && raw.newCount > 0 ? Math.floor(raw.newCount) : 0,
    checkedAt: Number.isFinite(raw.checkedAt) ? raw.checkedAt : null,
    lastError: typeof raw.lastError === 'string' ? raw.lastError.slice(0, 200) : '',
  };
}

/**
 * @typedef {{seen: string[], newCount: number, checkedAt: number|null, lastError: string}} SearchAlert
 * @typedef {{bySearch: Record<string, SearchAlert>, checkedAt: number|null}} AlertState
 */

/** @returns {AlertState} */
export function sanitizeAlertState(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const bySearch = {};

  if (input.bySearch && typeof input.bySearch === 'object' && !Array.isArray(input.bySearch)) {
    for (const [rawName, value] of Object.entries(input.bySearch)) {
      const key = nameKey(rawName);
      if (key.length === 0) continue;
      const entry = sanitizeEntry(value);
      if (entry) bySearch[key] = entry;
    }
  }

  return {
    bySearch,
    checkedAt: Number.isFinite(input.checkedAt) ? input.checkedAt : null,
  };
}

/** How many new listings the popup should announce, across every search. */
export function totalNew(state) {
  return Object.values(state?.bySearch ?? {}).reduce((sum, entry) => sum + (entry.newCount ?? 0), 0);
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

/** @returns {Promise<AlertState>} */
export async function loadAlertState() {
  if (!hasStorage()) return sanitizeAlertState(null);
  const stored = await chrome.storage.local.get(ALERTS_KEY);
  return sanitizeAlertState(stored?.[ALERTS_KEY]);
}

/** @returns {Promise<AlertState>} */
export async function saveAlertState(state) {
  const clean = sanitizeAlertState(state);
  if (hasStorage()) await chrome.storage.local.set({ [ALERTS_KEY]: clean });
  return clean;
}

/** You opened that search: its count goes back to nothing, its memory stays. */
export async function clearNewCount(name) {
  const state = await loadAlertState();
  const entry = state.bySearch[nameKey(name)];
  if (entry) entry.newCount = 0;
  return saveAlertState(state);
}

export async function clearAllNew() {
  const state = await loadAlertState();
  for (const entry of Object.values(state.bySearch)) entry.newCount = 0;
  return saveAlertState(state);
}

export async function clearAlertState() {
  return saveAlertState(null);
}

/**
 * Prefix for the alert notification's id. Everything after it is the url a
 * click should open, or empty when there is no single right destination.
 *
 * The destination rides in the id because a click can arrive long after the
 * worker that posted the notification has been shut down, and any variable it
 * set is gone by then.
 */
export const NOTIFICATION_PREFIX = 'ojrf-alert:';

/**
 * One line saying what a check turned up.
 *
 * `arrivals` is `{ name, count, url }` per search that gained something. One
 * sentence for all of them, never one per search: three searches turning up a
 * job each is one thing that happened, not three.
 */
export function alertMessage(arrivals) {
  const list = Array.isArray(arrivals) ? arrivals.filter((entry) => entry?.count > 0) : [];
  if (list.length === 0) return '';

  const total = list.reduce((sum, entry) => sum + entry.count, 0);
  const jobs = `${total} new job${total === 1 ? '' : 's'}`;

  return list.length === 1
    ? `${jobs} for "${list[0].name}"`
    : `${jobs} across ${list.length} saved searches`;
}

/**
 * The notification id for a set of arrivals, carrying where a click should go.
 *
 * One search means one obvious destination - that search. More than one has no
 * single right answer, so the id carries nothing and the click falls back to
 * the settings page, which lists every watched search and its count.
 */
export function notificationId(arrivals) {
  const list = Array.isArray(arrivals) ? arrivals.filter((entry) => entry?.count > 0) : [];
  const target = list.length === 1 ? (list[0].url ?? '') : '';
  return `${NOTIFICATION_PREFIX}${target}`;
}

/** The url an alert notification's id points at, or '' for none. */
export function notificationTarget(id) {
  const text = String(id ?? '');
  return text.startsWith(NOTIFICATION_PREFIX) ? text.slice(NOTIFICATION_PREFIX.length) : '';
}

/** Subscribe to changes from anywhere - the worker, the popup, the options page. */
export function onAlertStateChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};

  const listener = (changes, area) => {
    if (area !== 'local' || !changes[ALERTS_KEY]) return;
    callback(sanitizeAlertState(changes[ALERTS_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
