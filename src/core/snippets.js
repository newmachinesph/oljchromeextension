/**
 * Reusable text snippets - your own templates, kept locally.
 *
 * Applying on OnlineJobs.ph means typing the same things over and over: a short
 * intro, an answer to "what is your internet speed", the subject line a post
 * demanded. A snippet is a titled block of text you write once and copy when you
 * need it. Not AI - just your words, saved. Local, like everything free.
 *
 * An ordered array of { id, title, body }. chrome.storage.local.
 */

import { createQueue } from './queue.js';

const STORAGE_KEY = 'ojRateFilterSnippets';

/** All writes to this store run one at a time, so none clobbers another. */
const writes = createQueue();

export const MAX_SNIPPETS = 50;
export const MAX_TITLE = 80;
export const MAX_BODY = 4000;

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : `${Date.now()}`;
}

/** Coerce whatever storage held into a clean array. Titleless/bodyless drop. */
export function sanitizeSnippets(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const id = String(entry.id ?? '').trim().slice(0, 40) || newId();
    if (seen.has(id)) continue;
    const title = String(entry.title ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
    const body = String(entry.body ?? '').slice(0, MAX_BODY);
    if (!title && !body) continue;
    seen.add(id);
    out.push({ id, title, body });
    if (out.length >= MAX_SNIPPETS) break;
  }
  return out;
}

async function read() {
  if (!hasStorage()) return [];
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeSnippets(stored?.[STORAGE_KEY]);
}

async function commit(list) {
  const clean = sanitizeSnippets(list);
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: clean });
  return clean;
}

/** @returns {Promise<Array<{id:string,title:string,body:string}>>} */
export async function loadSnippets() {
  return read();
}

/**
 * Create a snippet, or update one when `id` matches an existing entry.
 * @returns {Promise<Array>} the new list
 */
export function saveSnippet({ id, title = '', body = '' } = {}) {
  if (!hasStorage()) return loadSnippets();
  return writes(async () => {
    const list = await read();
    const cleanTitle = String(title).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
    const cleanBody = String(body).slice(0, MAX_BODY);
    if (!cleanTitle && !cleanBody) return list;
    const existing = id ? list.findIndex((s) => s.id === id) : -1;
    if (existing >= 0) {
      const next = [...list];
      next[existing] = { id, title: cleanTitle, body: cleanBody };
      return commit(next);
    }
    if (list.length >= MAX_SNIPPETS) return list;
    return commit([...list, { id: id || newId(), title: cleanTitle, body: cleanBody }]);
  });
}

/** Delete one snippet by id. */
export function removeSnippet(id) {
  if (!id || !hasStorage()) return loadSnippets();
  return writes(async () => {
    const list = await read();
    return commit(list.filter((s) => s.id !== id));
  });
}

/** Replace the whole store, for a restore. */
export function replaceSnippets(raw) {
  return writes(async () => commit(raw));
}

export function clearSnippets() {
  return writes(async () => {
    if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: [] });
    return [];
  });
}

/** Subscribe to changes from anywhere - another tab, or the options page. */
export function onSnippetsChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(sanitizeSnippets(changes[STORAGE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
