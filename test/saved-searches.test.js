import { describe, it, expect, beforeEach } from 'vitest';
import {
  SEARCH_FIELDS,
  MAX_SEARCHES,
  nameKey,
  sanitizeSearch,
  sanitizeSearches,
  filtersFromSettings,
  settingsFromSearch,
  describeSearch,
  loadSearches,
  saveSearch,
  removeSearch,
  replaceSearches,
  clearSearches,
} from '../src/core/saved-searches.js';
import { PRESETS, findPreset } from '../src/core/presets.js';
import { DEFAULTS } from '../src/core/settings.js';

const STORAGE_KEY = 'ojRateFilterSearches';

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

describe('nameKey', () => {
  it('treats one name written loosely as one name', () => {
    expect(nameKey('AI work')).toBe(nameKey('  ai   WORK '));
  });

  it('has nothing to say about an empty name', () => {
    expect(nameKey(null)).toBe('');
    expect(nameKey('   ')).toBe('');
  });
});

describe('sanitizeSearch', () => {
  it('keeps a well-formed search', () => {
    const search = sanitizeSearch({
      name: 'Automation',
      filters: { thresholdUsdPerMonth: 1000, searchKeywords: ['n8n', 'zapier'] },
      savedAt: 1755432000000,
    });

    expect(search.name).toBe('Automation');
    expect(search.filters.searchKeywords).toEqual(['n8n', 'zapier']);
    expect(search.savedAt).toBe(1755432000000);
  });

  it('refuses a search with no name', () => {
    expect(sanitizeSearch({ filters: {} })).toBeNull();
    expect(sanitizeSearch({ name: '   ' })).toBeNull();
    expect(sanitizeSearch(null)).toBeNull();
  });

  it('keeps only the fields that describe what you are looking for', () => {
    // Display preferences must survive switching searches.
    const search = sanitizeSearch({
      name: 'X',
      filters: { thresholdUsdPerMonth: 900, wideLayout: false, showBadges: false },
    });

    expect(search.filters.thresholdUsdPerMonth).toBe(900);
    expect(search.filters.wideLayout).toBeUndefined();
    expect(search.filters.showBadges).toBeUndefined();
  });

  it('tidies the keyword lists', () => {
    const search = sanitizeSearch({
      name: 'X',
      filters: { searchKeywords: ['  n8n ', '', 'n8n', null, 'zapier'] },
    });

    expect(search.filters.searchKeywords).toEqual(['n8n', 'zapier']);
  });

  it('drops a rate that is not a number', () => {
    const search = sanitizeSearch({ name: 'X', filters: { thresholdUsdPerMonth: 'lots' } });
    expect(search.filters).toEqual({});
  });
});

describe('sanitizeSearches', () => {
  it('turns anything at all into a list', () => {
    expect(sanitizeSearches(null)).toEqual([]);
    expect(sanitizeSearches('nonsense')).toEqual([]);
  });

  it('keeps one entry per name', () => {
    const list = sanitizeSearches([
      { name: 'Automation', filters: { thresholdUsdPerMonth: 1000 } },
      { name: 'automation', filters: { thresholdUsdPerMonth: 200 } },
    ]);

    expect(list).toHaveLength(1);
    expect(list[0].filters.thresholdUsdPerMonth).toBe(1000);
  });

  it('will not grow without bound', () => {
    const many = Array.from({ length: MAX_SEARCHES + 20 }, (unused, i) => ({ name: `S${i}` }));
    expect(sanitizeSearches(many)).toHaveLength(MAX_SEARCHES);
  });
});

describe('filtersFromSettings and settingsFromSearch', () => {
  it('lifts the searchable half out of full settings', () => {
    const filters = filtersFromSettings({
      ...DEFAULTS,
      thresholdUsdPerMonth: 1200,
      searchKeywords: ['n8n'],
      wideLayout: true,
    });

    expect(filters.thresholdUsdPerMonth).toBe(1200);
    expect(filters.searchKeywords).toEqual(['n8n']);
    expect(filters.wideLayout).toBeUndefined();
  });

  it('round-trips a search through settings', () => {
    const filters = { thresholdUsdPerMonth: 1000, searchKeywords: ['n8n', 'zapier'] };
    const patch = settingsFromSearch({ name: 'X', filters }, DEFAULTS);

    expect(patch.thresholdUsdPerMonth).toBe(1000);
    expect(patch.searchKeywords).toEqual(['n8n', 'zapier']);
  });

  it('falls back rather than leaving a field unset', () => {
    // The bug this prevents: switching from a narrow search to a broad one
    // silently keeping the narrow one's exclusions, and quietly returning the
    // wrong results with nothing on screen to explain it.
    const patch = settingsFromSearch(
      { name: 'Broad', filters: { searchKeywords: ['anything'] } },
      { ...DEFAULTS, excludeKeywords: ['left', 'over'] },
    );

    expect(patch.excludeKeywords).toEqual(['left', 'over']);

    const noDefaults = settingsFromSearch({ name: 'Broad', filters: {} }, null);
    expect(noDefaults.excludeKeywords).toEqual([]);
    expect(noDefaults.searchKeywords).toEqual([]);
  });

  it('writes every searchable field, always', () => {
    const patch = settingsFromSearch({ name: 'X', filters: {} }, DEFAULTS);
    expect(Object.keys(patch).sort()).toEqual([...SEARCH_FIELDS].sort());
  });
});

describe('describeSearch', () => {
  it('says enough to tell two searches apart', () => {
    const words = describeSearch({
      name: 'X',
      filters: {
        searchKeywords: ['a', 'b', 'c'],
        thresholdUsdPerMonth: 1000,
        requiredSkills: ['Design'],
      },
    });

    expect(words).toContain('3 terms');
    expect(words).toContain('$1,000/mo');
    expect(words).toContain('1 skill');
  });

  it('says nothing about an empty search', () => {
    expect(describeSearch({ name: 'X', filters: {} })).toBe('');
    expect(describeSearch(null)).toBe('');
  });
});

describe('the store', () => {
  it('reads an empty list without chrome', async () => {
    expect(await loadSearches()).toEqual([]);
  });

  it('round-trips', async () => {
    installStorage();
    await saveSearch('Automation', { thresholdUsdPerMonth: 1000, searchKeywords: ['n8n'] });

    const [search] = await loadSearches();
    expect(search.name).toBe('Automation');
    expect(search.filters.searchKeywords).toEqual(['n8n']);
  });

  it('overwrites rather than duplicating a name', async () => {
    installStorage();
    await saveSearch('Automation', { thresholdUsdPerMonth: 1000 });
    const list = await saveSearch('automation', { thresholdUsdPerMonth: 1500 });

    expect(list).toHaveLength(1);
    expect(list[0].filters.thresholdUsdPerMonth).toBe(1500);
  });

  it('puts the newest first', async () => {
    installStorage();
    await saveSearch('First', {});
    const list = await saveSearch('Second', {});

    expect(list.map((s) => s.name)).toEqual(['Second', 'First']);
  });

  it('ignores a save with no name', async () => {
    installStorage();
    await saveSearch('Real', {});
    expect(await saveSearch('  ', { thresholdUsdPerMonth: 1 })).toHaveLength(1);
  });

  it('removes one by name, loosely', async () => {
    installStorage();
    await saveSearch('Automation', {});
    await saveSearch('Design', {});

    expect((await removeSearch('  AUTOMATION ')).map((s) => s.name)).toEqual(['Design']);
  });

  it('replaces the lot, for a restore', async () => {
    installStorage();
    await saveSearch('Old', {});

    const list = await replaceSearches([{ name: 'Restored', filters: { maxAgeDays: 7 } }]);
    expect(list.map((s) => s.name)).toEqual(['Restored']);
  });

  it('forgets everything on request', async () => {
    installStorage();
    await saveSearch('Automation', {});
    expect(await clearSearches()).toEqual([]);
  });
});

describe('the shipped presets', () => {
  it('ships a usable set', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(4);
  });

  it('survives its own validation', () => {
    // A preset is applied through exactly the same path as a saved search, so
    // one that sanitize would strip is one that silently does nothing.
    for (const preset of PRESETS) {
      const search = sanitizeSearch({ name: preset.name, filters: preset.filters });

      expect(search).not.toBeNull();
      expect(search.filters.searchKeywords.length).toBeGreaterThan(0);
      expect(search.filters.thresholdUsdPerMonth).toBeGreaterThan(0);
    }
  });

  it('names each one once, and explains it', () => {
    const names = PRESETS.map((p) => p.name);

    expect(new Set(names).size).toBe(names.length);
    for (const preset of PRESETS) expect(preset.hint.length).toBeGreaterThan(10);
  });

  it('carries the vocabulary the site actually uses', () => {
    // The whole reason a preset is worth shipping: nobody types "n8n" or "GHL"
    // unless they already know those are the words.
    const ai = findPreset('AI & Automation');
    const terms = ai.filters.searchKeywords.map((t) => t.toLowerCase());

    expect(terms).toContain('n8n');
    expect(terms).toContain('ghl');
    expect(terms).toContain('zapier');
  });

  it('sets a threshold per niche rather than one global figure', () => {
    const thresholds = PRESETS.map((p) => p.filters.thresholdUsdPerMonth);
    expect(new Set(thresholds).size).toBeGreaterThan(1);

    // Measured: automation listings ran a median of $1,230 against $800 overall,
    // so its floor must sit above the general-admin one.
    expect(findPreset('AI & Automation').filters.thresholdUsdPerMonth).toBeGreaterThan(
      findPreset('Executive & Admin VA').filters.thresholdUsdPerMonth,
    );
  });

  it('looks one up however it was typed', () => {
    expect(findPreset('ai & automation').name).toBe('AI & Automation');
    expect(findPreset('nope')).toBeNull();
    expect(findPreset(null)).toBeNull();
  });
});

describe('the experience filter travels with a search', () => {
  it('is stored when set and dropped when "all"', () => {
    expect(sanitizeSearch({ name: 'A', filters: { experienceFilter: 'beginner' } }).filters).toEqual(
      { experienceFilter: 'beginner' },
    );
    expect(sanitizeSearch({ name: 'A', filters: { experienceFilter: 'all' } }).filters).toEqual({});
    expect(sanitizeSearch({ name: 'A', filters: { experienceFilter: 'junk' } }).filters).toEqual({});
  });

  it('is reset to "all" when a search does not carry it', () => {
    const patch = settingsFromSearch({ name: 'X', filters: {} }, DEFAULTS);
    expect(patch.experienceFilter).toBe('all');
  });

  it('is described', () => {
    expect(describeSearch({ filters: { experienceFilter: 'beginner' } })).toBe('beginner-friendly');
  });

  it('ships a beginner preset that survives validation', () => {
    const preset = findPreset('First job: beginner-friendly');
    expect(preset).not.toBeNull();
    expect(sanitizeSearch({ name: preset.name, filters: preset.filters }).filters.experienceFilter).toBe(
      'beginner',
    );
  });
});

describe('the clock a saved search is stamped with', () => {
  /*
   * saveSearch takes `now` rather than reading the clock itself, which keeps it
   * testable - and made it possible to forget. Two call sites in main.js saved
   * the same kind of record and only one passed the clock, so a search kept
   * from the search row stored savedAt: null while one kept from the filters
   * menu stored a real time. Caught by reading storage after using the button,
   * not by any test.
   */
  beforeEach(() => {
    installStorage([]);
  });

  it('stamps the time it is given', async () => {
    const at = Date.parse('2026-08-24T10:32:03.418Z');
    const [saved] = await saveSearch('Bookkeeping', { thresholdUsdPerMonth: 800 }, at);
    expect(saved.savedAt).toBe(at);
  });

  it('records null when no clock is passed, which is the trap', async () => {
    // Pinned deliberately: this is the behaviour that let the bug through, so
    // if it ever changes the call sites should be revisited on purpose.
    const [saved] = await saveSearch('Bookkeeping', { thresholdUsdPerMonth: 800 });
    expect(saved.savedAt).toBeNull();
  });

  it('keeps the newer stamp when the same name is saved again', async () => {
    const first = Date.parse('2026-08-01T00:00:00.000Z');
    const second = Date.parse('2026-08-24T00:00:00.000Z');
    await saveSearch('Bookkeeping', { thresholdUsdPerMonth: 800 }, first);
    const list = await saveSearch('Bookkeeping', { thresholdUsdPerMonth: 900 }, second);
    expect(list).toHaveLength(1);
    expect(list[0].savedAt).toBe(second);
  });
});
