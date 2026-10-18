import { describe, it, expect, beforeEach } from 'vitest';
import {
  EMPTY_PROFILE,
  sanitizeProfile,
  isProfileEmpty,
  loadProfile,
  saveProfile,
  clearProfile,
  PROFILE_LIMITS,
} from '../src/core/profile.js';

const STORAGE_KEY = 'ojRateFilterProfile';

function installStorage(initial) {
  const store = initial === undefined ? {} : { [STORAGE_KEY]: initial };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => (store[key] === undefined ? {} : { [key]: store[key] }),
        set: async (patch) => Object.assign(store, patch),
      },
    },
  };
  return store;
}

beforeEach(() => {
  delete globalThis.chrome;
});

describe('sanitizeProfile', () => {
  it('turns anything at all into a usable profile', () => {
    expect(sanitizeProfile(null)).toEqual(EMPTY_PROFILE);
    expect(sanitizeProfile('a string')).toEqual(EMPTY_PROFILE);
    expect(sanitizeProfile(undefined)).toEqual(EMPTY_PROFILE);
  });

  it('trims what it is given', () => {
    expect(sanitizeProfile({ name: '  Maria  ' }).name).toBe('Maria');
  });

  it('bounds a resume rather than refusing it', () => {
    // Pasting a whole CV must not make the store unreadable, but it must also
    // not throw the CV away.
    const long = 'x'.repeat(PROFILE_LIMITS.resume + 500);
    expect(sanitizeProfile({ resume: long }).resume).toHaveLength(PROFILE_LIMITS.resume);
  });

  it('keeps only experience entries with something in them', () => {
    const clean = sanitizeProfile({
      experience: [
        { role: 'VA', company: 'Acme', period: '2023', summary: 'Did things' },
        { role: '', company: '', period: '', summary: '' },
        'not an entry',
        null,
      ],
    });
    expect(clean.experience).toHaveLength(1);
    expect(clean.experience[0].role).toBe('VA');
  });

  it('keeps a partly filled entry - you are mid-typing', () => {
    expect(sanitizeProfile({ experience: [{ role: 'VA' }] }).experience).toHaveLength(1);
  });

  it('bounds the number of entries', () => {
    const many = Array.from({ length: PROFILE_LIMITS.entries + 5 }, (_, i) => ({ role: `r${i}` }));
    expect(sanitizeProfile({ experience: many }).experience).toHaveLength(PROFILE_LIMITS.entries);
  });

  it('deduplicates and bounds target roles', () => {
    const clean = sanitizeProfile({ targetRoles: [' VA ', 'VA', '', 'Data Entry'] });
    expect(clean.targetRoles).toEqual(['VA', 'Data Entry']);
  });

  it('ignores experience that is not a list', () => {
    expect(sanitizeProfile({ experience: 'VA at Acme' }).experience).toEqual([]);
  });
});

describe('isProfileEmpty', () => {
  it('is true for a fresh profile', () => {
    expect(isProfileEmpty(EMPTY_PROFILE)).toBe(true);
    expect(isProfileEmpty({})).toBe(true);
    expect(isProfileEmpty(null)).toBe(true);
  });

  it('is false once any single field is filled', () => {
    expect(isProfileEmpty({ name: 'Maria' })).toBe(false);
    expect(isProfileEmpty({ resume: 'text' })).toBe(false);
    expect(isProfileEmpty({ targetRoles: ['VA'] })).toBe(false);
    expect(isProfileEmpty({ experience: [{ role: 'VA' }] })).toBe(false);
  });

  it('is still true when a field holds only whitespace', () => {
    expect(isProfileEmpty({ name: '   ' })).toBe(true);
  });
});

describe('the store', () => {
  it('reads an empty profile without chrome', async () => {
    expect(await loadProfile()).toEqual(EMPTY_PROFILE);
  });

  it('round-trips what it saves', async () => {
    const store = installStorage();
    const saved = await saveProfile({ name: 'Maria', email: 'maria@example.com' });

    expect(saved.name).toBe('Maria');
    expect(store[STORAGE_KEY].email).toBe('maria@example.com');
    expect(await loadProfile()).toMatchObject({ name: 'Maria' });
  });

  it('merges a patch rather than replacing the profile', async () => {
    // The editor saves as you type; a whole-object write would race with itself
    // and lose whichever field was not being typed into.
    installStorage();
    await saveProfile({ name: 'Maria', resume: 'Years of things' });
    const after = await saveProfile({ phone: '0917' });

    expect(after).toMatchObject({ name: 'Maria', resume: 'Years of things', phone: '0917' });
  });

  it('empties it on request', async () => {
    installStorage({ name: 'Maria', resume: 'text' });
    expect(await clearProfile()).toEqual(EMPTY_PROFILE);
    expect(await loadProfile()).toEqual(EMPTY_PROFILE);
  });

  it('survives storage holding junk', async () => {
    installStorage('not a profile');
    expect(await loadProfile()).toEqual(EMPTY_PROFILE);
  });

  it('lives in local storage, never in sync', async () => {
    // A resume exceeds sync's 8KB per-item cap, and this is the most personal
    // thing the extension holds.
    const seen = [];
    globalThis.chrome = {
      storage: {
        local: {
          get: async () => ({}),
          set: async () => seen.push('local'),
        },
        sync: {
          get: async () => {
            seen.push('sync');
            return {};
          },
          set: async () => seen.push('sync'),
        },
      },
    };

    await saveProfile({ name: 'Maria' });
    expect(seen).not.toContain('sync');
    expect(seen).toContain('local');
  });
});
