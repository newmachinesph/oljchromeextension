/**
 * Presets you own: copies, edits, and ones you wrote from nothing.
 *
 * The shipped presets in presets.js are frozen data - deliberately, since they
 * are curated and measured. But a preset is only a starting point, and a
 * starting point you cannot adjust is a dead end. This is the layer that makes
 * them yours without making the shipped ones mutable.
 *
 * Three things live here, and the distinction matters:
 *
 *   - a COPY is a new preset seeded from a shipped one. The original stays put;
 *     the copy lands in "My presets" and is yours to change.
 *   - an OVERRIDE edits a shipped preset in place. It keeps the original's name
 *     and slot, so the palette looks unchanged - but the filters are yours.
 *     Reverting deletes the override and the shipped one reappears, which is
 *     why the original is never written over.
 *   - a NEW preset is one you wrote from scratch. Same shape, no ancestor.
 *
 * Kept in chrome.storage.local rather than sync: a preset can carry a long
 * keyword list, and sync quota is small and shared.
 */

import { PRESETS, PRESET_GROUPS } from './presets.js';

const STORAGE_KEY = 'ojRateFilterUserPresets';

/**
 * Presets you would rather not see.
 *
 * Kept by name rather than by id so one list covers both the shipped presets
 * and your own, and so hiding survives an override being reverted. Hiding is
 * not deleting: a shipped preset cannot be deleted at all, and someone who
 * works only in one niche should not have to read past nine others every time
 * they open the picker.
 */
const HIDDEN_KEY = 'ojRateFilterHiddenPresets';

/** Bounded, like everything else here. */
export const MAX_HIDDEN_PRESETS = 200;

const nameKey = (value) => String(value ?? '').trim().toLowerCase();

/** The heading your own presets sit under, above the shipped groups. */
export const MY_PRESETS_GROUP = 'My presets';

/** Enough for anyone; bounded so storage cannot be filled by accident. */
export const MAX_USER_PRESETS = 50;

export const USER_PRESET_LIMITS = Object.freeze({
  name: 60,
  hint: 200,
  group: 40,
  keyword: 60,
  keywords: 40,
});

/**
 * Experience bands.
 *
 * Separate from the experience FILTER in experience-level.js, which judges a
 * listing's own wording. This is the band the preset is aimed at, which is a
 * property of the search rather than of any one job.
 */
export const PRESET_LEVELS = Object.freeze([
  { value: 'any', label: 'Any level' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
]);

export function isPresetLevel(value) {
  return PRESET_LEVELS.some((entry) => entry.value === value);
}

const trim = (value, max) => (typeof value === 'string' ? value : '').trim().slice(0, max);

/** A short, unique-enough id. */
export function newPresetId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().slice(0, 8);
    }
  } catch {
    /* fall through */
  }
  newPresetId.counter = (newPresetId.counter ?? 0) + 1;
  return `p${Date.now().toString(36)}${newPresetId.counter}`;
}

function sanitizeKeywords(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const word = trim(entry, USER_PRESET_LIMITS.keyword);
    if (!word) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= USER_PRESET_LIMITS.keywords) break;
  }
  return out;
}

/**
 * The filters a preset carries. Same shape as a saved search's, and every field
 * is coerced rather than trusted - this comes back from storage, and an older
 * build may have written a shape this one does not expect.
 */
function sanitizeFilters(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const number = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  return {
    thresholdUsdPerMonth: number(input.thresholdUsdPerMonth),
    searchKeywords: sanitizeKeywords(input.searchKeywords),
    excludeKeywords: sanitizeKeywords(input.excludeKeywords),
    requiredSkills: sanitizeKeywords(input.requiredSkills),
    hiddenJobTypes: Array.isArray(input.hiddenJobTypes)
      ? input.hiddenJobTypes
          .map((t) => trim(t, 20))
          .filter(Boolean)
          .slice(0, 8)
      : [],
    maxAgeDays: number(input.maxAgeDays),
  };
}

/** Coerce anything into a user preset to trust, or null if it is not one. */
export function sanitizeUserPreset(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;

  const name = trim(raw.name, USER_PRESET_LIMITS.name);
  if (!name) return null;

  const isOverride = raw.source === 'override' && Boolean(trim(raw.baseName, 200));

  return {
    id: trim(raw.id, 40) || newPresetId(),
    // An override keeps the shipped preset's group so it stays in its slot;
    // anything else belongs to you and sits under "My presets".
    group: isOverride ? trim(raw.group, USER_PRESET_LIMITS.group) : MY_PRESETS_GROUP,
    name,
    level: isPresetLevel(raw.level) ? raw.level : 'any',
    hint: trim(raw.hint, USER_PRESET_LIMITS.hint),
    filters: sanitizeFilters(raw.filters),
    source: isOverride ? 'override' : 'user',
    baseName: isOverride ? trim(raw.baseName, 200) : '',
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
  };
}

/** A stored list, cleaned and capped. Later entries win on a duplicate id. */
export function sanitizeUserPresets(raw, now = Date.now()) {
  if (!Array.isArray(raw)) return [];

  const byId = new Map();
  for (const entry of raw) {
    const clean = sanitizeUserPreset(entry, now);
    if (clean) byId.set(clean.id, clean);
  }

  return [...byId.values()].slice(0, MAX_USER_PRESETS);
}

/**
 * A copy of a preset, ready to edit.
 *
 * The name gets a suffix rather than colliding: two entries called "Development"
 * in the same picker is a worse problem than a slightly clumsy name.
 */
export function duplicateOf(preset, existing = [], now = Date.now()) {
  const taken = new Set(existing.map((p) => p.name.toLowerCase()));
  let name = `${preset.name} (copy)`;
  let n = 2;
  while (taken.has(name.toLowerCase())) {
    name = `${preset.name} (copy ${n})`;
    n += 1;
  }

  return sanitizeUserPreset(
    {
      id: newPresetId(),
      name,
      level: preset.level ?? 'any',
      hint: preset.hint ?? '',
      filters: preset.filters,
      source: 'user',
    },
    now,
  );
}

/**
 * An edit-in-place of a shipped preset: same name, same slot, your filters.
 *
 * The id is derived from the base name rather than random, so editing the same
 * shipped preset twice updates one override instead of stacking them.
 */
export function overrideOf(preset, patch = {}, now = Date.now()) {
  const { source: _ignoredSource, baseName: _ignoredBase, ...safePatch } = patch ?? {};

  return sanitizeUserPreset(
    {
      id: `override:${preset.name.toLowerCase()}`,
      name: preset.name,
      group: preset.group,
      level: preset.level ?? 'any',
      hint: preset.hint ?? '',
      filters: preset.filters,
      ...safePatch,
      // Fixed last: a patch must not be able to turn an override into
      // something else, or re-point it at a different shipped preset.
      source: 'override',
      baseName: preset.name,
    },
    now,
  );
}

/** An empty preset to start typing into. */
export function blankPreset(existing = [], now = Date.now()) {
  const taken = new Set(existing.map((p) => p.name.toLowerCase()));
  let name = 'New preset';
  let n = 2;
  while (taken.has(name.toLowerCase())) {
    name = `New preset ${n}`;
    n += 1;
  }

  return sanitizeUserPreset(
    {
      id: newPresetId(),
      name,
      level: 'any',
      hint: '',
      filters: {},
      source: 'user',
    },
    now,
  );
}

/**
 * The shipped presets with your overrides applied, plus your own.
 *
 * Shipped entries keep their order; an override swaps in at the original's
 * position so the palette does not reshuffle under you.
 */
export function allPresets(userPresets = [], shipped = PRESETS) {
  const overrides = new Map(
    userPresets.filter((p) => p.source === 'override').map((p) => [p.baseName.toLowerCase(), p]),
  );

  const merged = shipped.map((preset) => {
    const override = overrides.get(preset.name.toLowerCase());
    if (!override) return { ...preset, level: preset.level ?? 'any', owned: false };
    // An override is no longer the measured figure it started as; saying so
    // would be presenting your own number as evidence.
    return { ...override, measured: false, owned: true, overridden: true };
  });

  const mine = userPresets
    .filter((p) => p.source !== 'override')
    .map((p) => ({ ...p, measured: false, owned: true }));

  return [...mine, ...merged];
}

/**
 * Presets under each heading, yours first.
 *
 * "My presets" leads because it is the shortest list and the one you actually
 * maintain; the curated groups follow in their shipped order. Empty headings
 * are dropped so a fresh install looks exactly as it did before.
 *
 * A level of "any" shows everything, and a preset marked "any" shows under
 * every level - a filter here should narrow the list, never hide a preset that
 * never claimed a band.
 */
export function presetGroups(
  userPresets = [],
  shipped = PRESETS,
  level = 'any',
  { hidden = [], showHidden = false } = {},
) {
  const hiddenSet = new Set(hidden.map(nameKey));
  const all = allPresets(userPresets, shipped).map((preset) => ({
    ...preset,
    hidden: hiddenSet.has(nameKey(preset.name)),
  }));

  const matches = (preset) =>
    (level === 'any' || (preset.level ?? 'any') === 'any' || preset.level === level) &&
    (showHidden || !preset.hidden);

  const headings = [MY_PRESETS_GROUP, ...PRESET_GROUPS];
  return headings
    .map((group) => ({
      group,
      presets: all.filter((preset) => preset.group === group && matches(preset)),
    }))
    .filter((entry) => entry.presets.length > 0);
}

/** How many are hidden right now, for the "show hidden" affordance. */
export function hiddenCount(userPresets = [], shipped = PRESETS, hidden = []) {
  const hiddenSet = new Set(hidden.map(nameKey));
  return allPresets(userPresets, shipped).filter((p) => hiddenSet.has(nameKey(p.name))).length;
}

/** Exported so a backup can restore the hidden list without re-deriving it. */
export function sanitizeHidden(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const name = trim(entry, USER_PRESET_LIMITS.name);
    if (!name || seen.has(nameKey(name))) continue;
    seen.add(nameKey(name));
    out.push(name);
    if (out.length >= MAX_HIDDEN_PRESETS) break;
  }
  return out;
}

export async function loadHiddenPresets() {
  if (!hasStorage()) return [];
  const stored = await chrome.storage.local.get(HIDDEN_KEY);
  return sanitizeHidden(stored?.[HIDDEN_KEY]);
}

/** Hide it if it is showing, show it if it is hidden. Returns the new list. */
export async function toggleHiddenPreset(name) {
  const current = await loadHiddenPresets();
  const key = nameKey(name);
  const next = current.some((entry) => nameKey(entry) === key)
    ? current.filter((entry) => nameKey(entry) !== key)
    : sanitizeHidden([...current, name]);

  if (hasStorage()) await chrome.storage.local.set({ [HIDDEN_KEY]: next });
  return next;
}

export async function replaceHiddenPresets(raw) {
  const next = sanitizeHidden(raw);
  if (hasStorage()) await chrome.storage.local.set({ [HIDDEN_KEY]: next });
  return next;
}

export function onHiddenPresetsChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};

  const listener = (changes, area) => {
    if (area !== 'local' || !changes[HIDDEN_KEY]) return;
    callback(sanitizeHidden(changes[HIDDEN_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export async function loadUserPresets() {
  if (!hasStorage()) return [];
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeUserPresets(stored?.[STORAGE_KEY]);
}

/** Insert or replace one, by id. Returns the whole list. */
export async function saveUserPreset(preset) {
  const clean = sanitizeUserPreset(preset);
  if (!clean) return loadUserPresets();

  const current = await loadUserPresets();
  const next = current.filter((p) => p.id !== clean.id);
  next.unshift(clean);

  const capped = sanitizeUserPresets(next);
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: capped });
  return capped;
}

/** Delete one. Deleting an override restores the shipped preset. */
export async function removeUserPreset(id) {
  const current = await loadUserPresets();
  const next = current.filter((p) => p.id !== id);
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export async function replaceUserPresets(raw) {
  const next = sanitizeUserPresets(raw);
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export function onUserPresetsChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};

  const listener = (changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    callback(sanitizeUserPresets(changes[STORAGE_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
