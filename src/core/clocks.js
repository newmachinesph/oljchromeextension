/**
 * World clocks - what time it is where your client is.
 *
 * A Filipino jobseeker's whole day bends around someone else's timezone. "Must
 * overlap US mornings" means nothing until you can see that US morning next to
 * your own clock. Employers ask "can you do a call at 9am my time"; this is how
 * you answer without arithmetic.
 *
 * Nothing here needs a network or a timezone database: Intl.DateTimeFormat has
 * every IANA zone the browser knows, and it handles daylight saving for us -
 * which is exactly the part people get wrong by hand.
 *
 * An ordered array of { id, label, timeZone }. chrome.storage.sync, because it
 * is a handful of short strings and it should follow you between machines.
 */

import { createQueue } from './queue.js';

const STORAGE_KEY = 'ojRateFilterClocks';

/** All writes to this store run one at a time, so none clobbers another. */
const writes = createQueue();

export const MAX_CLOCKS = 12;
export const MAX_LABEL = 40;

/**
 * The zones worth offering first.
 *
 * Chosen from where OnlineJobs.ph employers actually are - the US coasts,
 * Australia, the UK - plus Manila itself, since a clock you can compare
 * against is the point. The full IANA list is still accepted; this is only
 * what the picker suggests.
 */
export const COMMON_ZONES = [
  { timeZone: 'Asia/Manila', label: 'Manila' },
  { timeZone: 'America/Los_Angeles', label: 'Los Angeles' },
  { timeZone: 'America/Denver', label: 'Denver' },
  { timeZone: 'America/Chicago', label: 'Chicago' },
  { timeZone: 'America/New_York', label: 'New York' },
  { timeZone: 'America/Toronto', label: 'Toronto' },
  { timeZone: 'Europe/London', label: 'London' },
  { timeZone: 'Europe/Dublin', label: 'Dublin' },
  { timeZone: 'Europe/Amsterdam', label: 'Amsterdam' },
  { timeZone: 'Europe/Berlin', label: 'Berlin' },
  { timeZone: 'Asia/Dubai', label: 'Dubai' },
  { timeZone: 'Asia/Singapore', label: 'Singapore' },
  { timeZone: 'Asia/Hong_Kong', label: 'Hong Kong' },
  { timeZone: 'Asia/Tokyo', label: 'Tokyo' },
  { timeZone: 'Asia/Seoul', label: 'Seoul' },
  { timeZone: 'Australia/Perth', label: 'Perth' },
  { timeZone: 'Australia/Brisbane', label: 'Brisbane' },
  { timeZone: 'Australia/Sydney', label: 'Sydney' },
  { timeZone: 'Pacific/Auckland', label: 'Auckland' },
];

/** What we start you with: home, and the two coasts most posts are written from. */
export const DEFAULT_CLOCKS = [
  { id: 'home', label: 'Manila', timeZone: 'Asia/Manila' },
  { id: 'us-e', label: 'New York', timeZone: 'America/New_York' },
  { id: 'us-w', label: 'Los Angeles', timeZone: 'America/Los_Angeles' },
];

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : `${Date.now()}`;
}

/**
 * Does the runtime know this zone?
 *
 * Intl throws a RangeError on an unknown zone, and that throw is the only
 * reliable check - there is no list to consult. Catching it here keeps one bad
 * saved zone from taking the whole panel down.
 */
export function isValidZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/** The browser's own zone, so a first clock can be yours without asking. */
export function localZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** "America/New_York" reads as "New York" - the label people would have typed. */
export function zoneCity(timeZone) {
  const tail = String(timeZone ?? '').split('/').pop() ?? '';
  return tail.replace(/_/g, ' ') || 'UTC';
}

/** Coerce whatever storage held into clocks we can render. Bad zones drop. */
export function sanitizeClocks(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const timeZone = String(entry.timeZone ?? '').trim();
    if (!isValidZone(timeZone)) continue;
    const id = String(entry.id ?? '').trim().slice(0, 40) || newId();
    if (seen.has(id)) continue;
    const label =
      String(entry.label ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL) ||
      zoneCity(timeZone);
    seen.add(id);
    out.push({ id, label, timeZone });
    if (out.length >= MAX_CLOCKS) break;
  }
  return out;
}

const timeFormats = new Map();

function formatter(timeZone, options) {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let found = timeFormats.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', { timeZone, ...options });
    timeFormats.set(key, found);
  }
  return found;
}

/** The hour, 0-23, in that zone - the number the rest of this file reasons on. */
export function hourIn(timeZone, at = Date.now()) {
  const date = at instanceof Date ? at : new Date(at);
  const text = formatter(timeZone, { hour: 'numeric', hour12: false }).format(date);
  // An h23 cycle can render midnight as "24"; fold it back to 0.
  return Number(text) % 24;
}

/**
 * Roughly, is it dark there?
 *
 * Only used to tint a clock face, so a fixed 21:00-06:59 window is honest
 * enough - the alternative is a sunrise table for every latitude, to decide a
 * background colour.
 */
export function isNight(timeZone, at = Date.now()) {
  const hour = hourIn(timeZone, at);
  return hour >= 21 || hour < 7;
}

/** A sortable calendar day in that zone, as YYYY-MM-DD. */
function civilDay(timeZone, date) {
  const parts = formatter(timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** -1, 0 or +1: is `timeZone` on yesterday, today, or tomorrow, next to `from`? */
export function dayDelta(timeZone, from, at = Date.now()) {
  const date = at instanceof Date ? at : new Date(at);
  const there = civilDay(timeZone, date);
  const here = civilDay(from, date);
  if (there === here) return 0;
  return there < here ? -1 : 1;
}

/** "GMT+8", the way people write it in a job post. */
export function offsetLabel(timeZone, at = Date.now()) {
  const date = at instanceof Date ? at : new Date(at);
  try {
    const parts = formatter(timeZone, { timeZoneName: 'shortOffset' }).formatToParts(date);
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  } catch {
    return '';
  }
}

/**
 * Everything one clock face needs, for a given instant.
 *
 * `dayDelta` is what makes this useful rather than decorative: -1 means that
 * city is still on yesterday, +1 that it is already tomorrow. That is the fact
 * that trips people up when they agree to a Monday call.
 *
 * @param {string} timeZone an IANA zone
 * @param {number|Date} at the instant to read
 * @param {{hour12?: boolean, from?: string}} [options] `from` is the zone the
 *   day difference is measured against; defaults to the browser's own.
 */
export function readClock(timeZone, at = Date.now(), { hour12 = true, from } = {}) {
  const date = at instanceof Date ? at : new Date(at);
  if (!isValidZone(timeZone) || Number.isNaN(date.getTime())) return null;

  const here = from && isValidZone(from) ? from : localZone();
  return {
    timeZone,
    time: formatter(timeZone, { hour: 'numeric', minute: '2-digit', hour12 }).format(date),
    weekday: formatter(timeZone, { weekday: 'short' }).format(date),
    day: formatter(timeZone, { month: 'short', day: 'numeric' }).format(date),
    offsetLabel: offsetLabel(timeZone, date),
    dayDelta: dayDelta(timeZone, here, date),
    isNight: isNight(timeZone, date),
  };
}

/**
 * The hours where both zones are inside working hours.
 *
 * The question behind "can we overlap" - answered as a list of hours in *your*
 * zone, which is the only frame in which you can actually commit to anything.
 *
 * @returns {Array<{hourHere:number, hourThere:number}>}
 */
export function overlapHours(here, there, { start = 9, end = 18, at = Date.now() } = {}) {
  if (!isValidZone(here) || !isValidZone(there)) return [];
  const base = at instanceof Date ? at.getTime() : at;
  const out = [];
  for (let step = 0; step < 24; step += 1) {
    const instant = base + step * 3600_000;
    const hourHere = hourIn(here, instant);
    const hourThere = hourIn(there, instant);
    if (hourHere >= start && hourHere < end && hourThere >= start && hourThere < end) {
      out.push({ hourHere, hourThere });
    }
  }
  return out.sort((a, b) => a.hourHere - b.hourHere);
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.sync);
}

async function read() {
  if (!hasStorage()) return sanitizeClocks(DEFAULT_CLOCKS);
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  // Never stored yet is different from stored-as-empty: the first is a new
  // reader who should get the defaults, the second is one who removed them all.
  if (stored?.[STORAGE_KEY] === undefined) return sanitizeClocks(DEFAULT_CLOCKS);
  return sanitizeClocks(stored[STORAGE_KEY]);
}

async function commit(list) {
  const clean = sanitizeClocks(list);
  if (hasStorage()) await chrome.storage.sync.set({ [STORAGE_KEY]: clean });
  return clean;
}

export function loadClocks() {
  return read();
}

/** Add a zone, or rename one when `id` matches. Returns the new list. */
export function saveClock({ id, timeZone, label = '' } = {}) {
  return writes(async () => {
    const list = await read();
    const existing = id ? list.findIndex((clock) => clock.id === id) : -1;
    if (existing >= 0) {
      const next = [...list];
      next[existing] = {
        ...next[existing],
        label: String(label).slice(0, MAX_LABEL) || next[existing].label,
        timeZone: isValidZone(timeZone) ? timeZone : next[existing].timeZone,
      };
      return commit(next);
    }
    if (!isValidZone(timeZone) || list.length >= MAX_CLOCKS) return list;
    return commit([...list, { id: id || newId(), timeZone, label: label || zoneCity(timeZone) }]);
  });
}

export function removeClock(id) {
  return writes(async () => {
    const list = await read();
    return commit(list.filter((clock) => clock.id !== id));
  });
}

/** Move one clock by `delta` places, clamped - same rule as the dock. */
export function moveClock(id, delta) {
  return writes(async () => {
    const list = await read();
    const from = list.findIndex((clock) => clock.id === id);
    if (from < 0 || !Number.isFinite(delta) || delta === 0) return list;
    const to = Math.min(list.length - 1, Math.max(0, from + Math.trunc(delta)));
    if (to === from) return list;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return commit(next);
  });
}

/** Replace the whole store, for a restore. */
export function replaceClocks(raw) {
  return writes(async () => commit(raw));
}

export function onClocksChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
  const listener = (changes, area) => {
    if (area !== 'sync' || !changes[STORAGE_KEY]) return;
    callback(sanitizeClocks(changes[STORAGE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export { STORAGE_KEY as CLOCKS_KEY };
