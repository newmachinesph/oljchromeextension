/**
 * The colour you picked for a tag, shared by every job wearing it.
 *
 * Where `job-colors.js` colours a single card, this colours a *tag* - so every
 * job tagged "Urgent" reads red at once, on the board and in the job modal. A
 * tag with no saved colour falls back to its built-in default (see
 * `tags-catalog.js`), then to a neutral slate.
 *
 * A flat map of the lower-cased tag -> "#rrggbb". chrome.storage.local, local.
 */

import { createQueue } from './queue.js';

const STORAGE_KEY = 'ojRateFilterTagColors';

/** All writes to this store run one at a time, so none clobbers another. */
const writes = createQueue();

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The storage key for a tag: trimmed and lower-cased, so colour follows the tag
   regardless of the casing a job happens to store it in. */
export function tagKey(tag) {
  const t = String(tag ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return t.length > 0 && t.length <= 60 ? t : '';
}

/** One colour: a lower-cased #rrggbb, or '' when it is not a usable colour. */
export function cleanColor(raw) {
  const c = String(raw ?? '').trim().toLowerCase();
  return HEX.test(c) ? c : '';
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

/** Coerce whatever storage held into a clean map. Blank/invalid entries drop. */
export function sanitizeTagColors(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map();
  const entries = [];
  for (const [key, value] of Object.entries(raw)) {
    const id = tagKey(key);
    const color = cleanColor(value);
    if (id && color) entries.push([id, color]);
  }
  return new Map(entries);
}

function toStored(map) {
  return Object.fromEntries(map);
}

async function readMap() {
  if (!hasStorage()) return new Map();
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeTagColors(stored?.[STORAGE_KEY]);
}

async function commit(map) {
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: toStored(map) });
  return map;
}

/** @returns {Promise<Map<string, string>>} keyed by the lower-cased tag. */
export async function loadTagColors() {
  return readMap();
}

/**
 * Set a tag's colour. An empty/invalid colour clears it, restoring the tag's
 * default (or neutral) colour.
 * @returns {Promise<Map<string, string>>}
 */
export function setTagColor(tag, color) {
  const id = tagKey(tag);
  if (!id || !hasStorage()) return loadTagColors();
  return writes(async () => {
    const map = await readMap();
    const clean = cleanColor(color);
    if (!clean) map.delete(id);
    else map.set(id, clean);
    return commit(map);
  });
}

/** Rename a tag's colour key, for when a tag is renamed everywhere. */
export function renameTagColor(from, to) {
  const oldId = tagKey(from);
  const newId = tagKey(to);
  if (!oldId || !newId || oldId === newId || !hasStorage()) return loadTagColors();
  return writes(async () => {
    const map = await readMap();
    if (!map.has(oldId)) return map;
    const color = map.get(oldId);
    map.delete(oldId);
    if (!map.has(newId)) map.set(newId, color);
    return commit(map);
  });
}

/** Drop a tag's colour, for when a tag is deleted everywhere. */
export function removeTagColor(tag) {
  const id = tagKey(tag);
  if (!id || !hasStorage()) return loadTagColors();
  return writes(async () => {
    const map = await readMap();
    if (!map.has(id)) return map;
    map.delete(id);
    return commit(map);
  });
}

/** Replace the whole store, for a restore. */
export function replaceTagColors(raw) {
  return writes(async () => {
    const next = sanitizeTagColors(raw instanceof Map ? Object.fromEntries(raw) : raw);
    return commit(next);
  });
}

export function clearTagColors() {
  return writes(async () => {
    if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: {} });
    return new Map();
  });
}

/** Subscribe to changes from anywhere - another tab, or the options page. */
export function onTagColorsChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(sanitizeTagColors(changes[STORAGE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
