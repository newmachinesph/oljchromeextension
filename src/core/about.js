/**
 * About you: the shared block every profile draws on.
 *
 * One set of details that do not change with the specialization you are
 * applying under - who you are, where and when you work, what you work with,
 * and a link or two. A profile (see profiles.js) adds the specialization: a
 * headline, target roles, and a resume body. Both are local; only the parts a
 * draft needs are ever sent, and never the email, phone or contact handles.
 *
 * The scheduling link is the one deliberate exception: it exists to be given
 * to an employer, so a draft may offer it. Contacts are the opposite - they are
 * here so you can copy one into an application yourself, not so a model can.
 *
 * chrome.storage.local, like the profile it replaces: the most personal thing
 * the extension holds, kept off sync on purpose.
 */

const STORAGE_KEY = 'ojRateFilterAbout';

/** Bounds, so pasting a wall of text cannot make the store unreadable. */
export const ABOUT_LIMITS = Object.freeze({
  line: 200,
  short: 120,
  other: 2000,
  url: 500,
  links: 20,
  contacts: 12,
});

/**
 * The ways an employer here actually reaches people.
 *
 * A fixed list rather than free text so a draft can say "Telegram: @you" in the
 * right shape, and so the same account is not stored three different ways. The
 * last entry is the escape hatch for anything not listed.
 */
export const CONTACT_KINDS = Object.freeze([
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'skype', label: 'Skype' },
  { value: 'viber', label: 'Viber' },
  { value: 'discord', label: 'Discord' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'phone', label: 'Phone' },
  { value: 'other', label: 'Other' },
]);

export function isContactKind(value) {
  return CONTACT_KINDS.some((kind) => kind.value === value);
}

const FLAT_FIELDS = Object.freeze([
  'name',
  'email',
  'phone',
  'location',
  'timezone',
  'availability',
  'equipment',
  'languages',
  'other',
  /*
   * A booking link - Calendly, Cal.com, whatever you use.
   *
   * Unlike the email and phone above, this one IS meant to leave the machine:
   * it exists to be handed to an employer, and a draft that offers a time
   * without offering a way to take it is doing half the job. Shared here rather
   * than per profile, because you have one calendar however many
   * specializations you apply under.
   */
  'schedulingUrl',
]);

export const EMPTY_ABOUT = Object.freeze({
  name: '',
  email: '',
  phone: '',
  location: '',
  timezone: '',
  availability: '',
  equipment: '',
  languages: '',
  other: '',
  schedulingUrl: '',
  links: [],
  contacts: [],
});

/** A short, unique-enough id for a link (or a profile). */
export function newId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().slice(0, 8);
    }
  } catch {
    /* fall through */
  }
  newId.counter = (newId.counter ?? 0) + 1;
  return `id${Date.now().toString(36)}${newId.counter}`;
}

const trim = (value, max) => (typeof value === 'string' ? value : '').trim().slice(0, max);

function fieldLimit(field) {
  if (field === 'other') return ABOUT_LIMITS.other;
  if (field === 'schedulingUrl') return ABOUT_LIMITS.url;
  if (field === 'phone' || field === 'timezone') return ABOUT_LIMITS.short;
  return ABOUT_LIMITS.line;
}

/**
 * One way to reach you.
 *
 * An unknown kind falls back to "other" rather than being dropped: the handle
 * is the part worth keeping, and losing it because an older build wrote a kind
 * this one does not know would be the wrong trade.
 */
function sanitizeContact(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const value = trim(raw.value, ABOUT_LIMITS.line);
  if (value.length === 0) return null;

  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 40) : newId();
  return { id, kind: isContactKind(raw.kind) ? raw.kind : 'other', value };
}

function sanitizeLink(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const label = trim(raw.label, ABOUT_LIMITS.short);
  const url = trim(raw.url, ABOUT_LIMITS.url);
  if (label.length === 0 && url.length === 0) return null;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 40) : newId();
  return { id, label, url };
}

/** Coerce anything - storage, a form, an import - into an About to trust. */
export function sanitizeAbout(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  const about = {};
  for (const field of FLAT_FIELDS) {
    about[field] = trim(input[field], fieldLimit(field));
  }

  about.links = Array.isArray(input.links)
    ? input.links.map(sanitizeLink).filter(Boolean).slice(0, ABOUT_LIMITS.links)
    : [];

  about.contacts = Array.isArray(input.contacts)
    ? input.contacts.map(sanitizeContact).filter(Boolean).slice(0, ABOUT_LIMITS.contacts)
    : [];

  return about;
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export async function loadAbout() {
  if (!hasStorage()) return sanitizeAbout(null);
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeAbout(stored?.[STORAGE_KEY]);
}

/** Merge a patch over what is stored. Partial saves are safe. */
export async function saveAbout(patch) {
  const current = await loadAbout();
  const next = sanitizeAbout({ ...current, ...(patch ?? {}) });
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

/** Overwrite the whole object, for a restore. */
export async function replaceAbout(raw) {
  const next = sanitizeAbout(raw);
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export async function clearAbout() {
  const empty = sanitizeAbout(null);
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: empty });
  return empty;
}

export function onAboutChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};

  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(sanitizeAbout(changes[STORAGE_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
