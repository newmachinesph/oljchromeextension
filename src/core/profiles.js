/**
 * Profiles: the specializations you apply under.
 *
 * Where "About you" (about.js) holds what never changes, a profile holds what
 * does - a label, a headline, the roles you are chasing, and a resume body in
 * markdown (typed, pasted, or imported from a file). You keep several - a VA
 * one, a bookkeeping one - and pick which writes a draft.
 *
 * Exactly one is the default. Draft-time picks a profile; buildDraftProfile
 * turns About + the chosen profile into what a draft sends, minus the email
 * and phone.
 *
 * Replaces the single profile: on first load the old ojRateFilterProfile is
 * split once into About plus one "My profile" and then removed.
 *
 * chrome.storage.local, like About.
 */

import { newId, replaceAbout, sanitizeAbout } from './about.js';
import { sanitizeProfile as sanitizeLegacyProfile } from './profile.js';

const STORAGE_KEY = 'ojRateFilterProfiles';
const LEGACY_KEY = 'ojRateFilterProfile';

/** Enough for every specialization anyone runs; bounded all the same. */
export const MAX_PROFILES = 12;

export const PROFILE_LIMITS = Object.freeze({
  label: 80,
  headline: 200,
  body: 20000,
  role: 60,
  roles: 30,
});

const SOURCES = new Set(['typed', 'pdf', 'docx', 'text']);

const trim = (value, max) => (typeof value === 'string' ? value : '').trim().slice(0, max);

function sanitizeProfile(raw, now) {
  if (!raw || typeof raw !== 'object') return null;

  const roles = Array.isArray(raw.targetRoles)
    ? [...new Set(raw.targetRoles.map((r) => trim(r, PROFILE_LIMITS.role)).filter(Boolean))].slice(
        0,
        PROFILE_LIMITS.roles,
      )
    : [];

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 40) : newId(),
    label: trim(raw.label, PROFILE_LIMITS.label),
    headline: trim(raw.headline, PROFILE_LIMITS.headline),
    targetRoles: roles,
    body: trim(raw.body, PROFILE_LIMITS.body),
    source: SOURCES.has(raw.source) ? raw.source : 'typed',
    isDefault: Boolean(raw.isDefault),
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
  };
}

/**
 * Coerce a stored list into one to trust: capped, and with exactly one default.
 */
export function sanitizeProfiles(raw, now = Date.now(), max = MAX_PROFILES) {
  if (!Array.isArray(raw)) return [];

  let list = raw.map((entry) => sanitizeProfile(entry, now)).filter(Boolean);

  if (list.length > max) {
    list = [...list].sort((a, b) => a.updatedAt - b.updatedAt).slice(list.length - max);
  }

  // Exactly one default: the first that claims it, else the first profile.
  const firstDefault = list.findIndex((p) => p.isDefault);
  const winner = firstDefault === -1 ? 0 : firstDefault;
  list = list.map((p, i) => ({ ...p, isDefault: i === winner }));

  return list;
}

export function defaultProfile(list) {
  return (list ?? []).find((p) => p.isDefault) ?? (list ?? [])[0] ?? null;
}

export function profileById(list, id) {
  return (list ?? []).find((p) => p.id === id) ?? null;
}

/** A profile you can actually draft from: it says something. */
export function isUsable(profile) {
  return Boolean(profile && (trim(profile.body, 1) || trim(profile.headline, 1)));
}

export function hasUsableProfile(list) {
  return (list ?? []).some(isUsable);
}

/**
 * What a draft sends: About's context and the chosen profile, no email, no
 * phone. Link ids are dropped - the model wants the label and the url.
 */
export function buildDraftProfile(about, profile) {
  const a = about ?? {};
  const p = profile ?? {};
  return {
    name: a.name ?? '',
    headline: p.headline ?? '',
    targetRoles: Array.isArray(p.targetRoles) ? p.targetRoles : [],
    body: p.body ?? '',
    location: a.location ?? '',
    timezone: a.timezone ?? '',
    availability: a.availability ?? '',
    equipment: a.equipment ?? '',
    languages: a.languages ?? '',
    other: a.other ?? '',
    /*
     * Sent on purpose. A booking link is meant to reach the employer, and a
     * draft that offers to talk without offering a way to book it leaves the
     * reader to go looking.
     *
     * Contacts are deliberately NOT here, alongside email and phone: they are
     * stored so you can paste one in yourself, not so a model can hand them
     * out.
     */
    schedulingUrl: a.schedulingUrl ?? '',
    links: (Array.isArray(a.links) ? a.links : []).map((l) => ({ label: l.label, url: l.url })),
  };
}

/** Resume text, then the experience rows as a markdown section. For migration. */
export function assembleBody(resume, experience) {
  const parts = [];
  const body = trim(resume, PROFILE_LIMITS.body);
  if (body) parts.push(body);

  const rows = Array.isArray(experience) ? experience : [];
  const bullets = rows
    .map((e) => {
      const head = [e?.role, e?.company, e?.period].map((x) => trim(x, 200)).filter(Boolean).join(', ');
      const summary = trim(e?.summary, 600);
      if (!head && !summary) return '';
      return `- ${[head, summary].filter(Boolean).join(' — ')}`;
    })
    .filter(Boolean);

  if (bullets.length > 0) parts.push(['## Experience', ...bullets].join('\n'));
  return parts.join('\n\n').slice(0, PROFILE_LIMITS.body);
}

/**
 * Split the old single profile into About plus one default profile.
 * Pure, so the migration and the backup v2 path share it.
 */
export function migrateLegacy(rawLegacy) {
  const legacy = sanitizeLegacyProfile(rawLegacy);
  const about = sanitizeAbout({
    name: legacy.name,
    email: legacy.email,
    phone: legacy.phone,
    location: legacy.location,
  });
  const profiles = sanitizeProfiles([
    {
      id: newId(),
      label: 'My profile',
      headline: legacy.headline,
      targetRoles: legacy.targetRoles,
      body: assembleBody(legacy.resume, legacy.experience),
      source: 'typed',
      isDefault: true,
    },
  ]);
  return { about, profiles };
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

async function persist(list) {
  const clean = sanitizeProfiles(list);
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: clean });
  return clean;
}

/**
 * The profiles, migrating the legacy single profile once if the new store is
 * empty and the old key is still there.
 */
export async function loadProfiles() {
  if (!hasStorage()) return [];

  const stored = await chrome.storage.local.get([STORAGE_KEY, LEGACY_KEY]);
  if (Array.isArray(stored?.[STORAGE_KEY])) return sanitizeProfiles(stored[STORAGE_KEY]);

  const legacy = stored?.[LEGACY_KEY];
  if (legacy && typeof legacy === 'object') {
    const { about, profiles } = migrateLegacy(legacy);
    await replaceAbout(about);
    await chrome.storage.local.set({ [STORAGE_KEY]: profiles });
    await chrome.storage.local.remove(LEGACY_KEY);
    return profiles;
  }

  return [];
}

/** Add a profile; the first one is the default. */
export async function createProfile(partial = {}) {
  const list = await loadProfiles();
  const profile = sanitizeProfile(
    { ...partial, id: newId(), isDefault: list.length === 0, updatedAt: Date.now() },
    Date.now(),
  );
  return persist([...list, profile]);
}

/** Upsert by id, keeping the default flag as it was unless the caller set it. */
export async function saveProfile(patch) {
  if (!patch?.id) return loadProfiles();
  const list = await loadProfiles();
  const existing = profileById(list, patch.id);
  const merged = { ...(existing ?? {}), ...patch, updatedAt: Date.now() };
  const next = existing ? list.map((p) => (p.id === patch.id ? merged : p)) : [...list, merged];
  return persist(next);
}

export async function removeProfile(id) {
  const list = await loadProfiles();
  return persist(list.filter((p) => p.id !== id));
}

export async function setDefaultProfile(id) {
  const list = await loadProfiles();
  if (!profileById(list, id)) return list;
  return persist(list.map((p) => ({ ...p, isDefault: p.id === id })));
}

export async function replaceProfiles(raw) {
  return persist(Array.isArray(raw) ? raw : []);
}

export async function clearProfiles() {
  return persist([]);
}

export function onProfilesChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};

  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(sanitizeProfiles(changes[STORAGE_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
