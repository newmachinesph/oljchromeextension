/**
 * A stopwatch for billable hours, kept on this machine.
 *
 * Not the paid timesheet - that one invoices, syncs and belongs to a client
 * record on the server. This is the free half: start a timer, stop it, and have
 * an honest number to put in the message when the employer asks how long that
 * took. Most people are doing this in a notes app or not at all.
 *
 * Like the pomodoro, a running entry stores its *start instant* rather than a
 * counter, so navigating away does not lose it. Unlike the pomodoro, there is
 * only ever one running entry: two clocks on the same hour is double billing,
 * and starting a second timer stops the first rather than asking.
 */

import { createQueue } from './queue.js';

const STORAGE_KEY = 'ojRateFilterTime';

/** All writes to this store run one at a time, so none clobbers another. */
const writes = createQueue();

export const MAX_ENTRIES = 500;
export const MAX_LABEL = 120;
export const MAX_CLIENT = 80;

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : `${Date.now()}`;
}

function text(value, limit) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

/**
 * A number, or null - and null for anything that was never a number.
 *
 * The `== null` guard is the point: Number(null) is 0 and Number('') is 0, both
 * of which are finite, so without it a stored null comes back as a real instant
 * at the epoch. That reads as "paused in 1970", and every countdown measured
 * against it is wrong by fifty-six years.
 */
function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A rate is optional; when it is there it turns hours into money. */
function rate(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(10_000, Math.round(n * 100) / 100);
}

export function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const startedAt = finiteOrNull(raw.startedAt);
  if (startedAt === null) return null;
  const endedAt = finiteOrNull(raw.endedAt);
  return {
    id: text(raw.id, 40) || newId(),
    label: text(raw.label, MAX_LABEL),
    client: text(raw.client, MAX_CLIENT),
    startedAt,
    // An end before the start is corrupt, not a negative shift; drop it back to
    // an open entry rather than reporting a negative duration forever.
    endedAt: endedAt !== null && endedAt >= startedAt ? endedAt : null,
    rateUsd: rate(raw.rateUsd),
  };
}

export function sanitizeEntries(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const entry = sanitizeEntry(item);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  // Newest first: the entry you just stopped is the one you want to look at.
  return out.sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_ENTRIES);
}

export function sanitizeState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const running = sanitizeEntry(source.running);
  return {
    // A "running" entry with an end is finished; it belongs in the list, not
    // on the clock. Dropping it here keeps one bad write from pinning a timer.
    running: running && running.endedAt === null ? running : null,
    entries: sanitizeEntries(source.entries),
  };
}

/** How long an entry ran, in milliseconds. An open one is measured to `now`. */
export function durationOf(entry, now = Date.now()) {
  const clean = sanitizeEntry(entry);
  if (!clean) return 0;
  return Math.max(0, (clean.endedAt ?? now) - clean.startedAt);
}

/** h:mm:ss while it runs - seconds matter when you are watching the thing. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
}

/** "2.75h" - what you write in an invoice line, rounded the way people bill. */
export function formatHours(ms, { precision = 2 } = {}) {
  const hours = Math.max(0, Number(ms) || 0) / 3600_000;
  return `${hours.toFixed(precision)}h`;
}

/** What an entry is worth, or null when no rate was set. */
export function earnedOf(entry, now = Date.now()) {
  const clean = sanitizeEntry(entry);
  if (!clean || clean.rateUsd === null) return null;
  return Math.round((durationOf(clean, now) / 3600_000) * clean.rateUsd * 100) / 100;
}

/** A local calendar day key, matching the pomodoro's, so days line up. */
export function dayKey(at = Date.now()) {
  const date = at instanceof Date ? at : new Date(at);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Totals per client, biggest first.
 *
 * Unlabelled work groups under "" rather than being dropped - time you forgot
 * to name is still time you spent, and hiding it makes the total wrong.
 */
export function totalsByClient(entries, now = Date.now()) {
  const byClient = new Map();
  for (const entry of sanitizeEntries(entries)) {
    const found = byClient.get(entry.client) ?? {
      client: entry.client,
      ms: 0,
      earned: 0,
      hasRate: false,
      count: 0,
    };
    found.ms += durationOf(entry, now);
    found.count += 1;
    const earned = earnedOf(entry, now);
    if (earned !== null) {
      found.earned += earned;
      found.hasRate = true;
    }
    byClient.set(entry.client, found);
  }
  return [...byClient.values()]
    .map((row) => ({ ...row, earned: Math.round(row.earned * 100) / 100 }))
    .sort((a, b) => b.ms - a.ms);
}

/** Entries bucketed by the day they started, newest day first. */
export function groupByDay(entries, now = Date.now()) {
  const byDay = new Map();
  for (const entry of sanitizeEntries(entries)) {
    const day = dayKey(entry.startedAt);
    const found = byDay.get(day) ?? { day, ms: 0, entries: [] };
    found.ms += durationOf(entry, now);
    found.entries.push(entry);
    byDay.set(day, found);
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** Everything logged, in milliseconds. */
export function totalMs(entries, now = Date.now()) {
  return sanitizeEntries(entries).reduce((sum, entry) => sum + durationOf(entry, now), 0);
}

/** Just today's, which is the number the widget puts at the top. */
export function todayMs(entries, now = Date.now()) {
  const day = dayKey(now);
  return sanitizeEntries(entries)
    .filter((entry) => dayKey(entry.startedAt) === day)
    .reduce((sum, entry) => sum + durationOf(entry, now), 0);
}

export const EXPORT_COLUMNS = ['Date', 'Client', 'What', 'Start', 'End', 'Hours', 'Rate', 'Earned'];

const NEEDS_QUOTING = /[",\r\n]/;

function csvCell(value) {
  const cell = String(value ?? '');
  return NEEDS_QUOTING.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

function clockOf(at) {
  const date = new Date(at);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The log as a CSV an accountant or a client will accept.
 *
 * Same conventions as the board's export: CRLF, RFC 4180 quoting and a BOM, so
 * Excel on Windows opens it without a wizard and without mangling accents.
 */
export function toCsv(entries, { bom = true, now = Date.now() } = {}) {
  const rows = [EXPORT_COLUMNS.map(csvCell).join(',')];
  for (const entry of sanitizeEntries(entries)) {
    const ms = durationOf(entry, now);
    const earned = earnedOf(entry, now);
    rows.push(
      [
        dayKey(entry.startedAt),
        entry.client,
        entry.label,
        clockOf(entry.startedAt),
        entry.endedAt === null ? '' : clockOf(entry.endedAt),
        (ms / 3600_000).toFixed(2),
        entry.rateUsd === null ? '' : entry.rateUsd.toFixed(2),
        earned === null ? '' : earned.toFixed(2),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${bom ? '﻿' : ''}${rows.join('\r\n')}`;
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

async function read() {
  if (!hasStorage()) return sanitizeState(null);
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeState(stored?.[STORAGE_KEY]);
}

async function commit(state) {
  const clean = sanitizeState(state);
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: clean });
  return clean;
}

export function loadTime() {
  return read();
}

/**
 * Start the clock, stopping whatever was already on it.
 *
 * Silently, on purpose: you clicked start on something else, which is a clear
 * statement about what you are doing now. Asking "stop the other one?" would
 * be a dialog whose only sensible answer is yes.
 */
export function startTimer({ label = '', client = '', rateUsd = null } = {}, now = Date.now()) {
  return writes(async () => {
    const current = await read();
    const entries = current.running
      ? sanitizeEntries([{ ...current.running, endedAt: now }, ...current.entries])
      : current.entries;
    return commit({
      running: {
        id: newId(),
        label: text(label, MAX_LABEL),
        client: text(client, MAX_CLIENT),
        startedAt: now,
        endedAt: null,
        rateUsd: rate(rateUsd),
      },
      entries,
    });
  });
}

/** Stop the clock and file the entry. A zero-length one is dropped, not filed. */
export function stopTimer(now = Date.now()) {
  return writes(async () => {
    const current = await read();
    if (!current.running) return current;
    const finished = { ...current.running, endedAt: now };
    // Under a second is a mis-click, and the log is more useful without them.
    if (durationOf(finished, now) < 1000) return commit({ running: null, entries: current.entries });
    return commit({ running: null, entries: [finished, ...current.entries] });
  });
}

/** Throw away the running timer without filing it. */
export function discardTimer() {
  return writes(async () => {
    const current = await read();
    return commit({ ...current, running: null });
  });
}

/** Edit the running timer's label, client or rate while it runs. */
export function updateRunning(patch = {}) {
  return writes(async () => {
    const current = await read();
    if (!current.running) return current;
    return commit({
      ...current,
      running: {
        ...current.running,
        ...('label' in patch ? { label: text(patch.label, MAX_LABEL) } : {}),
        ...('client' in patch ? { client: text(patch.client, MAX_CLIENT) } : {}),
        ...('rateUsd' in patch ? { rateUsd: rate(patch.rateUsd) } : {}),
      },
    });
  });
}

/** Add a finished entry by hand, for work you forgot to time. */
export function addEntry(entry) {
  return writes(async () => {
    const current = await read();
    const clean = sanitizeEntry(entry);
    if (!clean) return current;
    return commit({ ...current, entries: [clean, ...current.entries] });
  });
}

/** Edit one filed entry. */
export function updateEntry(id, patch = {}) {
  return writes(async () => {
    const current = await read();
    const entries = current.entries.map((entry) =>
      entry.id === id ? (sanitizeEntry({ ...entry, ...patch }) ?? entry) : entry,
    );
    return commit({ ...current, entries });
  });
}

export function removeEntry(id) {
  return writes(async () => {
    const current = await read();
    return commit({ ...current, entries: current.entries.filter((entry) => entry.id !== id) });
  });
}

/** Replace the whole store, for a restore. */
export function replaceTime(raw) {
  return writes(async () => commit(raw));
}

export function clearTime() {
  return writes(async () => commit(null));
}

export function onTimeChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(sanitizeState(changes[STORAGE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export { STORAGE_KEY as TIME_KEY };
