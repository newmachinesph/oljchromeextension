import { describe, it, expect, beforeEach } from 'vitest';
import {
  EMPTY_ABOUT,
  ABOUT_LIMITS,
  newId,
  sanitizeAbout,
  loadAbout,
  saveAbout,
  replaceAbout,
} from '../src/core/about.js';

const STORAGE_KEY = 'ojRateFilterAbout';

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

describe('sanitizeAbout', () => {
  it('gives every field an empty default and no links', () => {
    const about = sanitizeAbout(null);
    for (const key of ['name', 'email', 'phone', 'location', 'timezone', 'availability', 'equipment', 'languages', 'other']) {
      expect(about[key]).toBe('');
    }
    expect(about.links).toEqual([]);
    expect(sanitizeAbout('nonsense').links).toEqual([]);
  });

  it('trims and caps the flat fields, coercing junk to a string', () => {
    const about = sanitizeAbout({
      name: '  Maria Santos  ',
      email: 'maria@example.com',
      other: 'x'.repeat(5000),
      headline: 42,
      languages: { junk: true },
    });
    expect(about.name).toBe('Maria Santos');
    expect(about.email).toBe('maria@example.com');
    expect(about.other).toHaveLength(ABOUT_LIMITS.other);
    expect(about.languages).toBe('');
  });

  it('keeps links, generates a missing id, caps the count, and drops an empty one', () => {
    const raw = {
      links: [
        { label: 'Portfolio', url: 'https://me.example' },
        { id: 'keepme', label: 'LinkedIn', url: 'https://in.example' },
        { label: '', url: '  ' },
      ],
    };
    const about = sanitizeAbout(raw);
    expect(about.links).toHaveLength(2);
    expect(about.links[0].id).toBeTruthy();
    expect(about.links[1].id).toBe('keepme');
    expect(about.links[1].label).toBe('LinkedIn');
  });

  it('caps the number of links', () => {
    const many = Array.from({ length: 40 }, (unused, i) => ({ label: `L${i}`, url: `https://x${i}.example` }));
    expect(sanitizeAbout({ links: many }).links).toHaveLength(ABOUT_LIMITS.links);
  });
});

describe('newId', () => {
  it('produces distinct short ids', () => {
    const a = newId();
    const b = newId();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe('the store', () => {
  it('is the empty shape without storage', async () => {
    expect(await loadAbout()).toEqual(EMPTY_ABOUT);
  });

  it('merges a patch and reloads it', async () => {
    installStorage();
    let about = await saveAbout({ name: 'Maria' });
    expect(about.name).toBe('Maria');

    about = await saveAbout({ location: 'Cebu' });
    expect(about.name).toBe('Maria'); // the earlier field survives a later patch
    expect(about.location).toBe('Cebu');

    expect((await loadAbout()).name).toBe('Maria');
  });

  it('replaces the whole object', async () => {
    installStorage();
    await saveAbout({ name: 'Maria', location: 'Cebu' });
    const about = await replaceAbout({ name: 'Only name' });
    expect(about.name).toBe('Only name');
    expect(about.location).toBe('');
  });
});
