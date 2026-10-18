import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadViewed,
  loadViewedList,
  setViewed,
  replaceViewed,
  clearViewed,
  MAX_VIEWED,
} from '../src/core/viewed.js';

const STORAGE_KEY = 'ojRateFilterViewed';

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

describe('setViewed / loadViewed', () => {
  it('returns an empty set with no storage', async () => {
    expect((await loadViewed()).size).toBe(0);
  });

  it('marks a job viewed and reads it back', async () => {
    installStorage();
    await setViewed('123');
    const set = await loadViewed();
    expect(set.has('123')).toBe(true);
  });

  it('does not duplicate a re-viewed job but moves it to newest', async () => {
    installStorage();
    await setViewed('a');
    await setViewed('b');
    await setViewed('a');
    expect(await loadViewedList()).toEqual(['b', 'a']);
  });

  it('un-views when told to', async () => {
    installStorage();
    await setViewed('123');
    await setViewed('123', false);
    expect((await loadViewed()).has('123')).toBe(false);
  });
});

describe('replaceViewed / clearViewed', () => {
  it('replaces and clears the list', async () => {
    installStorage();
    await setViewed('123');
    await replaceViewed(['x', 'y']);
    expect([...(await loadViewed())].sort()).toEqual(['x', 'y']);
    await clearViewed();
    expect((await loadViewed()).size).toBe(0);
  });

  it('bounds a restored list to the cap', async () => {
    installStorage();
    const many = Array.from({ length: MAX_VIEWED + 10 }, (_, i) => `k${i}`);
    await replaceViewed(many);
    expect((await loadViewed()).size).toBe(MAX_VIEWED);
  });
});
