import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadJobNotes,
  setJobNote,
  removeJobNote,
  replaceJobNotes,
  clearJobNotes,
  sanitizeJobNotes,
  MAX_NOTE_LENGTH,
} from '../src/core/job-notes.js';

const STORAGE_KEY = 'ojRateFilterJobNotes';

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

describe('sanitizeJobNotes', () => {
  it('drops blank notes and non-maps', () => {
    expect(sanitizeJobNotes(null).size).toBe(0);
    expect(sanitizeJobNotes({ a: { text: '   ' } }).size).toBe(0);
  });

  it('caps note length', () => {
    const long = 'x'.repeat(MAX_NOTE_LENGTH + 50);
    const map = sanitizeJobNotes({ a: { text: long, updatedAt: 1 } });
    expect(map.get('a').text.length).toBe(MAX_NOTE_LENGTH);
  });
});

describe('setJobNote / loadJobNotes', () => {
  it('saves and reads a note', async () => {
    installStorage();
    await setJobNote('123', 'confirm salary');
    const map = await loadJobNotes();
    expect(map.get('123').text).toBe('confirm salary');
    expect(typeof map.get('123').updatedAt).toBe('number');
  });

  it('clearing the text deletes the note', async () => {
    installStorage();
    await setJobNote('123', 'note');
    await setJobNote('123', '   ');
    expect((await loadJobNotes()).has('123')).toBe(false);
  });

  it('removeJobNote deletes it', async () => {
    installStorage();
    await setJobNote('123', 'note');
    await removeJobNote('123');
    expect((await loadJobNotes()).has('123')).toBe(false);
  });
});

describe('replaceJobNotes / clearJobNotes', () => {
  it('replaces and clears', async () => {
    installStorage();
    await setJobNote('123', 'a');
    await replaceJobNotes({ '999': { text: 'restored', updatedAt: 1 } });
    const map = await loadJobNotes();
    expect(map.has('123')).toBe(false);
    expect(map.get('999').text).toBe('restored');
    await clearJobNotes();
    expect((await loadJobNotes()).size).toBe(0);
  });
});
