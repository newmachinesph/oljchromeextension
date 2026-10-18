import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAX_ENTRIES,
  MAX_NOTE,
  sanitizeBook,
  isBlocked,
  noteFor,
  memoryFor,
  jobsOpened,
  loadBook,
  setBlocked,
  setNote,
  rememberSignals,
  replaceBook,
  clearBook,
} from '../src/core/employer-book.js';

const STORAGE_KEY = 'ojRateFilterEmployers';
const NOW = Date.parse('2026-08-20T10:00:00Z');

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

describe('sanitizeBook', () => {
  it('rejects anything that is not a map of entries', () => {
    expect(sanitizeBook(null).size).toBe(0);
    expect(sanitizeBook([]).size).toBe(0);
    expect(sanitizeBook('x').size).toBe(0);
    expect(sanitizeBook({ 'young publisher': 'nope' }).size).toBe(0);
  });

  it('keeps a blocked employer, trimming the name and the note', () => {
    const book = sanitizeBook(
      { 'young publisher': { name: '  Young Publisher ', blocked: true, note: 'x'.repeat(700) } },
      NOW,
    );
    const entry = book.get('young publisher');
    expect(entry.name).toBe('Young Publisher');
    expect(entry.blocked).toBe(true);
    expect(entry.note).toHaveLength(MAX_NOTE);
    expect(entry.updatedAt).toBe(NOW);
  });

  it('drops an entry that says nothing', () => {
    const book = sanitizeBook({
      'a b': { name: 'A B', blocked: false, note: '', newAccount: null, censored: null },
      'c d': { name: 'C D', blocked: false, note: '   ' },
    });
    expect(book.size).toBe(0);
  });

  it('keeps remembered signals on their own', () => {
    const book = sanitizeBook({ acme: { name: 'Acme', newAccount: true, censored: false } });
    expect(memoryFor(book, 'Acme')).toEqual({ newAccount: true, censored: false });
  });

  it('drops the oldest beyond the cap', () => {
    const raw = {};
    for (let i = 0; i < MAX_ENTRIES + 5; i += 1) {
      raw[`e${i}`] = { name: `E${i}`, blocked: true, updatedAt: i };
    }
    const book = sanitizeBook(raw, NOW);
    expect(book.size).toBe(MAX_ENTRIES);
    expect(book.has('e0')).toBe(false);
    expect(book.has(`e${MAX_ENTRIES + 4}`)).toBe(true);
  });
});

describe('lookups', () => {
  const book = sanitizeBook({
    'young publisher': { name: 'Young Publisher', blocked: true, note: 'asked for a free trial' },
  });

  it('compare on the normalised key, however the card spelled it', () => {
    expect(isBlocked(book, 'Young Publisher ')).toBe(true);
    expect(isBlocked(book, 'YOUNG   publisher')).toBe(true);
    expect(isBlocked(book, 'Old Publisher')).toBe(false);
    expect(noteFor(book, 'young publisher')).toBe('asked for a free trial');
    expect(noteFor(book, 'nobody')).toBe('');
  });

  it('never match an empty name', () => {
    expect(isBlocked(book, '')).toBe(false);
    expect(isBlocked(book, null)).toBe(false);
    expect(memoryFor(book, undefined)).toBeNull();
    expect(memoryFor(null, 'Young Publisher')).toBeNull();
  });
});

describe('the store', () => {
  it('is empty without storage', async () => {
    expect((await loadBook()).size).toBe(0);
    expect((await setBlocked('Acme', true)).size).toBe(0);
  });

  it('blocks and unblocks, and forgets an entry that ends up empty', async () => {
    installStorage();
    let book = await setBlocked('Acme Corp', true);
    expect(isBlocked(book, 'acme corp')).toBe(true);
    expect(book.get('acme corp').name).toBe('Acme Corp');

    book = await setBlocked('acme corp', false);
    expect(book.has('acme corp')).toBe(false);
  });

  it('keeps a note, and clears it', async () => {
    installStorage();
    let book = await setNote('Acme', 'ghosted me in May');
    expect(noteFor(book, 'Acme')).toBe('ghosted me in May');

    book = await setNote('Acme', '');
    expect(book.has('acme')).toBe(false);
  });

  it('remembers what a job page said, without touching a block or note', async () => {
    installStorage();
    await setBlocked('Acme', true);
    const book = await rememberSignals('Acme', { newAccount: true, censored: false });
    expect(isBlocked(book, 'Acme')).toBe(true);
    expect(memoryFor(book, 'Acme')).toEqual({ newAccount: true, censored: false });
  });

  it('ignores a nameless employer', async () => {
    installStorage();
    expect((await setBlocked('', true)).size).toBe(0);
    expect((await setNote('   ', 'x')).size).toBe(0);
    expect((await rememberSignals(null, { newAccount: true })).size).toBe(0);
  });

  it('replaces and clears', async () => {
    installStorage();
    await setBlocked('Acme', true);
    const book = await replaceBook({ beta: { name: 'Beta', blocked: true } });
    expect(book.has('acme')).toBe(false);
    expect(book.has('beta')).toBe(true);
    expect((await clearBook()).size).toBe(0);
  });
});

describe('employers known by id', () => {
  it('keys an anonymous employer by the id a job page gave', async () => {
    installStorage();
    let book = await setBlocked({ name: 'Not Given', id: '966063' }, true);
    expect(book.has('#966063')).toBe(true);
    expect(isBlocked(book, { name: 'Not Given', id: '966063' })).toBe(true);
    expect(isBlocked(book, { name: 'Not Given', id: '1' })).toBe(false);
    // A card, which only has the placeholder name, still matches nobody.
    expect(isBlocked(book, 'Not Given')).toBe(false);
  });

  it('prefers the name, and finds a named entry by its id later', async () => {
    installStorage();
    let book = await rememberSignals({ name: 'Acme', id: '42' }, { newAccount: true });
    expect(book.get('acme').id).toBe('42');
    // The same employer, seen on a page that withheld the name.
    expect(memoryFor(book, { name: 'Not Given', id: '42' })).toEqual({ newAccount: true, censored: null });
    book = await setNote({ name: '', id: '42' }, 'same people as Acme');
    expect(noteFor(book, 'Acme')).toBe('same people as Acme');
    expect(book.has('#42')).toBe(false);
  });

  it('moves an id-keyed entry under the name once the name is known', async () => {
    installStorage();
    await setBlocked({ name: 'Not Given', id: '7' }, true);
    const book = await rememberSignals({ name: 'Beta Ltd', id: '7' }, { censored: true });
    expect(book.has('#7')).toBe(false);
    expect(isBlocked(book, 'Beta Ltd')).toBe(true);
    expect(memoryFor(book, 'Beta Ltd')).toEqual({ newAccount: null, censored: true });
  });

  it('counts the jobs you opened from one employer, once each', async () => {
    installStorage();
    await rememberSignals({ name: 'Acme', id: '42' }, { jobKey: 'j1' });
    await rememberSignals({ name: 'Acme', id: '42' }, { jobKey: 'j1' });
    const book = await rememberSignals({ name: 'Not Given', id: '42' }, { jobKey: 'j2' });
    expect(jobsOpened(book, { name: 'Not Given', id: '42' })).toBe(2);
    expect(jobsOpened(book, 'Acme')).toBe(2);
    expect(jobsOpened(book, 'Nobody')).toBe(0);
  });

  it('survives sanitising, and an entry that only knows jobs is kept', () => {
    const book = sanitizeBook({
      '#5': { name: '', id: 5, jobs: ['a', 'b', 7, null], blocked: false },
      acme: { name: 'Acme', id: '42', jobs: 'x' },
    });
    expect(book.get('#5').jobs).toEqual(['a', 'b']);
    expect(book.get('#5').id).toBe('5');
    expect(book.has('acme')).toBe(false);
  });
});
