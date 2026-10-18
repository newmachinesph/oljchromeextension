/**
 * Jobs you have applied to, and where each one got to.
 *
 * The extension already remembers two decisions about a listing - dismissed,
 * and gone from the site. This is the third, and the one that matters most:
 * you put work into it. Across a merged list of several hundred, "have I
 * already applied to this?" is not a question you can answer from memory.
 *
 * Unlike the other two stores this keeps a record rather than a bare key, since
 * an application has a state that moves: applied, then interviewing, then an
 * offer or a rejection.
 *
 * chrome.storage.local, like the others: it is a log of what you did on this
 * machine, it grows without bound, and sync caps a single item at 8KB.
 */

import { jobKey } from './dismissed.js';
import { cleanUrl } from './safe-url.js';
import { createQueue } from './queue.js';

const STORAGE_KEY = 'ojRateFilterApplications';

/** All writes to this store run one at a time, so none clobbers another. */
const writes = createQueue();

/** How many applications to remember, oldest dropped first. */
export const MAX_APPLICATIONS = 2000;

/**
 * The stages of a job hunt, left to right as a board reads them.
 *
 * `preparing` sits before `applied`: a job you are working on but have not sent
 * yet. `hired` is the happy end of the line; `rejected` is the terminal no that
 * can arrive from any stage, so it sits last rather than in sequence.
 */
export const APPLICATION_STATUSES = Object.freeze([
  { value: 'preparing', label: 'Preparing' },
  { value: 'applied', label: 'Applied' },
  { value: 'replied', label: 'Replied' },
  { value: 'interviewing', label: 'Interviewing' },
  { value: 'offer', label: 'Offer' },
  { value: 'hired', label: 'Hired' },
  { value: 'rejected', label: 'Rejected' },
]);

const VALID_STATUSES = APPLICATION_STATUSES.map((entry) => entry.value);

/** Before you have actually applied - it does not count toward a response rate. */
export const PRE_APPLICATION_STATUSES = Object.freeze(['preparing']);

/**
 * The employer has answered. A rejection is an answer too, so it counts; a
 * job still only "applied" does not, and a "preparing" one was never sent.
 */
export const REPLY_STATUSES = Object.freeze([
  'replied',
  'interviewing',
  'offer',
  'hired',
  'rejected',
]);

export function isApplicationStatus(value) {
  return VALID_STATUSES.includes(value);
}

/**
 * A lane the user added themselves, namespaced `custom-…` by board-config so it
 * can never collide with a built-in stage. We accept any well-formed custom
 * token as a valid status without needing to know the live board config: if the
 * lane is later deleted the record simply has nowhere to show, but its data is
 * never silently rewritten to "applied".
 */
export function isCustomStatus(value) {
  return typeof value === 'string' && /^custom-[a-z0-9][a-z0-9-]*$/.test(value);
}

/** A status we are willing to store: a built-in stage or a custom lane. */
export function isStorableStatus(value) {
  return isApplicationStatus(value) || isCustomStatus(value);
}

/** Not yet sent, so it is not a submitted application. */
export function isPreApplication(status) {
  return PRE_APPLICATION_STATUSES.includes(status);
}

/** They got back to you - the thing a response rate is counting. */
export function isReplyStatus(status) {
  return REPLY_STATUSES.includes(status);
}

export function statusLabel(value) {
  return APPLICATION_STATUSES.find((entry) => entry.value === value)?.label ?? '';
}

/**
 * One application, as stored.
 *
 * `appliedAt` is when you first applied and never moves; `updatedAt` moves with
 * the status. Keeping both means the record can be read either as "when did I
 * apply" or "what changed recently".
 *
 * `usdPerMonth` is the figure the modal showed when you applied, kept so the
 * funnel can ask whether pay predicts replies. `followedUpAt` is your last
 * nudge; the follow-up reminder counts from it rather than from `appliedAt`.
 *
 * `history` is the trail of stage moves: one `{status, at}` per change, oldest
 * first, so a card can show "when did this reach interviewing?".
 *
 * @typedef {{status: string, appliedAt: number, updatedAt: number,
 *   title: string, employer: string, url: string, usdPerMonth: number|null,
 *   followedUpAt: number|null, history: Array<{status: string, at: number}>}} Application
 */

/** How many stage moves to keep per job, oldest dropped first. */
export const MAX_HISTORY = 50;

/**
 * Room for interview prep, and a hard stop.
 *
 * Longer than a note deliberately: this is where the questions you mean to ask,
 * the STAR answers you rehearsed and what you dug up about the company all go.
 * Four thousand characters is a couple of pages - past that it is a document,
 * and a document belongs in a document.
 */
export const MAX_PREP = 4000;

/** Clean a stored history trail: storable statuses with finite timestamps. */
export function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const status = isStorableStatus(entry.status) ? entry.status : null;
    const at = Number.isFinite(entry.at) ? entry.at : null;
    if (status && at !== null) out.push({ status, at });
  }
  return out.slice(-MAX_HISTORY);
}

function sanitizeRecord(raw, now) {
  if (!raw || typeof raw !== 'object') return null;

  const status = isStorableStatus(raw.status) ? raw.status : 'applied';
  const appliedAt = Number.isFinite(raw.appliedAt) ? raw.appliedAt : now;
  const updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : appliedAt;
  // An older record without a trail gets a one-entry one from what we know.
  const history = raw.history ? sanitizeHistory(raw.history) : [{ status, at: appliedAt }];

  return {
    status,
    appliedAt,
    updatedAt,
    title: String(raw.title ?? '').slice(0, 200),
    // Kept so a promoted saved job does not lose its employer, and the list and
    // employer search have something to read.
    employer: String(raw.employer ?? '').slice(0, 200),
    url: cleanUrl(raw.url),
    usdPerMonth: Number.isFinite(raw.usdPerMonth) ? raw.usdPerMonth : null,
    followedUpAt: Number.isFinite(raw.followedUpAt) ? raw.followedUpAt : null,
    // A scheduled next step - an interview, a task, a nudge to send something -
    // with a short label. Null when nothing is planned.
    nextActionAt: Number.isFinite(raw.nextActionAt) ? raw.nextActionAt : null,
    nextActionLabel: String(raw.nextActionLabel ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    // What you want to have ready before you talk to them. Line breaks are kept
    // - unlike every other field here, this one is written to be read back.
    prep: String(raw.prep ?? '').slice(0, MAX_PREP),
    history,
  };
}

/**
 * Coerce whatever storage held into a map every caller can trust.
 *
 * Over the cap the oldest are dropped, judged by when you applied rather than
 * when the status last moved - a stale application you never heard back about
 * is exactly the one worth forgetting first.
 */
export function sanitizeApplications(raw, now = 0, max = MAX_APPLICATIONS) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map();

  const entries = [];
  for (const [key, value] of Object.entries(raw)) {
    const id = String(key).trim();
    if (id.length === 0 || id.length > 120) continue;

    const record = sanitizeRecord(value, now);
    if (record) entries.push([id, record]);
  }

  if (entries.length > max) {
    entries.sort((a, b) => a[1].appliedAt - b[1].appliedAt);
    entries.splice(0, entries.length - max);
  }

  return new Map(entries);
}

/** Back to a plain object, which is what chrome.storage can hold. */
function toStored(applications) {
  return Object.fromEntries(applications);
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

async function readMap() {
  if (!hasStorage()) return new Map();
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeApplications(stored?.[STORAGE_KEY]);
}

async function commit(map, now = Date.now()) {
  const bounded = sanitizeApplications(toStored(map), now);
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: toStored(bounded) });
  return bounded;
}

/** @returns {Promise<Map<string, Application>>} */
export async function loadApplications() {
  return readMap();
}

/**
 * Record an application, or move an existing one to a new status.
 *
 * Re-recording a job you already applied to keeps the original `appliedAt`:
 * applying twice is not a thing that happens, but opening the apply page twice
 * certainly is, and the date you applied should not drift because of it.
 *
 * @returns {Promise<Map<string, Application>>}
 */
export function setApplication(
  key,
  { status = 'applied', title, employer, url, usdPerMonth } = {},
) {
  if (!key || !hasStorage()) return loadApplications();
  return writes(async () => {
    const now = Date.now();
    const applications = await readMap();
    const existing = applications.get(key);

    const nextStatus = isStorableStatus(status) ? status : 'applied';
    // Append a history entry only when the stage actually moves (or on the first
    // recording), so editing a title or rate never inflates the trail.
    const prevHistory = existing
      ? (Array.isArray(existing.history) ? existing.history : [{ status: existing.status, at: existing.appliedAt ?? now }])
      : [];
    const moved = !existing || existing.status !== nextStatus;
    const history = (moved ? [...prevHistory, { status: nextStatus, at: now }] : prevHistory).slice(-MAX_HISTORY);

    applications.set(key, {
      status: nextStatus,
      appliedAt: existing?.appliedAt ?? now,
      updatedAt: now,
      title: String(title ?? existing?.title ?? '').slice(0, 200),
      employer: String(employer ?? existing?.employer ?? '').slice(0, 200),
      url: cleanUrl(url ?? existing?.url ?? ''),
      // Kept from the first recording unless a later one actually knows better.
      usdPerMonth: Number.isFinite(usdPerMonth) ? usdPerMonth : (existing?.usdPerMonth ?? null),
      followedUpAt: existing?.followedUpAt ?? null,
      nextActionAt: existing?.nextActionAt ?? null,
      nextActionLabel: existing?.nextActionLabel ?? '',
      // Carried, never cleared: moving a card to "interviewing" must not throw
      // away the prep you wrote for that interview.
      prep: existing?.prep ?? '',
      history,
    });

    return commit(applications, now);
  });
}

/**
 * Set (or clear) the scheduled next step for an application. A non-finite `at`
 * clears it. Everything else about the record is left as it was.
 * @returns {Promise<Map<string, Application>>}
 */
export function setNextAction(key, { at, label } = {}) {
  if (!key || !hasStorage()) return loadApplications();
  return writes(async () => {
    const applications = await readMap();
    const existing = applications.get(key);
    if (!existing) return applications;
    const now = Date.now();
    const nextActionAt = Number.isFinite(at) ? at : null;
    applications.set(key, {
      ...existing,
      nextActionAt,
      nextActionLabel: nextActionAt === null ? '' : String(label ?? existing.nextActionLabel ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
      updatedAt: now,
    });
    return commit(applications, now);
  });
}

/**
 * Save the interview prep for one application.
 *
 * Its own writer rather than a field on setApplication, because prep is edited
 * while everything else about the card stays put - and routing it through the
 * general writer would stamp updatedAt and shuffle the board every keystroke.
 *
 * @returns {Promise<Map<string, Application>>}
 */
export function setPrep(key, text = '') {
  if (!key || !hasStorage()) return loadApplications();
  return writes(async () => {
    const applications = await readMap();
    const existing = applications.get(key);
    if (!existing) return applications;
    applications.set(key, { ...existing, prep: String(text ?? '').slice(0, MAX_PREP) });
    // Deliberately not touching updatedAt: writing your notes is not progress
    // on the application, and "Updated today" would be a lie about the employer.
    return commit(applications, Date.now());
  });
}

/**
 * Note that you nudged them. The status stays "applied" - a follow-up is not
 * a reply - but the reminder clock restarts from now.
 *
 * @returns {Promise<Map<string, Application>>}
 */
export function markFollowedUp(key) {
  if (!key || !hasStorage()) return loadApplications();
  return writes(async () => {
    const applications = await readMap();
    const existing = applications.get(key);
    if (!existing) return applications;

    const now = Date.now();
    applications.set(key, { ...existing, followedUpAt: now, updatedAt: now });
    return commit(applications, now);
  });
}

/**
 * Replace the whole log, for a restore.
 * @returns {Promise<Map<string, Application>>}
 */
export function replaceApplications(raw) {
  return writes(async () =>
    commit(sanitizeApplications(raw instanceof Map ? Object.fromEntries(raw) : raw, Date.now())),
  );
}

/** Forget one entirely - you did not apply after all. */
export function removeApplication(key) {
  if (!key || !hasStorage()) return loadApplications();
  return writes(async () => {
    const applications = await readMap();
    if (!applications.delete(key)) return applications;
    return commit(applications);
  });
}

export function clearApplications() {
  return writes(async () => {
    if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: {} });
    return new Map();
  });
}

/** Subscribe to changes from anywhere - another tab, or the options page. */
export function onApplicationsChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};

  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(sanitizeApplications(changes[STORAGE_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export { jobKey };
