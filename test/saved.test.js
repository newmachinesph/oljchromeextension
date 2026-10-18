import { describe, it, expect, beforeEach } from 'vitest';
import {
  sanitizeSaved,
  loadSaved,
  setSaved,
  removeSaved,
  toggleSaved,
  replaceSaved,
  clearSaved,
  MAX_SAVED,
  jobKey,
} from '../src/core/saved.js';

const STORAGE_KEY = 'ojRateFilterSaved';

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

describe('sanitizeSaved', () => {
  it('rejects anything that is not a record map', () => {
    expect(sanitizeSaved(null).size).toBe(0);
    expect(sanitizeSaved([]).size).toBe(0);
    expect(sanitizeSaved('nope').size).toBe(0);
  });

  it('keeps a clean snapshot and defaults missing fields', () => {
    const map = sanitizeSaved({ '123': { savedAt: 5, title: 'VA', url: 'u', employer: 'Acme' } });
    expect(map.get('123')).toEqual({
      savedAt: 5,
      title: 'VA',
      url: 'u',
      employer: 'Acme',
      usdPerMonth: null,
    });
  });

  it('drops keys that are empty or absurdly long', () => {
    const long = 'x'.repeat(200);
    const map = sanitizeSaved({ '': { title: 'a' }, [long]: { title: 'b' }, ok: { title: 'c' } });
    expect([...map.keys()]).toEqual(['ok']);
  });

  it('drops the oldest saves when over the cap', () => {
    const raw = {};
    for (let i = 0; i < MAX_SAVED + 5; i += 1) raw[`k${i}`] = { savedAt: i, title: 't' };
    const map = sanitizeSaved(raw, 0, MAX_SAVED);
    expect(map.size).toBe(MAX_SAVED);
    expect(map.has('k0')).toBe(false);
    expect(map.has('k4')).toBe(false);
    expect(map.has('k5')).toBe(true);
  });
});

describe('setSaved / loadSaved', () => {
  it('returns an empty map with no storage', async () => {
    expect((await loadSaved()).size).toBe(0);
  });

  it('saves a job and reads it back', async () => {
    installStorage();
    await setSaved('123', { title: 'VA', url: 'u', employer: 'Acme', usdPerMonth: 650 });
    const map = await loadSaved();
    expect(map.get('123')).toMatchObject({ title: 'VA', employer: 'Acme', usdPerMonth: 650 });
    expect(typeof map.get('123').savedAt).toBe('number');
  });

  it('keeps the original savedAt when re-saving the same job', async () => {
    installStorage();
    await setSaved('123', { title: 'VA' });
    const first = (await loadSaved()).get('123').savedAt;
    await setSaved('123', { title: 'VA updated' });
    const map = await loadSaved();
    expect(map.get('123').savedAt).toBe(first);
    expect(map.get('123').title).toBe('VA updated');
  });
});

describe('removeSaved', () => {
  it('forgets one job', async () => {
    installStorage();
    await setSaved('123', { title: 'VA' });
    await setSaved('456', { title: 'Dev' });
    await removeSaved('123');
    const map = await loadSaved();
    expect(map.has('123')).toBe(false);
    expect(map.has('456')).toBe(true);
  });
});

describe('toggleSaved', () => {
  it('saves when absent and un-saves when present', async () => {
    installStorage();
    const first = await toggleSaved('123', { title: 'VA' });
    expect(first.isSaved).toBe(true);
    expect(first.saved.has('123')).toBe(true);

    const second = await toggleSaved('123', { title: 'VA' });
    expect(second.isSaved).toBe(false);
    expect(second.saved.has('123')).toBe(false);
  });
});

describe('replaceSaved / clearSaved', () => {
  it('replaces the whole store', async () => {
    installStorage();
    await setSaved('123', { title: 'VA' });
    await replaceSaved({ '999': { savedAt: 1, title: 'Restored' } });
    const map = await loadSaved();
    expect(map.has('123')).toBe(false);
    expect(map.get('999').title).toBe('Restored');
  });

  it('empties the store', async () => {
    installStorage();
    await setSaved('123', { title: 'VA' });
    await clearSaved();
    expect((await loadSaved()).size).toBe(0);
  });
});

describe('jobKey re-export', () => {
  it('is the same stable key the other stores use', () => {
    expect(jobKey('https://www.onlinejobs.ph/jobseekers/job/some-title-987654')).toBe('987654');
  });
});
