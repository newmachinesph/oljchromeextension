import { describe, it, expect } from 'vitest';
import {
  sanitizeUserPreset,
  sanitizeUserPresets,
  duplicateOf,
  overrideOf,
  blankPreset,
  allPresets,
  presetGroups,
  isPresetLevel,
  MY_PRESETS_GROUP,
  MAX_USER_PRESETS,
} from '../src/core/user-presets.js';

const NOW = 1_700_000_000_000;

/** A stand-in for the shipped list, so these tests do not move with curation. */
const SHIPPED = [
  {
    name: 'Development',
    group: 'Tech & automation',
    level: 'senior',
    measured: true,
    hint: 'Engineering roles',
    filters: { thresholdUsdPerMonth: 1200, searchKeywords: ['developer'] },
  },
  {
    name: 'Customer Support',
    group: 'Business & admin',
    level: 'beginner',
    measured: false,
    hint: 'Shift work',
    filters: { thresholdUsdPerMonth: 500, searchKeywords: ['customer support'] },
  },
];

describe('sanitizeUserPreset', () => {
  it('rejects anything without a name', () => {
    expect(sanitizeUserPreset(null)).toBeNull();
    expect(sanitizeUserPreset({})).toBeNull();
    expect(sanitizeUserPreset({ name: '   ' })).toBeNull();
  });

  it('files a plain preset under My presets whatever group it claims', () => {
    const p = sanitizeUserPreset({ name: 'Mine', group: 'Tech & automation' }, NOW);
    expect(p.group).toBe(MY_PRESETS_GROUP);
    expect(p.source).toBe('user');
  });

  it('defaults an unknown level to any', () => {
    expect(sanitizeUserPreset({ name: 'X', level: 'wizard' }, NOW).level).toBe('any');
    expect(sanitizeUserPreset({ name: 'X', level: 'mid' }, NOW).level).toBe('mid');
  });

  it('coerces filters and drops duplicate keywords', () => {
    const p = sanitizeUserPreset(
      { name: 'X', filters: { thresholdUsdPerMonth: 'abc', searchKeywords: ['a', 'A', 'b'] } },
      NOW,
    );
    expect(p.filters.thresholdUsdPerMonth).toBe(0);
    expect(p.filters.searchKeywords).toEqual(['a', 'b']);
  });

  it('refuses a negative threshold', () => {
    const p = sanitizeUserPreset({ name: 'X', filters: { thresholdUsdPerMonth: -5 } }, NOW);
    expect(p.filters.thresholdUsdPerMonth).toBe(0);
  });

  it('only treats it as an override when a baseName is present', () => {
    expect(sanitizeUserPreset({ name: 'X', source: 'override' }, NOW).source).toBe('user');
    expect(sanitizeUserPreset({ name: 'X', source: 'override', baseName: 'X' }, NOW).source).toBe(
      'override',
    );
  });
});

describe('sanitizeUserPresets', () => {
  it('drops junk and caps the list', () => {
    const many = Array.from({ length: MAX_USER_PRESETS + 10 }, (_, i) => ({
      id: `id${i}`,
      name: `P${i}`,
    }));
    expect(sanitizeUserPresets([...many, null, {}]).length).toBe(MAX_USER_PRESETS);
  });

  it('lets a later entry win on a duplicate id', () => {
    const list = sanitizeUserPresets([
      { id: 'a', name: 'First' },
      { id: 'a', name: 'Second' },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Second');
  });
});

describe('duplicateOf', () => {
  it('suffixes the name and leaves the original alone', () => {
    const copy = duplicateOf(SHIPPED[0], [], NOW);
    expect(copy.name).toBe('Development (copy)');
    expect(copy.group).toBe(MY_PRESETS_GROUP);
    expect(copy.source).toBe('user');
    expect(SHIPPED[0].name).toBe('Development');
  });

  it('keeps counting rather than colliding', () => {
    const first = duplicateOf(SHIPPED[0], [], NOW);
    const second = duplicateOf(SHIPPED[0], [first], NOW);
    expect(second.name).toBe('Development (copy 2)');
  });

  it('carries the filters across', () => {
    expect(duplicateOf(SHIPPED[0], [], NOW).filters.searchKeywords).toEqual(['developer']);
  });
});

describe('overrideOf', () => {
  it('keeps the shipped name and group', () => {
    const o = overrideOf(SHIPPED[0], {}, NOW);
    expect(o.name).toBe('Development');
    expect(o.group).toBe('Tech & automation');
    expect(o.source).toBe('override');
    expect(o.baseName).toBe('Development');
  });

  it('derives a stable id, so editing twice updates one override', () => {
    const a = overrideOf(SHIPPED[0], { hint: 'one' }, NOW);
    const b = overrideOf(SHIPPED[0], { hint: 'two' }, NOW);
    expect(a.id).toBe(b.id);
  });

  it('cannot be re-pointed at another preset by a patch', () => {
    const o = overrideOf(SHIPPED[0], { baseName: 'Customer Support', source: 'user' }, NOW);
    expect(o.baseName).toBe('Development');
    expect(o.source).toBe('override');
  });

  it('applies the patch to the editable parts', () => {
    const o = overrideOf(SHIPPED[0], { level: 'mid', filters: { thresholdUsdPerMonth: 99 } }, NOW);
    expect(o.level).toBe('mid');
    expect(o.filters.thresholdUsdPerMonth).toBe(99);
  });
});

describe('blankPreset', () => {
  it('starts empty and unclaimed', () => {
    const p = blankPreset([], NOW);
    expect(p.name).toBe('New preset');
    expect(p.level).toBe('any');
    expect(p.filters.searchKeywords).toEqual([]);
  });

  it('avoids a name already taken', () => {
    expect(blankPreset([{ name: 'New preset' }], NOW).name).toBe('New preset 2');
  });
});

describe('allPresets', () => {
  it('returns the shipped list untouched when you own nothing', () => {
    const all = allPresets([], SHIPPED);
    expect(all).toHaveLength(2);
    expect(all.every((p) => p.owned === false)).toBe(true);
  });

  it('swaps an override in at the original position', () => {
    const override = overrideOf(SHIPPED[0], { hint: 'mine now' }, NOW);
    const all = allPresets([override], SHIPPED);

    expect(all).toHaveLength(2);
    const dev = all.find((p) => p.name === 'Development');
    expect(dev.hint).toBe('mine now');
    expect(dev.overridden).toBe(true);
    expect(dev.group).toBe('Tech & automation');
  });

  it('stops calling an overridden preset measured', () => {
    const override = overrideOf(SHIPPED[0], { filters: { thresholdUsdPerMonth: 1 } }, NOW);
    const dev = allPresets([override], SHIPPED).find((p) => p.name === 'Development');
    expect(dev.measured).toBe(false);
  });

  it('puts your own presets ahead of the shipped ones', () => {
    const mine = sanitizeUserPreset({ name: 'Mine' }, NOW);
    expect(allPresets([mine], SHIPPED)[0].name).toBe('Mine');
  });
});

describe('presetGroups', () => {
  it('omits My presets entirely on a fresh install', () => {
    const groups = presetGroups([], SHIPPED);
    expect(groups.map((g) => g.group)).not.toContain(MY_PRESETS_GROUP);
  });

  it('leads with My presets once you own one', () => {
    const mine = sanitizeUserPreset({ name: 'Mine' }, NOW);
    expect(presetGroups([mine], SHIPPED)[0].group).toBe(MY_PRESETS_GROUP);
  });

  it('narrows to a level', () => {
    const groups = presetGroups([], SHIPPED, 'beginner');
    const names = groups.flatMap((g) => g.presets.map((p) => p.name));
    expect(names).toEqual(['Customer Support']);
  });

  it('shows an any-level preset under every band', () => {
    const mine = sanitizeUserPreset({ name: 'Mine', level: 'any' }, NOW);
    const names = presetGroups([mine], SHIPPED, 'senior').flatMap((g) =>
      g.presets.map((p) => p.name),
    );
    expect(names).toContain('Mine');
    expect(names).toContain('Development');
  });

  it('drops headings with nothing under them', () => {
    const groups = presetGroups([], SHIPPED, 'senior');
    expect(groups.map((g) => g.group)).toEqual(['Tech & automation']);
  });
});

describe('isPresetLevel', () => {
  it('knows the four bands', () => {
    expect(['any', 'beginner', 'mid', 'senior'].every(isPresetLevel)).toBe(true);
    expect(isPresetLevel('expert')).toBe(false);
  });
});
