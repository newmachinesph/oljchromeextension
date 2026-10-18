/**
 * Labels you put on jobs, to slice the list your own way.
 *
 * The filter sorts by what the posting says - rate, type, keywords. Tags sort
 * by what you think: "High priority", "Day shift", "Long-term", "Maybe". One
 * job can wear several. Then the list is filterable by a category the site
 * never gave it.
 *
 * A plain array of tag strings per job. chrome.storage.local: local, grows with
 * how many jobs you tag.
 */

import { jobKey } from './dismissed.js';
import { createQueue } from './queue.js';

const STORAGE_KEY = 'ojRateFilterJobTags';

/** All writes to this store run one at a time, so none clobbers another. */
const writes = createQueue();

/** A tag is a label, not a sentence. */
export const MAX_TAG_LENGTH = 40;
/** Enough to organise; past this it is not a tag system any more. */
export const MAX_TAGS_PER_JOB = 20;

/** One tag: trimmed, capped, non-empty. Returns '' when it is not usable. */
export function cleanTag(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH);
}

/** A job's tag list: cleaned, de-duplicated case-insensitively, capped. */
export function cleanTagList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const tag = cleanTag(entry);
    if (tag.length === 0) continue;
    const lower = tag.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(tag);
    if (out.length >= MAX_TAGS_PER_JOB) break;
  }
  return out;
}

/** Coerce whatever storage held into a clean map. Jobs with no tags drop out. */
export function sanitizeJobTags(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map();

  const entries = [];
  for (const [key, value] of Object.entries(raw)) {
    const id = String(key).trim();
    if (id.length === 0 || id.length > 120) continue;
    const tags = cleanTagList(value);
    if (tags.length > 0) entries.push([id, tags]);
  }
  return new Map(entries);
}

function toStored(tags) {
  return Object.fromEntries(tags);
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

async function readMap() {
  if (!hasStorage()) return new Map();
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeJobTags(stored?.[STORAGE_KEY]);
}

async function commit(map) {
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: toStored(map) });
  return map;
}

/** @returns {Promise<Map<string, string[]>>} */
export async function loadJobTags() {
  return readMap();
}

/**
 * Set the whole tag list for one job. An empty list removes the entry.
 * @returns {Promise<Map<string, string[]>>}
 */
export function setJobTags(key, list) {
  if (!key || !hasStorage()) return loadJobTags();
  return writes(async () => {
    const tags = await readMap();
    const clean = cleanTagList(list);
    if (clean.length === 0) tags.delete(key);
    else tags.set(key, clean);
    return commit(tags);
  });
}

/**
 * Add a tag if absent, remove it if present. What a tag chip toggle needs.
 * Queued read-decide-write, so a rapid pair of toggles cannot cross over.
 * @returns {Promise<Map<string, string[]>>}
 */
export function toggleJobTag(key, tag) {
  const clean = cleanTag(tag);
  if (!key || clean.length === 0 || !hasStorage()) return loadJobTags();
  return writes(async () => {
    const tags = await readMap();
    const current = tags.get(key) ?? [];
    const has = current.some((t) => t.toLowerCase() === clean.toLowerCase());
    const next = has
      ? current.filter((t) => t.toLowerCase() !== clean.toLowerCase())
      : [...current, clean];
    const cleaned = cleanTagList(next);
    if (cleaned.length === 0) tags.delete(key);
    else tags.set(key, cleaned);
    return commit(tags);
  });
}

/**
 * Add a tag, or leave things as they are.
 *
 * Unlike toggle, this never removes: re-typing a tag it already has is a no-op,
 * not a delete, which is what an "add" field means. At the cap it also declines
 * rather than silently dropping the tag.
 * @returns {Promise<Map<string, string[]>>}
 */
export function addJobTag(key, tag) {
  const clean = cleanTag(tag);
  if (!key || clean.length === 0 || !hasStorage()) return loadJobTags();
  return writes(async () => {
    const tags = await readMap();
    const current = tags.get(key) ?? [];
    if (current.length >= MAX_TAGS_PER_JOB) return tags;
    if (current.some((t) => t.toLowerCase() === clean.toLowerCase())) return tags;
    tags.set(key, cleanTagList([...current, clean]));
    return commit(tags);
  });
}

/**
 * Remove a tag if it is there, else leave things as they are.
 *
 * The idempotent counterpart to addJobTag: clicking remove twice (or a double
 * click, given the async round-trip) takes the tag off once and does nothing
 * the second time - unlike toggle, which would put it back.
 * @returns {Promise<Map<string, string[]>>}
 */
export function removeJobTag(key, tag) {
  const clean = cleanTag(tag);
  if (!key || clean.length === 0 || !hasStorage()) return loadJobTags();
  return writes(async () => {
    const tags = await readMap();
    const current = tags.get(key) ?? [];
    const next = current.filter((t) => t.toLowerCase() !== clean.toLowerCase());
    if (next.length === current.length) return tags;
    if (next.length === 0) tags.delete(key);
    else tags.set(key, next);
    return commit(tags);
  });
}

/** Every distinct tag in use, for a filter dropdown or suggestions. */
export function allTags(tagsMap) {
  const seen = new Map();
  for (const list of tagsMap.values()) {
    for (const tag of list) {
      const lower = tag.toLowerCase();
      if (!seen.has(lower)) seen.set(lower, tag);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * How many jobs wear each tag, most-used first. Feeds a tag-management view.
 * @returns {Array<{tag: string, count: number}>}
 */
export function tagCounts(tagsMap) {
  const counts = new Map(); // lower -> { tag, count }
  for (const list of tagsMap.values()) {
    for (const tag of list) {
      const lower = tag.toLowerCase();
      const entry = counts.get(lower);
      if (entry) entry.count += 1;
      else counts.set(lower, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Rename a tag across every job that has it. If the new name already exists on a
 * job, the two merge (deduped) rather than doubling up - so renaming onto an
 * existing tag is also how you merge two tags into one. A no-op if nothing wore
 * the old tag or the new name is empty.
 * @returns {Promise<Map<string, string[]>>}
 */
export function renameTagEverywhere(from, to) {
  const oldTag = cleanTag(from);
  const newTag = cleanTag(to);
  if (!oldTag || !newTag || !hasStorage()) return loadJobTags();
  const oldLower = oldTag.toLowerCase();
  return writes(async () => {
    const tags = await readMap();
    let touched = false;
    for (const [key, list] of tags) {
      if (!list.some((t) => t.toLowerCase() === oldLower)) continue;
      const swapped = list.map((t) => (t.toLowerCase() === oldLower ? newTag : t));
      const cleaned = cleanTagList(swapped);
      if (cleaned.length === 0) tags.delete(key);
      else tags.set(key, cleaned);
      touched = true;
    }
    return touched ? commit(tags) : tags;
  });
}

/**
 * Remove a tag from every job. A no-op if nothing wore it.
 * @returns {Promise<Map<string, string[]>>}
 */
export function deleteTagEverywhere(tag) {
  const clean = cleanTag(tag);
  if (!clean || !hasStorage()) return loadJobTags();
  const lower = clean.toLowerCase();
  return writes(async () => {
    const tags = await readMap();
    let touched = false;
    for (const [key, list] of tags) {
      if (!list.some((t) => t.toLowerCase() === lower)) continue;
      const next = list.filter((t) => t.toLowerCase() !== lower);
      if (next.length === 0) tags.delete(key);
      else tags.set(key, next);
      touched = true;
    }
    return touched ? commit(tags) : tags;
  });
}

/** Replace the whole store, for a restore. */
export function replaceJobTags(raw) {
  return writes(async () => {
    const next = sanitizeJobTags(raw instanceof Map ? Object.fromEntries(raw) : raw);
    return commit(next);
  });
}

export function clearJobTags() {
  return writes(async () => {
    if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: {} });
    return new Map();
  });
}

/** Subscribe to changes from anywhere - another tab, or the options page. */
export function onJobTagsChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};

  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(sanitizeJobTags(changes[STORAGE_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export { jobKey };
