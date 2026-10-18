/**
 * Who you are, kept on this machine.
 *
 * Every application asks the same handful of questions, and answering them by
 * hand each time is the tax this extension exists to remove. Saved once, the
 * profile is what a later phase fills an application form from.
 *
 * chrome.storage.local rather than sync, for two reasons. A resume runs to
 * several kilobytes and sync caps one item at 8KB. And this is the most
 * personal thing the extension will ever hold - keeping it off Google's sync
 * servers is the honest default, not a limitation to work around.
 *
 * Nothing here is ever sent anywhere. It is read by the options page that wrote
 * it, and by the autofill that puts it back into a form on the site you are
 * already on.
 */

const STORAGE_KEY = 'ojRateFilterProfile';

/** Bounds, so pasting an entire CV cannot make the store unreadable. */
const LIMITS = {
  short: 120,
  line: 200,
  resume: 20000,
  summary: 2000,
  entries: 20,
  keywords: 30,
};

export const EMPTY_PROFILE = Object.freeze({
  name: '',
  email: '',
  phone: '',
  location: '',
  /** One line you would put at the top of an application. */
  headline: '',
  /** Free text. Structure is the employer's problem, not yours. */
  resume: '',
  /** @type {Array<{role: string, company: string, period: string, summary: string}>} */
  experience: [],
  /** Roles you are hunting for, which double as search terms. */
  targetRoles: [],
});

const trim = (value, max) => String(value ?? '').trim().slice(0, max);

function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const entry = {
    role: trim(raw.role, LIMITS.line),
    company: trim(raw.company, LIMITS.line),
    period: trim(raw.period, LIMITS.short),
    summary: trim(raw.summary, LIMITS.summary),
  };

  // An entry with nothing in it is not an entry.
  return Object.values(entry).some((value) => value.length > 0) ? entry : null;
}

function sanitizeKeywords(value) {
  if (!Array.isArray(value)) return [];
  const cleaned = value.map((word) => trim(word, LIMITS.short)).filter((word) => word.length > 0);
  return [...new Set(cleaned)].slice(0, LIMITS.keywords);
}

/** Coerce anything - storage, a form, an import - into a profile to trust. */
export function sanitizeProfile(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};

  return {
    name: trim(input.name, LIMITS.line),
    email: trim(input.email, LIMITS.line),
    phone: trim(input.phone, LIMITS.short),
    location: trim(input.location, LIMITS.line),
    headline: trim(input.headline, LIMITS.line),
    resume: trim(input.resume, LIMITS.resume),
    experience: Array.isArray(input.experience)
      ? input.experience.map(sanitizeEntry).filter(Boolean).slice(0, LIMITS.entries)
      : [],
    targetRoles: sanitizeKeywords(input.targetRoles),
  };
}

/**
 * Has anything been filled in?
 *
 * Used to decide whether to offer autofill at all - an empty profile has
 * nothing to give, and a control that fills a form with blanks is worse than
 * no control.
 */
export function isProfileEmpty(profile) {
  const clean = sanitizeProfile(profile);
  return (
    clean.experience.length === 0 &&
    clean.targetRoles.length === 0 &&
    ['name', 'email', 'phone', 'location', 'headline', 'resume'].every(
      (field) => clean[field].length === 0,
    )
  );
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export async function loadProfile() {
  if (!hasStorage()) return sanitizeProfile({});
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeProfile(stored?.[STORAGE_KEY]);
}

/**
 * Merge a patch over what is stored.
 *
 * A patch, not a replacement: the options page saves as you type, and a
 * whole-object write would race with itself.
 */
export async function saveProfile(patch) {
  const current = await loadProfile();
  const next = sanitizeProfile({ ...current, ...patch });

  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

/**
 * Replace the whole profile, for a restore.
 *
 * saveProfile merges, which is right while typing and wrong here: a restored
 * profile should be exactly the one in the file, not the file blended with
 * whatever this machine already held.
 */
export async function replaceProfile(raw) {
  const next = sanitizeProfile(raw);
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export async function clearProfile() {
  const empty = sanitizeProfile({});
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: empty });
  return empty;
}

export function onProfileChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};

  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(sanitizeProfile(changes[STORAGE_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export { LIMITS as PROFILE_LIMITS };
