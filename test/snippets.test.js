import { describe, it, expect, beforeEach } from 'vitest';
import {
  sanitizeSnippets,
  loadSnippets,
  saveSnippet,
  removeSnippet,
  clearSnippets,
  MAX_TITLE,
} from '../src/core/snippets.js';

const STORAGE_KEY = 'ojRateFilterSnippets';

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

describe('sanitizeSnippets', () => {
  it('keeps titled/bodied entries, trims titles, drops empties', () => {
    const list = sanitizeSnippets([
      { id: 'a', title: '  Intro  ', body: 'Hello' },
      { id: 'b', title: '', body: '' },
      'nope',
    ]);
    expect(list).toEqual([{ id: 'a', title: 'Intro', body: 'Hello' }]);
  });
  it('caps the title length', () => {
    const long = 'x'.repeat(MAX_TITLE + 10);
    expect(sanitizeSnippets([{ id: 'a', title: long, body: 'y' }])[0].title.length).toBe(MAX_TITLE);
  });
  it('returns [] for non-arrays', () => {
    expect(sanitizeSnippets(null)).toEqual([]);
    expect(sanitizeSnippets({})).toEqual([]);
  });
});

describe('saveSnippet', () => {
  it('adds a new snippet with an id', async () => {
    installStorage();
    const list = await saveSnippet({ title: 'Intro', body: 'Hi there' });
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Intro');
    expect(list[0].id).toBeTruthy();
  });

  it('updates an existing snippet by id', async () => {
    installStorage();
    let list = await saveSnippet({ title: 'Intro', body: 'v1' });
    const id = list[0].id;
    list = await saveSnippet({ id, title: 'Intro', body: 'v2' });
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe('v2');
  });

  it('ignores an entirely empty snippet', async () => {
    installStorage();
    expect(await saveSnippet({ title: '   ', body: '' })).toEqual([]);
  });
});

describe('removeSnippet / clearSnippets', () => {
  it('removes one and clears all', async () => {
    installStorage();
    let list = await saveSnippet({ title: 'A', body: 'a' });
    const id = list[0].id;
    await saveSnippet({ title: 'B', body: 'b' });
    list = await removeSnippet(id);
    expect(list.map((s) => s.title)).toEqual(['B']);
    await clearSnippets();
    expect(await loadSnippets()).toEqual([]);
  });
});

describe('serialized writes', () => {
  it('keeps both snippets from concurrent saves', async () => {
    installStorage();
    await Promise.all([saveSnippet({ title: 'A', body: 'a' }), saveSnippet({ title: 'B', body: 'b' })]);
    expect((await loadSnippets()).map((s) => s.title).sort()).toEqual(['A', 'B']);
  });
});
