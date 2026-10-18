import { describe, it, expect, beforeEach } from 'vitest';
import {
  tagKey,
  sanitizeTagColors,
  loadTagColors,
  setTagColor,
  renameTagColor,
  removeTagColor,
  clearTagColors,
} from '../src/core/tag-colors.js';

const STORAGE_KEY = 'ojRateFilterTagColors';

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

describe('tagKey', () => {
  it('lower-cases and trims, rejecting blanks', () => {
    expect(tagKey('  Day Shift ')).toBe('day shift');
    expect(tagKey('')).toBe('');
    expect(tagKey(null)).toBe('');
  });
});

describe('sanitizeTagColors', () => {
  it('keeps hex colours under lower-cased keys, drops junk', () => {
    const map = sanitizeTagColors({ Urgent: '#FF0000', bad: 'nope', '': '#00ff00' });
    expect([...map.entries()]).toEqual([['urgent', '#ff0000']]);
  });
});

describe('setTagColor', () => {
  it('sets, overwrites and clears under a lower-cased key', async () => {
    installStorage();
    await setTagColor('Urgent', '#FF0000');
    expect((await loadTagColors()).get('urgent')).toBe('#ff0000');
    await setTagColor('urgent', '');
    expect((await loadTagColors()).has('urgent')).toBe(false);
  });

  it('is a no-op without storage', async () => {
    expect((await setTagColor('Urgent', '#ff0000')).size).toBe(0);
  });
});

describe('renameTagColor', () => {
  it('moves a colour to the new tag key without overwriting an existing one', async () => {
    installStorage();
    await setTagColor('Now', '#ff0000');
    await renameTagColor('Now', 'Urgent');
    const map = await loadTagColors();
    expect(map.get('urgent')).toBe('#ff0000');
    expect(map.has('now')).toBe(false);
  });
});

describe('removeTagColor', () => {
  it('drops a tag colour', async () => {
    installStorage();
    await setTagColor('Urgent', '#ff0000');
    await removeTagColor('URGENT');
    expect((await loadTagColors()).has('urgent')).toBe(false);
  });
});

describe('serialized writes', () => {
  it('keeps both colours from concurrent sets', async () => {
    installStorage();
    await Promise.all([setTagColor('a', '#ff0000'), setTagColor('b', '#00ff00')]);
    const map = await loadTagColors();
    expect(map.get('a')).toBe('#ff0000');
    expect(map.get('b')).toBe('#00ff00');
  });
});
