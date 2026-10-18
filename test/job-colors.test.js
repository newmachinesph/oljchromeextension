import { describe, it, expect, beforeEach } from 'vitest';
import {
  cleanColor,
  sanitizeJobColors,
  loadJobColors,
  setJobColor,
  clearJobColors,
} from '../src/core/job-colors.js';

const STORAGE_KEY = 'ojRateFilterJobColors';

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

describe('cleanColor', () => {
  it('keeps a #rrggbb, lower-cased, and rejects the rest', () => {
    expect(cleanColor('#FF8800')).toBe('#ff8800');
    expect(cleanColor('  #abcdef ')).toBe('#abcdef');
    expect(cleanColor('red')).toBe('');
    expect(cleanColor('#fff')).toBe('');
    expect(cleanColor(null)).toBe('');
  });
});

describe('sanitizeJobColors', () => {
  it('drops junk keys and invalid colours', () => {
    const map = sanitizeJobColors({ a: '#ff0000', b: 'nope', '': '#00ff00' });
    expect([...map.entries()]).toEqual([['a', '#ff0000']]);
  });

  it('returns an empty map for non-objects', () => {
    expect(sanitizeJobColors(null).size).toBe(0);
    expect(sanitizeJobColors([]).size).toBe(0);
  });
});

describe('setJobColor', () => {
  it('sets, overwrites, and clears a colour', async () => {
    installStorage();
    await setJobColor('job-1', '#FF0000');
    expect((await loadJobColors()).get('job-1')).toBe('#ff0000');
    await setJobColor('job-1', '#00ff00');
    expect((await loadJobColors()).get('job-1')).toBe('#00ff00');
    await setJobColor('job-1', '');
    expect((await loadJobColors()).has('job-1')).toBe(false);
  });

  it('ignores an invalid colour by clearing rather than storing junk', async () => {
    installStorage();
    await setJobColor('job-1', 'banana');
    expect((await loadJobColors()).has('job-1')).toBe(false);
  });

  it('is a no-op without storage', async () => {
    const map = await setJobColor('job-1', '#ff0000');
    expect(map.size).toBe(0);
  });
});

describe('clearJobColors', () => {
  it('empties the store', async () => {
    installStorage({ 'job-1': '#ff0000' });
    await clearJobColors();
    expect((await loadJobColors()).size).toBe(0);
  });
});

describe('serialized writes', () => {
  it('keeps both colours from concurrent sets', async () => {
    installStorage();
    await Promise.all([setJobColor('a', '#ff0000'), setJobColor('b', '#00ff00')]);
    const map = await loadJobColors();
    expect(map.get('a')).toBe('#ff0000');
    expect(map.get('b')).toBe('#00ff00');
  });
});
