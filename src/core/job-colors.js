/**
 * A colour you pinned to a job, shown as the card's left border on the board.
 *
 * Purely cosmetic: a way to make a card catch your eye ("red = chase this",
 * "green = dream job") independent of which lane it sits in. When a job has no
 * colour of its own the board falls back to its lane's colour, so this only ever
 * adds emphasis, never takes it away.
 *
 * A flat map of jobKey -> "#rrggbb". chrome.storage.local, local to this machine.
 */

import { jobKey } from './dismissed.js';
import { createQueue } from './queue.js';

const STORAGE_KEY = 'ojRateFilterJobColors';

/** All writes to this store run one at a time, so none clobbers another. */
const writes = createQueue();

const HEX = /^#[0-9a-fA-F]{6}$/;

/** One colour: a lower-cased #rrggbb, or '' when it is not a usable colour. */
export function cleanColor(raw) {
  const c = String(raw ?? '').trim().toLowerCase();
  return HEX.test(c) ? c : '';
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

/** Coerce whatever storage held into a clean map. Jobs with no colour drop out. */
export function sanitizeJobColors(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map();
  const entries = [];
  for (const [key, value] of Object.entries(raw)) {
    const id = String(key).trim();
    if (id.length === 0 || id.length > 120) continue;
    const color = cleanColor(value);
    if (color) entries.push([id, color]);
  }
  return new Map(entries);
}

function toStored(map) {
  return Object.fromEntries(map);
}

async function readMap() {
  if (!hasStorage()) return new Map();
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeJobColors(stored?.[STORAGE_KEY]);
}

async function commit(map) {
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: toStored(map) });
  return map;
}

/** @returns {Promise<Map<string, string>>} */
export async function loadJobColors() {
  return readMap();
}

/**
 * Set a job's colour. An empty/invalid colour clears it, restoring the lane's
 * default colour for that card.
 * @returns {Promise<Map<string, string>>}
 */
export function setJobColor(key, color) {
  if (!key || !hasStorage()) return loadJobColors();
  return writes(async () => {
    const map = await readMap();
    const clean = cleanColor(color);
    if (!clean) map.delete(key);
    else map.set(key, clean);
    return commit(map);
  });
}

/** Replace the whole store, for a restore. */
export function replaceJobColors(raw) {
  return writes(async () => {
    const next = sanitizeJobColors(raw instanceof Map ? Object.fromEntries(raw) : raw);
    return commit(next);
  });
}

export function clearJobColors() {
  return writes(async () => {
    if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: {} });
    return new Map();
  });
}

/** Subscribe to changes from anywhere - another tab, or the options page. */
export function onJobColorsChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(sanitizeJobColors(changes[STORAGE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export { jobKey };
