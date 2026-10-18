/**
 * A pomodoro timer that survives the page.
 *
 * The naive version keeps the countdown in a setInterval and loses everything
 * the moment the tab navigates - which, on a job board, is constantly. So the
 * timer stores an *end instant*, not a remaining count: every render just asks
 * how far away that instant is. Close the tab, open another, and the same
 * session is still running with the right number on it.
 *
 * "Advanced" here means the three things people actually leave a basic timer
 * for: a long break on a cycle, auto-start so you do not have to click between
 * every phase, and a record of what you got done today.
 *
 * The state machine is pure - `advance`, `remainingMs`, `phaseLength` take a
 * state and an instant and return a new one. Only the bottom of the file knows
 * about storage, which is what makes the whole thing testable without a clock.
 */

import { createQueue } from './queue.js';

const STORAGE_KEY = 'ojRateFilterPomodoro';

/** All writes to this store run one at a time, so none clobbers another. */
const writes = createQueue();

export const PHASES = { IDLE: 'idle', FOCUS: 'focus', SHORT: 'short', LONG: 'long' };

/** A break is a break; only focus counts towards the cycle and the day's tally. */
export const BREAK_PHASES = [PHASES.SHORT, PHASES.LONG];

export const DEFAULT_CONFIG = Object.freeze({
  focusMinutes: 25,
  shortMinutes: 5,
  longMinutes: 15,
  /** A long break after this many focus sessions. */
  longEvery: 4,
  autoStartBreaks: true,
  autoStartFocus: false,
  chime: true,
});

export const LIMITS = {
  focusMinutes: { min: 1, max: 180 },
  shortMinutes: { min: 1, max: 60 },
  longMinutes: { min: 1, max: 120 },
  longEvery: { min: 2, max: 12 },
};

/** How many days of history to keep. A quarter is enough to see a pattern. */
export const MAX_LOG_DAYS = 90;

function clampNumber(value, { min, max }, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function sanitizeConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    focusMinutes: clampNumber(source.focusMinutes, LIMITS.focusMinutes, DEFAULT_CONFIG.focusMinutes),
    shortMinutes: clampNumber(source.shortMinutes, LIMITS.shortMinutes, DEFAULT_CONFIG.shortMinutes),
    longMinutes: clampNumber(source.longMinutes, LIMITS.longMinutes, DEFAULT_CONFIG.longMinutes),
    longEvery: clampNumber(source.longEvery, LIMITS.longEvery, DEFAULT_CONFIG.longEvery),
    autoStartBreaks: source.autoStartBreaks !== false,
    autoStartFocus: source.autoStartFocus === true,
    chime: source.chime !== false,
  };
}

export const IDLE_RUN = Object.freeze({
  phase: PHASES.IDLE,
  startedAt: null,
  endsAt: null,
  pausedAt: null,
  /** Focus sessions finished since the last long break - drives longEvery. */
  cycle: 0,
  /** What you are working on, if you said. Free text, never sent anywhere. */
  task: '',
});

export const MAX_TASK = 120;

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

export function sanitizeRun(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const phase = Object.values(PHASES).includes(source.phase) ? source.phase : PHASES.IDLE;
  const cycle = Math.max(0, Math.trunc(Number(source.cycle) || 0));
  const task = String(source.task ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TASK);
  if (phase === PHASES.IDLE) return { ...IDLE_RUN, cycle, task };
  return {
    phase,
    startedAt: finiteOrNull(source.startedAt),
    endsAt: finiteOrNull(source.endsAt),
    pausedAt: finiteOrNull(source.pausedAt),
    cycle,
    task,
  };
}

/** A local calendar day key, so the tally rolls over at your midnight not UTC's. */
export function dayKey(at = Date.now()) {
  const date = at instanceof Date ? at : new Date(at);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function sanitizeLog(raw) {
  if (!Array.isArray(raw)) return [];
  const byDay = new Map();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const day = String(entry.day ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const focusCount = Math.max(0, Math.trunc(Number(entry.focusCount) || 0));
    const focusMinutes = Math.max(0, Math.round(Number(entry.focusMinutes) || 0));
    // A duplicate day in storage is a merge, not a choice between two records.
    const found = byDay.get(day);
    byDay.set(day, {
      day,
      focusCount: focusCount + (found?.focusCount ?? 0),
      focusMinutes: focusMinutes + (found?.focusMinutes ?? 0),
    });
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, MAX_LOG_DAYS);
}

export function sanitizeState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    config: sanitizeConfig(source.config),
    run: sanitizeRun(source.run),
    log: sanitizeLog(source.log),
  };
}

/** How long one phase lasts, in milliseconds. */
export function phaseLength(phase, config = DEFAULT_CONFIG) {
  const clean = sanitizeConfig(config);
  if (phase === PHASES.FOCUS) return clean.focusMinutes * 60_000;
  if (phase === PHASES.SHORT) return clean.shortMinutes * 60_000;
  if (phase === PHASES.LONG) return clean.longMinutes * 60_000;
  return 0;
}

/**
 * Milliseconds left, never below zero.
 *
 * A paused run freezes at the gap it had when it was paused, which is why
 * `pausedAt` is stored rather than the remaining count: resuming only has to
 * push `endsAt` forward by however long the pause lasted.
 */
export function remainingMs(run, now = Date.now()) {
  const clean = sanitizeRun(run);
  if (clean.phase === PHASES.IDLE || clean.endsAt === null) return 0;
  const at = clean.pausedAt ?? now;
  return Math.max(0, clean.endsAt - at);
}

export function isPaused(run) {
  return sanitizeRun(run).pausedAt !== null;
}

export function isRunning(run) {
  const clean = sanitizeRun(run);
  return clean.phase !== PHASES.IDLE && clean.pausedAt === null;
}

/** Has the current phase run out? Distinct from idle - it needs handling. */
export function isElapsed(run, now = Date.now()) {
  const clean = sanitizeRun(run);
  return clean.phase !== PHASES.IDLE && remainingMs(clean, now) === 0;
}

/** mm:ss, or h:mm:ss once a session is an hour or more. */
export function formatRemaining(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Start a phase now, keeping the cycle count and whatever you were working on. */
export function startPhase(phase, config = DEFAULT_CONFIG, run = IDLE_RUN, now = Date.now()) {
  const previous = sanitizeRun(run);
  if (phase === PHASES.IDLE) return { ...IDLE_RUN, cycle: previous.cycle, task: previous.task };
  return {
    phase,
    startedAt: now,
    endsAt: now + phaseLength(phase, config),
    pausedAt: null,
    cycle: previous.cycle,
    task: previous.task,
  };
}

export function pause(run, now = Date.now()) {
  const clean = sanitizeRun(run);
  if (clean.phase === PHASES.IDLE || clean.pausedAt !== null) return clean;
  return { ...clean, pausedAt: now };
}

export function resume(run, now = Date.now()) {
  const clean = sanitizeRun(run);
  if (clean.pausedAt === null || clean.endsAt === null) return clean;
  // Push the finish line out by exactly how long we stood still, so the phase
  // is still the length you asked for.
  return { ...clean, endsAt: clean.endsAt + (now - clean.pausedAt), pausedAt: null };
}

/** Give back the minutes just spent, so the log records real time not planned. */
function focusMinutesOf(run, config, now) {
  const clean = sanitizeRun(run);
  if (clean.phase !== PHASES.FOCUS) return 0;
  const planned = phaseLength(PHASES.FOCUS, config);
  const started = clean.startedAt ?? now - planned;
  return Math.max(0, Math.round((now - started) / 60_000));
}

/**
 * What comes after the phase that just ended.
 *
 * Focus goes to a break - the long one when the cycle is up. A break always
 * goes back to focus. Whether the next phase actually *starts* is the config's
 * business, not this function's: it returns the phase either way and leaves
 * `autoStart` to decide between running it and parking on idle.
 */
export function nextPhase(run, config = DEFAULT_CONFIG) {
  const clean = sanitizeRun(run);
  const { longEvery } = sanitizeConfig(config);
  if (clean.phase === PHASES.FOCUS) {
    return (clean.cycle + 1) % longEvery === 0 ? PHASES.LONG : PHASES.SHORT;
  }
  return PHASES.FOCUS;
}

/** Add one finished focus session to today's row. */
export function record(log, minutes, at = Date.now()) {
  const clean = sanitizeLog(log);
  const day = dayKey(at);
  const found = clean.find((row) => row.day === day);
  const rest = clean.filter((row) => row.day !== day);
  const row = {
    day,
    focusCount: (found?.focusCount ?? 0) + 1,
    focusMinutes: (found?.focusMinutes ?? 0) + Math.max(0, Math.round(minutes)),
  };
  return [row, ...rest].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, MAX_LOG_DAYS);
}

/**
 * Move the machine on from a finished phase.
 *
 * One function for the whole transition, because the three things that happen
 * at the end of a session - the tally, the cycle count and what starts next -
 * are one decision, and splitting them is how they drift apart.
 *
 * @returns {{run: object, log: Array, completedFocus: boolean}}
 */
export function advance(state, now = Date.now()) {
  const config = sanitizeConfig(state?.config);
  const run = sanitizeRun(state?.run);
  const log = sanitizeLog(state?.log);
  if (run.phase === PHASES.IDLE) return { run, log, completedFocus: false };

  const finishedFocus = run.phase === PHASES.FOCUS;
  const following = nextPhase(run, config);
  const cycle = finishedFocus ? run.cycle + 1 : run.cycle;
  const nextLog = finishedFocus ? record(log, focusMinutesOf(run, config, now), now) : log;

  const autoStart = following === PHASES.FOCUS ? config.autoStartFocus : config.autoStartBreaks;
  const base = { ...run, cycle, pausedAt: null };
  const next = autoStart
    ? startPhase(following, config, base, now)
    : { ...IDLE_RUN, cycle, task: run.task };

  return { run: next, log: nextLog, completedFocus: finishedFocus };
}

/** Today's row, or a zeroed one - so callers never branch on undefined. */
export function today(log, at = Date.now()) {
  const day = dayKey(at);
  return sanitizeLog(log).find((row) => row.day === day) ?? { day, focusCount: 0, focusMinutes: 0 };
}

/** The last `days` rows, oldest first, with the gaps filled in as zeroes. */
export function recentDays(log, days = 7, at = Date.now()) {
  const byDay = new Map(sanitizeLog(log).map((row) => [row.day, row]));
  const base = at instanceof Date ? at : new Date(at);
  const out = [];
  for (let step = days - 1; step >= 0; step -= 1) {
    const date = new Date(base);
    date.setDate(date.getDate() - step);
    const day = dayKey(date);
    out.push(byDay.get(day) ?? { day, focusCount: 0, focusMinutes: 0 });
  }
  return out;
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

export function loadPomodoro() {
  return read();
}

/** Apply a change to the stored state, serialised against other writers. */
export function updatePomodoro(patch) {
  return writes(async () => {
    const current = await read();
    const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
    return commit(next);
  });
}

export function savePomodoroConfig(config) {
  return updatePomodoro((current) => ({ ...current, config: sanitizeConfig(config) }));
}

/** Replace the whole store, for a restore. */
export function replacePomodoro(raw) {
  return writes(async () => commit(raw));
}

export function clearPomodoro() {
  return writes(async () => commit(null));
}

export function onPomodoroChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(sanitizeState(changes[STORAGE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export { STORAGE_KEY as POMODORO_KEY };
