import { describe, it, expect, beforeEach } from 'vitest';
import {
  sanitizeBoardConfig,
  loadBoardConfig,
  setStageLabel,
  setStageHidden,
  setStageOrder,
  addCustomColumn,
  removeCustomColumn,
  addPaletteColor,
  removePaletteColor,
  resetBoardConfig,
  columnsFor,
  MAX_LABEL_LENGTH,
} from '../src/core/board-config.js';

// cardOrder joined the shape when lanes gained drag-to-reorder; a config with
// nothing in it still has the key, empty.
const EMPTY = { labels: {}, hidden: [], order: [], columns: [], palette: [], cardOrder: {} };

const STORAGE_KEY = 'ojRateFilterBoardConfig';

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

describe('sanitizeBoardConfig', () => {
  it('defaults to empty labels and hidden', () => {
    expect(sanitizeBoardConfig(null)).toEqual(EMPTY);
    expect(sanitizeBoardConfig([])).toEqual(EMPTY);
  });

  it('keeps clean labels, trims, caps length, drops empties', () => {
    const long = 'x'.repeat(MAX_LABEL_LENGTH + 10);
    const c = sanitizeBoardConfig({ labels: { applied: '  Sent  ', offer: '', preparing: long } });
    expect(c.labels.applied).toBe('Sent');
    expect(c.labels.offer).toBeUndefined();
    expect(c.labels.preparing.length).toBe(MAX_LABEL_LENGTH);
  });

  it('de-dupes hidden and drops blanks', () => {
    expect(sanitizeBoardConfig({ hidden: ['offer', 'offer', '', 'hired'] }).hidden).toEqual(['offer', 'hired']);
  });
});

describe('setStageLabel', () => {
  it('renames a lane and clears with an empty label', async () => {
    installStorage();
    await setStageLabel('applied', 'Sent out');
    expect((await loadBoardConfig()).labels.applied).toBe('Sent out');
    await setStageLabel('applied', '   ');
    expect((await loadBoardConfig()).labels.applied).toBeUndefined();
  });
});

describe('setStageHidden', () => {
  it('hides and shows a lane without duplicating', async () => {
    installStorage();
    await setStageHidden('rejected', true);
    await setStageHidden('rejected', true);
    expect((await loadBoardConfig()).hidden).toEqual(['rejected']);
    await setStageHidden('rejected', false);
    expect((await loadBoardConfig()).hidden).toEqual([]);
  });
});

describe('resetBoardConfig', () => {
  it('clears everything', async () => {
    installStorage();
    await setStageLabel('applied', 'Sent');
    await setStageHidden('offer', true);
    await resetBoardConfig();
    expect(await loadBoardConfig()).toEqual(EMPTY);
  });
});

describe('columnsFor', () => {
  it('applies overrides and hidden flags in order', () => {
    const base = [
      { value: 'saved', label: 'Saved' },
      { value: 'applied', label: 'Applied' },
      { value: 'offer', label: 'Offer' },
    ];
    const cols = columnsFor({ labels: { applied: 'Sent' }, hidden: ['offer'] }, base);
    expect(cols).toEqual([
      { value: 'saved', label: 'Saved', defaultLabel: 'Saved', hidden: false, custom: false },
      { value: 'applied', label: 'Sent', defaultLabel: 'Applied', hidden: false, custom: false },
      { value: 'offer', label: 'Offer', defaultLabel: 'Offer', hidden: true, custom: false },
    ]);
  });

  it('applies a saved lane order, keeping unlisted lanes after the ordered ones', () => {
    const base = [
      { value: 'saved', label: 'Saved' },
      { value: 'applied', label: 'Applied' },
      { value: 'offer', label: 'Offer' },
    ];
    const cols = columnsFor({ order: ['offer', 'saved'] }, base);
    expect(cols.map((c) => c.value)).toEqual(['offer', 'saved', 'applied']);
  });

  it('appends custom lanes and marks them custom', () => {
    const base = [{ value: 'saved', label: 'Saved' }];
    const cols = columnsFor({ columns: [{ value: 'custom-leads', label: 'Leads' }] }, base);
    expect(cols).toEqual([
      { value: 'saved', label: 'Saved', defaultLabel: 'Saved', hidden: false, custom: false },
      { value: 'custom-leads', label: 'Leads', defaultLabel: 'Leads', hidden: false, custom: true },
    ]);
  });
});

describe('setStageOrder', () => {
  it('stores a de-duped order of lane values', async () => {
    installStorage();
    await setStageOrder(['offer', 'offer', '', 'saved']);
    expect((await loadBoardConfig()).order).toEqual(['offer', 'saved']);
  });
});

describe('custom columns', () => {
  it('adds a namespaced custom lane and returns its value', async () => {
    installStorage();
    const value = await addCustomColumn('  Leads  ');
    expect(value).toBe('custom-leads');
    expect((await loadBoardConfig()).columns).toEqual([{ value: 'custom-leads', label: 'Leads' }]);
  });

  it('gives a second lane with the same name a distinct value', async () => {
    installStorage();
    await addCustomColumn('Leads');
    const second = await addCustomColumn('Leads');
    expect(second).toBe('custom-leads-2');
  });

  it('refuses an empty label', async () => {
    installStorage();
    expect(await addCustomColumn('   ')).toBeNull();
  });

  it('removes a custom lane and clears its leftovers', async () => {
    installStorage();
    const value = await addCustomColumn('Leads');
    await setStageLabel(value, 'Renamed');
    await setStageHidden(value, true);
    await removeCustomColumn(value);
    const config = await loadBoardConfig();
    expect(config.columns).toEqual([]);
    expect(config.labels[value]).toBeUndefined();
    expect(config.hidden).not.toContain(value);
  });
});

describe('palette', () => {
  it('adds valid hex colours, ignoring dupes and junk', async () => {
    installStorage();
    await addPaletteColor('#FF8800');
    await addPaletteColor('#ff8800');
    await addPaletteColor('nope');
    expect((await loadBoardConfig()).palette).toEqual(['#ff8800']);
  });

  it('removes a colour', async () => {
    installStorage();
    await addPaletteColor('#ff8800');
    await removePaletteColor('#FF8800');
    expect((await loadBoardConfig()).palette).toEqual([]);
  });
});

describe('serialized writes', () => {
  it('keeps both lane changes from concurrent hides', async () => {
    installStorage();
    // Without the queue, both read the empty hidden array and the second set
    // clobbers the first, losing one lane.
    await Promise.all([setStageHidden('offer', true), setStageHidden('hired', true)]);
    expect((await loadBoardConfig()).hidden.sort()).toEqual(['hired', 'offer']);
  });
});
