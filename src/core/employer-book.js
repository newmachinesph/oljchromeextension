/**
 * What you know about an employer, kept across sessions.
 *
 * Three things, one store: whether you have blocked them, a note you wrote,
 * and what a job page said about their account the last time you opened one
 * (created recently; contact details censored) - plus which of their jobs you
 * have opened, so a page can say "the third job you've looked at from them".
 * The first two are decisions you made; the rest is remembered so the card can
 * show it next time without anyone opening a page to find out. Nothing here
 * ever fetches.
 *
 * Who an employer *is* has two answers. The results card gives a hand-typed
 * name - "Young Publisher", "young publisher " - or a placeholder like "Not
 * Given". A job page also carries the site's own numeric employer id, even when
 * the name is withheld. So an entry is keyed by the normalised name when there
 * is one, and by `#<id>` when there is not, and a lookup that knows the id
 * finds the named entry too. An id-only entry is folded under the name the
 * moment a page shows both.
 *
 * chrome.storage.local, like the other logs: it describes what you did on this
 * machine, and a note can be long.
 */

import { employerKey } from './employers.js';

const STORAGE_KEY = 'ojRateFilterEmployers';

/** Long enough for every employer you will ever meet; bounded all the same. */
export const MAX_ENTRIES = 2000;

export const MAX_NOTE = 500;

/** Job keys remembered per employer. Nobody opens more than this from one. */
export const MAX_JOBS = 50;

const MAX_NAME = 120;

/**
 * @typedef {object} Entry
 * @property {string} name as the card wrote it ('' for an id-only entry)
 * @property {string|null} id the site's numeric employer id, when a page showed it
 * @property {boolean} blocked
 * @property {string} note
 * @property {boolean|null} newAccount what a job page said, or null if never seen
 * @property {boolean|null} censored
 * @property {string[]} jobs job keys you opened from them, oldest first
 * @property {number|null} seenAt when a job page last told us about them
 * @property {number} updatedAt last change to anything above
 */

/**
 * @typedef {string|{name?: string|null, id?: string|number|null}} Ident
 *   an employer as a page knows them: a bare name, or a name and/or id
 */

function asFlag(value) {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function asId(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return /^\d{1,12}$/.test(text) ? text : null;
}

function asIdent(ident) {
  if (ident && typeof ident === 'object') {
    return { name: String(ident.name ?? ''), id: asId(ident.id) };
  }
  return { name: String(ident ?? ''), id: null };
}

/** The key an ident would be stored under: the name if it has one, else the id. */
function keyFor(ident) {
  const { name, id } = asIdent(ident);
  const byName = employerKey(name);
  if (byName.length > 0) return byName;
  return id ? `#${id}` : '';
}

/** An entry that says nothing is not worth a row. */
function isEmpty(entry) {
  return (
    !entry.blocked &&
    entry.note.length === 0 &&
    entry.newAccount === null &&
    entry.censored === null &&
    entry.jobs.length === 0
  );
}

function sanitizeEntry(raw, now) {
  if (!raw || typeof raw !== 'object') return null;

  const jobs = Array.isArray(raw.jobs)
    ? raw.jobs.filter((key) => typeof key === 'string' && key.length > 0).slice(-MAX_JOBS)
    : [];

  const entry = {
    name: String(raw.name ?? '').trim().slice(0, MAX_NAME),
    id: asId(raw.id),
    blocked: Boolean(raw.blocked),
    note: String(raw.note ?? '').trim().slice(0, MAX_NOTE),
    newAccount: asFlag(raw.newAccount),
    censored: asFlag(raw.censored),
    jobs,
    seenAt: Number.isFinite(raw.seenAt) ? raw.seenAt : null,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
  };

  return isEmpty(entry) ? null : entry;
}

/**
 * Coerce whatever storage held into a map every caller can trust.
 *
 * @returns {Map<string, Entry>} keyed by employerKey, or `#id`
 */
export function sanitizeBook(raw, now = Date.now(), max = MAX_ENTRIES) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map();

  const entries = [];
  for (const [rawKey, value] of Object.entries(raw)) {
    const entry = sanitizeEntry(value, now);
    if (!entry) continue;

    // Re-derived rather than trusted: an id-only row is keyed by its id, a
    // named row by its name, whatever the file said.
    const key = rawKey.startsWith('#') && entry.id ? `#${entry.id}` : employerKey(rawKey);
    if (key.length === 0) continue;
    if (entry.name.length === 0 && !key.startsWith('#')) entry.name = rawKey;
    entries.push([key, entry]);
  }

  if (entries.length > max) {
    entries.sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    entries.splice(0, entries.length - max);
  }

  return new Map(entries);
}

/**
 * The entry for an employer, however this page identified them.
 *
 * By name first; failing that, by the id the entry recorded; failing that, by
 * the id-only key. Returns the key too, so a write can move an entry.
 *
 * @returns {{key: string, entry: Entry}|null}
 */
function locate(book, ident) {
  if (!book || typeof book.get !== 'function') return null;
  const { name, id } = asIdent(ident);

  const byName = employerKey(name);
  if (byName.length > 0 && book.has(byName)) return { key: byName, entry: book.get(byName) };

  if (id) {
    for (const [key, entry] of book) {
      if (entry.id === id) return { key, entry };
    }
  }
  return null;
}

function lookup(book, ident) {
  return locate(book, ident)?.entry ?? null;
}

export function isBlocked(book, ident) {
  return lookup(book, ident)?.blocked === true;
}

export function noteFor(book, ident) {
  return lookup(book, ident)?.note ?? '';
}

/** How many of this employer's jobs you have opened. */
export function jobsOpened(book, ident) {
  return lookup(book, ident)?.jobs.length ?? 0;
}

/**
 * What a job page said about this employer, if one was ever opened.
 * @returns {{newAccount: boolean|null, censored: boolean|null}|null}
 */
export function memoryFor(book, ident) {
  const entry = lookup(book, ident);
  if (!entry) return null;
  if (entry.newAccount === null && entry.censored === null) return null;
  return { newAccount: entry.newAccount, censored: entry.censored };
}

function toStored(book) {
  return Object.fromEntries(book);
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

/** @returns {Promise<Map<string, Entry>>} */
export async function loadBook() {
  if (!hasStorage()) return new Map();
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeBook(stored?.[STORAGE_KEY]);
}

/**
 * Read-modify-write one entry. The patch is applied over whatever is there, the
 * result is sanitised (which drops it if it ended up empty), and the whole
 * book is bounded on the way out.
 *
 * `patch` may be a function of the existing entry, for changes that depend on
 * it (adding a job to the list).
 */
async function patchEntry(ident, patch) {
  const { name, id } = asIdent(ident);
  const wanted = keyFor(ident);
  if (wanted.length === 0 || !hasStorage()) return loadBook();

  const now = Date.now();
  const book = await loadBook();
  const found = locate(book, ident);
  const existing = found?.entry;

  // Names beat ids. A row already under a name stays there even when this
  // page only knew the id; a row that was only known by id moves under the
  // name the moment a page shows one, and the id-only key goes.
  const key = found && !found.key.startsWith('#') ? found.key : wanted;
  if (found && found.key !== key) book.delete(found.key);

  const base = {
    name: existing?.name || name.trim(),
    id: existing?.id ?? id,
    blocked: existing?.blocked ?? false,
    note: existing?.note ?? '',
    newAccount: existing?.newAccount ?? null,
    censored: existing?.censored ?? null,
    jobs: existing?.jobs ?? [],
    seenAt: existing?.seenAt ?? null,
  };
  // A placeholder name must not overwrite a real one, and a real one may fill
  // in a row that only had an id.
  if (employerKey(name).length > 0) base.name = name.trim();
  if (id) base.id = id;

  const next = sanitizeEntry(
    { ...base, ...(typeof patch === 'function' ? patch(base) : patch), updatedAt: now },
    now,
  );

  if (next) book.set(key, next);
  else book.delete(key);

  const bounded = sanitizeBook(toStored(book), now);
  await chrome.storage.local.set({ [STORAGE_KEY]: toStored(bounded) });
  return bounded;
}

export function setBlocked(ident, blocked) {
  return patchEntry(ident, { blocked: Boolean(blocked) });
}

export function setNote(ident, note) {
  return patchEntry(ident, { note: String(note ?? '') });
}

/**
 * Remember what a job page you opened said about this employer, and that you
 * opened this job of theirs.
 *
 * Only ever called with a document the reader asked for; this module has no
 * way to fetch one, and that is deliberate.
 */
export function rememberSignals(ident, { newAccount = null, censored = null, jobKey = null } = {}) {
  return patchEntry(ident, (current) => ({
    newAccount: asFlag(newAccount) ?? current.newAccount,
    censored: asFlag(censored) ?? current.censored,
    jobs:
      jobKey && !current.jobs.includes(jobKey)
        ? [...current.jobs, String(jobKey)].slice(-MAX_JOBS)
        : current.jobs,
    seenAt: Date.now(),
  }));
}

/** Replace the whole book, for a restore. */
export async function replaceBook(raw) {
  const bounded = sanitizeBook(raw instanceof Map ? Object.fromEntries(raw) : raw, Date.now());
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: toStored(bounded) });
  return bounded;
}

export async function clearBook() {
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: {} });
  return new Map();
}

/** Subscribe to changes from anywhere - another tab, or the options page. */
export function onBookChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};

  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(sanitizeBook(changes[STORAGE_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/** Whether this page identified the employer well enough to act on. */
export function canIdentify(ident) {
  return keyFor(ident).length > 0;
}

export { employerKey };
