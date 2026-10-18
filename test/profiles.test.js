import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAX_PROFILES,
  sanitizeProfiles,
  createProfile,
  loadProfiles,
  saveProfile,
  removeProfile,
  setDefaultProfile,
  defaultProfile,
  profileById,
  isUsable,
  hasUsableProfile,
  buildDraftProfile,
  assembleBody,
  migrateLegacy,
} from '../src/core/profiles.js';

const PROFILES_KEY = 'ojRateFilterProfiles';
const ABOUT_KEY = 'ojRateFilterAbout';
const LEGACY_KEY = 'ojRateFilterProfile';

function installStorage(initial = {}) {
  const store = { ...initial };
  globalThis.chrome = {
    storage: {
      local: {
        // Mirrors chrome.storage.local.get: a string key or an array of keys.
        get: async (keys) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const key of list) if (store[key] !== undefined) out[key] = store[key];
          return out;
        },
        set: async (patch) => Object.assign(store, patch),
        remove: async (key) => {
          delete store[key];
        },
      },
    },
  };
  return store;
}

beforeEach(() => {
  delete globalThis.chrome;
});

const profile = (over = {}) => ({
  id: 'p1',
  label: 'Virtual Assistant',
  headline: 'Admin VA',
  targetRoles: ['virtual assistant'],
  body: 'Two years of admin work.',
  source: 'typed',
  isDefault: true,
  updatedAt: 1,
  ...over,
});

describe('sanitizeProfiles', () => {
  it('returns an array and caps the fields', () => {
    const list = sanitizeProfiles([
      profile({ label: 'x'.repeat(200), body: 'y'.repeat(50000), targetRoles: Array(50).fill('r') }),
    ]);
    expect(Array.isArray(list)).toBe(true);
    expect(list[0].label.length).toBeLessThanOrEqual(80);
    expect(list[0].body.length).toBeLessThanOrEqual(20000);
    expect(list[0].targetRoles.length).toBeLessThanOrEqual(30);
  });

  it('gives an entry without an id a fresh one', () => {
    const [p] = sanitizeProfiles([{ label: 'A', isDefault: true }]);
    expect(p.id).toBeTruthy();
  });

  it('makes exactly one profile the default', () => {
    const none = sanitizeProfiles([profile({ id: 'a', isDefault: false }), profile({ id: 'b', isDefault: false })]);
    expect(none.filter((p) => p.isDefault)).toHaveLength(1);
    expect(none[0].isDefault).toBe(true);

    const many = sanitizeProfiles([profile({ id: 'a' }), profile({ id: 'b', isDefault: true })]);
    expect(many.filter((p) => p.isDefault)).toHaveLength(1);
    expect(many[0].isDefault).toBe(true);
  });

  it('caps the number of profiles, oldest first', () => {
    const raw = Array.from({ length: MAX_PROFILES + 3 }, (unused, i) => profile({ id: `p${i}`, updatedAt: i, isDefault: false }));
    const list = sanitizeProfiles(raw);
    expect(list).toHaveLength(MAX_PROFILES);
    expect(list.some((p) => p.id === 'p0')).toBe(false);
  });
});

describe('CRUD', () => {
  it('creates a profile with an id, the first one default', async () => {
    installStorage();
    const list = await createProfile({ label: 'VA' });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBeTruthy();
    expect(list[0].isDefault).toBe(true);

    const two = await createProfile({ label: 'Bookkeeper' });
    expect(two).toHaveLength(2);
    expect(two.filter((p) => p.isDefault)).toHaveLength(1);
  });

  it('moves the default and promotes another when the default is removed', async () => {
    const store = installStorage({ [PROFILES_KEY]: [profile({ id: 'a' }), profile({ id: 'b', isDefault: false })] });
    let list = await setDefaultProfile('b');
    expect(profileById(list, 'b').isDefault).toBe(true);
    expect(profileById(list, 'a').isDefault).toBe(false);

    list = await removeProfile('b');
    expect(list.filter((p) => p.isDefault)).toHaveLength(1);
    expect(store[PROFILES_KEY].length).toBe(1);
  });

  it('upserts on save', async () => {
    installStorage({ [PROFILES_KEY]: [profile({ id: 'a', label: 'Old' })] });
    const list = await saveProfile({ id: 'a', label: 'New', headline: 'h', body: 'b', targetRoles: [] });
    expect(profileById(list, 'a').label).toBe('New');
  });
});

describe('selectors', () => {
  it('finds the default and by id, and judges usability', () => {
    const list = [profile({ id: 'a', isDefault: false }), profile({ id: 'b', isDefault: true })];
    expect(defaultProfile(list).id).toBe('b');
    expect(profileById(list, 'a').id).toBe('a');
    expect(isUsable(profile({ body: 'x', headline: '' }))).toBe(true);
    expect(isUsable(profile({ body: '', headline: 'x' }))).toBe(true);
    expect(isUsable(profile({ body: '', headline: '' }))).toBe(false);
    expect(hasUsableProfile([profile({ body: '', headline: '' })])).toBe(false);
    expect(hasUsableProfile(list)).toBe(true);
  });
});

describe('buildDraftProfile', () => {
  it('carries the About context and the profile, but never email or phone', () => {
    const about = {
      name: 'Maria',
      email: 'maria@example.com',
      phone: '0917',
      location: 'Cebu',
      timezone: 'GMT+8',
      availability: '40 hrs/week',
      equipment: 'i5 laptop, fibre',
      languages: 'English',
      other: 'quick learner',
      schedulingUrl: 'https://calendly.com/maria',
      links: [{ id: 'l1', label: 'Portfolio', url: 'https://me.example' }],
      contacts: [
        { id: 'c1', kind: 'telegram', value: '@maria' },
        { id: 'c2', kind: 'whatsapp', value: '+639171234567' },
      ],
    };
    const built = buildDraftProfile(about, profile({ headline: 'Admin VA', body: 'resume', targetRoles: ['va'] }));
    expect(built).toEqual({
      name: 'Maria',
      headline: 'Admin VA',
      targetRoles: ['va'],
      body: 'resume',
      location: 'Cebu',
      timezone: 'GMT+8',
      availability: '40 hrs/week',
      equipment: 'i5 laptop, fibre',
      languages: 'English',
      other: 'quick learner',
      // Sent on purpose: a booking link exists to reach the employer, and a
      // draft that offers to talk without a way to book it does half the job.
      schedulingUrl: 'https://calendly.com/maria',
      links: [{ label: 'Portfolio', url: 'https://me.example' }],
    });

    // The privacy contract, asserted rather than assumed: handles are stored so
    // you can paste one in yourself, not so a model can hand them out.
    const serialised = JSON.stringify(built);
    expect(serialised).not.toContain('@maria');
    expect(serialised).not.toContain('639171234567');
    expect(built).not.toHaveProperty('contacts');
    expect(JSON.stringify(built)).not.toContain('maria@example.com');
    expect(JSON.stringify(built)).not.toContain('0917');
  });
});

describe('migration', () => {
  it('assembles a body from resume plus experience', () => {
    const body = assembleBody('My resume.', [
      { role: 'VA', company: 'X', period: '2024', summary: 'admin' },
    ]);
    expect(body).toContain('My resume.');
    expect(body).toContain('## Experience');
    expect(body).toContain('VA, X, 2024');
    expect(body).toContain('admin');
  });

  it('splits a legacy profile into About and one default profile', () => {
    const { about, profiles } = migrateLegacy({
      name: 'Maria',
      email: 'maria@example.com',
      phone: '0917',
      location: 'Cebu',
      headline: 'Admin VA',
      resume: 'Two years.',
      experience: [{ role: 'VA', company: 'X', period: '2024', summary: 'admin' }],
      targetRoles: ['virtual assistant'],
    });
    expect(about.name).toBe('Maria');
    expect(about.email).toBe('maria@example.com');
    expect(about.links).toEqual([]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].label).toBe('My profile');
    expect(profiles[0].headline).toBe('Admin VA');
    expect(profiles[0].isDefault).toBe(true);
    expect(profiles[0].body).toContain('Two years.');
    expect(profiles[0].body).toContain('VA, X, 2024');
  });

  it('migrates once on load, then leaves the new store alone', async () => {
    const store = installStorage({
      [LEGACY_KEY]: { name: 'Maria', email: 'm@e.co', location: 'Cebu', resume: 'r', headline: 'h', experience: [], targetRoles: [] },
    });
    const list = await loadProfiles();
    expect(list).toHaveLength(1);
    expect(store[PROFILES_KEY]).toBeTruthy();
    expect(store[ABOUT_KEY].name).toBe('Maria');
    expect(store[LEGACY_KEY]).toBeUndefined(); // removed after migrating

    // A second load does not re-migrate (legacy is gone; new store stands).
    const again = await loadProfiles();
    expect(again).toHaveLength(1);
  });
});
