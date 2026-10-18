/**
 * How long a job has been going round.
 *
 * `employers.js` catches the same role posted twice on one page. This catches
 * the employer who posts it again every month: a role advertised continuously
 * since March is one that everybody who applied either turned down or left, and
 * that is worth knowing before you spend an evening on the application.
 *
 * Reposts get fresh URLs, so a job key cannot follow them. The signature is the
 * employer and the title with pay discounted - exactly what `findReposts` uses
 * within a page, reused here across sessions.
 *
 * Dates only. No titles, no URLs, no employer names: a record of which jobs you
 * looked at on which days is not something this extension should accumulate,
 * and the signature is all that is needed to recognise the same role again.
 */

import { employerKey, titleKey } from './employers.js';

const STORAGE_KEY = 'ojRateFilterHistory';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/** Below this a repost is just a repost; above it, a pattern. */
export const STALE_WEEKS = 3;

/** Bounded like every other store here; the least recently seen go first. */
export const MAX_ENTRIES = 4000;

/** Older than this and it is no longer the same hiring round. */
export const FORGET_AFTER_MS = 180 * MS_PER_DAY;

/**
 * The key a listing is tracked under.
 *
 * @returns {string|null} null when there is not enough to identify it - an
 *   employer is required, since identical generic titles from different people
 *   are different jobs
 */
export function signatureOf(listing) {
  const employer = employerKey(listing?.employer);
  const title = titleKey(listing?.title);
  if (employer.length === 0 || title.length === 0) return null;

  return `${employer} ${title}`;
}

export function sanitizeHistory(raw, now = Date.now()) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const entries = [];

  for (const [key, value] of Object.entries(input)) {
    if (!key || !value || typeof value !== 'object') continue;

    const first = Number(value.first);
    const last = Number(value.last);
    if (!Number.isFinite(first) || !Number.isFinite(last)) continue;
    if (now - last > FORGET_AFTER_MS) continue;

    entries.push([
      String(key).slice(0, 200),
      {
        first: Math.min(first, last),
        last,
        seen: Number.isFinite(value.seen) && value.seen > 0 ? Math.floor(value.seen) : 1,
      },
    ]);
  }

  // Most recently seen kept: a job you are still being shown matters more than
  // one that stopped appearing months ago.
  entries.sort((a, b) => b[1].last - a[1].last);
  return Object.fromEntries(entries.slice(0, MAX_ENTRIES));
}

/**
 * Fold a page of listings into the history. Pure - returns new history.
 *
 * `seen` counts passes rather than sightings within a pass, so a page holding
 * three copies of one role does not treble the count.
 */
export function recordSightings(history, listings, now = Date.now()) {
  const next = { ...(history ?? {}) };
  const already = new Set();

  for (const listing of listings ?? []) {
    const key = signatureOf(listing);
    if (key === null || already.has(key)) continue;
    already.add(key);

    const entry = next[key];
    next[key] = entry
      ? { first: Math.min(entry.first, now), last: now, seen: entry.seen + 1 }
      : { first: now, last: now, seen: 1 };
  }

  return sanitizeHistory(next, now);
}

/**
 * How long this job has been advertised, in whole weeks.
 *
 * @returns {number|null} null when it has not been seen before, or is too
 *   recent to say anything about
 */
export function weeksAdvertised(history, listing, now = Date.now()) {
  const key = signatureOf(listing);
  if (key === null) return null;

  const entry = history?.[key];
  if (!entry || !Number.isFinite(entry.first)) return null;

  const weeks = Math.floor((now - entry.first) / MS_PER_WEEK);
  return weeks > 0 ? weeks : null;
}

/** Wording for a job that has been going round, or '' for an ordinary one. */
export function describeStaleness(weeks, staleWeeks = STALE_WEEKS) {
  if (!Number.isFinite(weeks) || weeks < staleWeeks) return '';

  const months = Math.floor(weeks / 4);
  return months >= 2 ? `advertised ${months} months` : `advertised ${weeks} weeks`;
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export async function loadHistory(now = Date.now()) {
  if (!hasStorage()) return {};
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeHistory(stored?.[STORAGE_KEY], now);
}

/**
 * Fold a page in, re-reading first.
 *
 * Same shape as every other store here: a results page stays open a long time
 * and the whole record is rewritten on save, so writing from a snapshot taken
 * at page load would discard whatever another tab learned meanwhile. Writes are
 * chained so two overlapping passes cannot both read the same base.
 */
let pendingWrite = Promise.resolve();

export function recordPage(listings, now = Date.now()) {
  pendingWrite = pendingWrite
    .catch(() => {})
    .then(async () => {
      const next = recordSightings(await loadHistory(now), listings, now);
      if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: next });
      return next;
    });

  return pendingWrite;
}

export async function clearHistory() {
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: {} });
  return {};
}
