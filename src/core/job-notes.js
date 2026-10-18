/**
 * A private note pinned to one job.
 *
 * The employer book already holds a note per employer - who they are, how the
 * last chat went. This is finer: a reminder about this specific posting. "Asked
 * for a Loom", "salary was vague, confirm before applying", "matches the Acme
 * role I saw last week". Yours only, never sent anywhere.
 *
 * A record per key rather than a bare string, so the note carries when it last
 * changed - enough to sort by, and to show "edited" without guessing.
 * chrome.storage.local: local, unbounded, and 8KB would not hold many notes.
 */

import { jobKey } from './dismissed.js';
import { createQueue } from './queue.js';

/** All writes to this store run one at a time, so none clobbers another. */
const writes = createQueue();

const STORAGE_KEY = 'ojRateFilterJobNotes';

/** A note longer than this is a document, not a reminder. */
export const MAX_NOTE_LENGTH = 2000;

function sanitizeRecord(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const text = String(raw.text ?? '').slice(0, MAX_NOTE_LENGTH);
  if (text.trim().length === 0) return null;
  return { text, updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now };
}

/** Coerce whatever storage held into a clean map. Empty notes are dropped. */
export function sanitizeJobNotes(raw, now = 0) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map();

  const entries = [];
  for (const [key, value] of Object.entries(raw)) {
    const id = String(key).trim();
    if (id.length === 0 || id.length > 120) continue;
    const record = sanitizeRecord(value, now);
    if (record) entries.push([id, record]);
  }
  return new Map(entries);
}

function toStored(notes) {
  return Object.fromEntries(notes);
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

async function readMap() {
  if (!hasStorage()) return new Map();
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeJobNotes(stored?.[STORAGE_KEY]);
}

async function commit(map) {
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: toStored(map) });
  return map;
}

/** @returns {Promise<Map<string, {text: string, updatedAt: number}>>} */
export async function loadJobNotes() {
  return readMap();
}

/**
 * Set the note for one job. An empty or blank note deletes it - clearing the
 * box is how you remove a note, no separate delete needed.
 * @returns {Promise<Map<string, {text: string, updatedAt: number}>>}
 */
export function setJobNote(key, text) {
  if (!key || !hasStorage()) return loadJobNotes();
  return writes(async () => {
    const notes = await readMap();
    const clean = String(text ?? '').slice(0, MAX_NOTE_LENGTH);
    if (clean.trim().length === 0) notes.delete(key);
    else notes.set(key, { text: clean, updatedAt: Date.now() });
    return commit(notes);
  });
}

export function removeJobNote(key) {
  return setJobNote(key, '');
}

/** Replace the whole store, for a restore. */
export function replaceJobNotes(raw) {
  return writes(async () => {
    const next = sanitizeJobNotes(raw instanceof Map ? Object.fromEntries(raw) : raw, Date.now());
    return commit(next);
  });
}

export function clearJobNotes() {
  return writes(async () => {
    if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: {} });
    return new Map();
  });
}

/** Subscribe to changes from anywhere - another tab, or the options page. */
export function onJobNotesChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};

  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(sanitizeJobNotes(changes[STORAGE_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export { jobKey };
