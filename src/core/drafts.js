/**
 * Drafting an application: what is sent, what comes back, and what is kept.
 *
 * The one feature that sends anything anywhere. It sends the job's text and
 * the parts of your profile a draft needs - headline, experience, resume,
 * target roles - to our own server, which asks a model for a first message to
 * the employer and charges one credit. Contact details stay here; the model
 * has no use for your phone number.
 *
 * The text comes back for you to read, edit and copy. Nothing here fills a
 * form or presses Apply, on purpose: the application is yours to send.
 *
 * Drafts are remembered locally per job so opening the same job again shows
 * the last draft without another charge.
 */

import { SITE_ORIGIN } from './search-url.js';

const STORAGE_KEY = 'ojRateFilterDrafts';

/** Drafts kept, newest wins. Plenty for a search; bounded all the same. */
export const MAX_DRAFTS = 200;

/**
 * The same caps the server enforces, applied here first so a request is never
 * refused for size - and so what leaves the browser is the least that works.
 */
export const DRAFT_LIMITS = Object.freeze({
  title: 200,
  employer: 120,
  rateText: 80,
  description: 12_000,
  name: 120,
  headline: 200,
  resume: 6_000,
  experience: 8,
  summary: 600,
  targetRoles: 10,
  subject: 120,
});

export const DRAFT_TONES = Object.freeze([
  { value: 'plain', label: 'Plain' },
  { value: 'warm', label: 'Warm' },
  { value: 'formal', label: 'Formal' },
]);

const clip = (value, max) => String(value ?? '').trim().slice(0, max);

function absolute(url) {
  const text = String(url ?? '').trim();
  if (/^https?:\/\//i.test(text)) return text;
  return `${SITE_ORIGIN}${text.startsWith('/') ? '' : '/'}${text}`;
}

/**
 * The request body for one draft.
 *
 * `attempt` makes the idempotency key: the same job and attempt is the same
 * request, so a retry after a dropped connection cannot charge twice, and a
 * deliberate "regenerate" is a new attempt and a new charge.
 *
 * @param {object} input
 * @param {{jobKey: string, url: string, title: string, employer?: string,
 *   rateText?: string, description: string}} input.job
 * @param {object} input.profile the full profile; only some fields are used
 * @param {{tone?: string, subject?: string}} [input.options]
 * @param {number} input.attempt
 */
export function draftRequest({ job, profile, options = {}, attempt = 1 }) {
  const picked = {};
  const put = (key, value) => {
    if (value) picked[key] = value;
  };
  // profile is the buildDraftProfile output: About context + the chosen
  // profile, its markdown body standing in as the resume. No email, no phone.
  put('name', clip(profile?.name, DRAFT_LIMITS.name));
  put('headline', clip(profile?.headline, DRAFT_LIMITS.headline));
  put('resume', clip(profile?.body ?? profile?.resume, DRAFT_LIMITS.resume));
  put('location', clip(profile?.location, DRAFT_LIMITS.headline));
  put('timezone', clip(profile?.timezone, DRAFT_LIMITS.employer));
  put('availability', clip(profile?.availability, DRAFT_LIMITS.headline));
  put('equipment', clip(profile?.equipment, DRAFT_LIMITS.headline));
  put('languages', clip(profile?.languages, DRAFT_LIMITS.headline));
  put('other', clip(profile?.other, DRAFT_LIMITS.summary * 3));

  const targetRoles = (Array.isArray(profile?.targetRoles) ? profile.targetRoles : [])
    .map((role) => clip(role, 60))
    .filter(Boolean)
    .slice(0, DRAFT_LIMITS.targetRoles);
  if (targetRoles.length > 0) picked.targetRoles = targetRoles;

  const links = (Array.isArray(profile?.links) ? profile.links : [])
    .map((l) => ({ label: clip(l?.label, DRAFT_LIMITS.employer), url: clip(l?.url, 500) }))
    .filter((l) => l.url.length > 0)
    .slice(0, 20);
  if (links.length > 0) picked.links = links;

  const body = {
    job: {
      url: absolute(job.url),
      title: clip(job.title, DRAFT_LIMITS.title),
      description: clip(job.description, DRAFT_LIMITS.description),
    },
    profile: picked,
    idempotencyKey: `${job.jobKey}:${attempt}`,
  };
  const employer = clip(job.employer, DRAFT_LIMITS.employer);
  const rateText = clip(job.rateText, DRAFT_LIMITS.rateText);
  if (employer) body.job.employer = employer;
  if (rateText) body.job.rateText = rateText;

  const opts = {};
  if (DRAFT_TONES.some((t) => t.value === options.tone)) opts.tone = options.tone;
  const subject = clip(options.subject, DRAFT_LIMITS.subject);
  if (subject) opts.subject = subject;
  if (Object.keys(opts).length > 0) body.options = opts;

  return body;
}

/**
 * One sentence a person can act on, per failure.
 *
 * The server's codes are for machines; these are the words that go in the
 * panel. The refund case says so outright, because the first thing anyone
 * wonders about a failed paid request is whether they were charged.
 */
export function describeDraftError(status, body = {}) {
  switch (status) {
    case 0:
      return 'Could not reach the server. Is it running?';
    case 400:
    case 413:
      return body?.error || 'That job could not be sent for drafting.';
    case 401:
      return 'Sign in from the toolbar icon first.';
    case 402:
      return 'You have no credits left. Buy some on the website, then try again.';
    case 409:
      return 'This draft was already requested. Open the job again to see it, or regenerate.';
    case 429:
      return 'That is the daily limit for drafts. Try again tomorrow.';
    case 502:
    case 504:
      return body?.billing === 'byok'
        ? 'The model did not answer. Check your provider key and model on the dashboard.'
        : 'The model did not answer. You were not charged - try again in a moment.';
    default:
      return 'Something went wrong on the server. You were not charged for a draft you did not get.';
  }
}

/**
 * @typedef {{text: string, subject: string|null, createdAt: number,
 *   attempt: number, model: string}} StoredDraft
 */

function sanitizeEntry(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const text = String(raw.text ?? '').trim().slice(0, 8000);
  if (text.length === 0) return null;
  return {
    text,
    profileId: typeof raw.profileId === 'string' ? raw.profileId.slice(0, 40) : '',
    subject:
      typeof raw.subject === 'string' && raw.subject.trim() ? raw.subject.trim().slice(0, 200) : null,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    attempt: Number.isInteger(raw.attempt) && raw.attempt > 0 ? raw.attempt : 1,
    model: String(raw.model ?? '').slice(0, 60),
  };
}

/** @returns {Map<string, StoredDraft>} keyed by jobKey */
export function sanitizeDrafts(raw, now = Date.now(), max = MAX_DRAFTS) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map();

  const entries = [];
  for (const [key, value] of Object.entries(raw)) {
    const id = String(key).trim();
    if (id.length === 0 || id.length > 120) continue;
    const entry = sanitizeEntry(value, now);
    if (entry) entries.push([id, entry]);
  }

  if (entries.length > max) {
    entries.sort((a, b) => a[1].createdAt - b[1].createdAt);
    entries.splice(0, entries.length - max);
  }

  return new Map(entries);
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

const toStored = (drafts) => Object.fromEntries(drafts);

export async function loadDrafts() {
  if (!hasStorage()) return new Map();
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeDrafts(stored?.[STORAGE_KEY]);
}

/** Remember the latest draft for a job. Replaces any earlier one. */
export async function saveDraft(jobKey, { text, subject = null, attempt = 1, model = '', profileId = '' }) {
  if (!jobKey || !hasStorage()) return loadDrafts();

  const now = Date.now();
  const drafts = await loadDrafts();
  const entry = sanitizeEntry({ text, subject, attempt, model, profileId, createdAt: now }, now);
  if (entry) drafts.set(jobKey, entry);

  const bounded = sanitizeDrafts(toStored(drafts), now);
  await chrome.storage.local.set({ [STORAGE_KEY]: toStored(bounded) });
  return bounded;
}

export async function removeDraft(jobKey) {
  if (!jobKey || !hasStorage()) return loadDrafts();
  const drafts = await loadDrafts();
  if (!drafts.delete(jobKey)) return drafts;
  await chrome.storage.local.set({ [STORAGE_KEY]: toStored(drafts) });
  return drafts;
}

export async function clearDrafts() {
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: {} });
  return new Map();
}

export function onDraftsChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};

  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(sanitizeDrafts(changes[STORAGE_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/**
 * Replace every stored draft. For restoring a backup.
 *
 * Drafts cost credits to produce, so losing them to a reinstall is losing
 * something you paid for - which is exactly what a backup is meant to prevent.
 */
export async function replaceDrafts(raw) {
  const clean = sanitizeDrafts(raw);
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: Object.fromEntries(clean) });
  return clean;
}
