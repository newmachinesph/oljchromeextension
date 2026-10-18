import { describe, it, expect } from 'vitest';
import { sortEntries, isSortMode, SORT_MODES } from '../src/core/sort.js';

const titles = (result) => result.map((entry) => entry.title);

/** Four listings whose rate order and posting order deliberately disagree. */
const LISTINGS = [
  { title: 'mid', usdPerMonth: 800, postedAt: 400 },
  { title: 'top', usdPerMonth: 1500, postedAt: 100 },
  { title: 'unread', usdPerMonth: null, postedAt: 300 },
  { title: 'low', usdPerMonth: 400, postedAt: 200 },
];

describe('SORT_MODES', () => {
  it('offers site order first, so the default is the least surprising one', () => {
    expect(SORT_MODES[0].value).toBe('site');
  });

  it('recognises exactly its own modes', () => {
    for (const mode of SORT_MODES) expect(isSortMode(mode.value)).toBe(true);
    expect(isSortMode('by-vibes')).toBe(false);
    expect(isSortMode(undefined)).toBe(false);
  });
});

describe('sortEntries', () => {
  it('leaves site order alone', () => {
    expect(titles(sortEntries(LISTINGS, 'site'))).toEqual(['mid', 'top', 'unread', 'low']);
  });

  it('leaves an unrecognised mode alone rather than guessing', () => {
    expect(titles(sortEntries(LISTINGS, 'nonsense'))).toEqual(['mid', 'top', 'unread', 'low']);
  });

  it('ranks the best-paid first', () => {
    expect(titles(sortEntries(LISTINGS, 'rate-desc'))).toEqual(['top', 'mid', 'low', 'unread']);
  });

  it('ranks the worst-paid first', () => {
    expect(titles(sortEntries(LISTINGS, 'rate-asc'))).toEqual(['low', 'mid', 'top', 'unread']);
  });

  it('puts rates it could not read last in both directions', () => {
    // An unknown is not a value, so it belongs at neither extreme - otherwise
    // "lowest rate" buries the cheap jobs you asked for behind unreadable ones.
    expect(titles(sortEntries(LISTINGS, 'rate-asc')).at(-1)).toBe('unread');
    expect(titles(sortEntries(LISTINGS, 'rate-desc')).at(-1)).toBe('unread');
  });

  it('keeps unknowns in site order among themselves', () => {
    const entries = [
      { title: 'a', usdPerMonth: null },
      { title: 'paid', usdPerMonth: 500 },
      { title: 'b', usdPerMonth: null },
      { title: 'c', usdPerMonth: null },
    ];
    expect(titles(sortEntries(entries, 'rate-desc'))).toEqual(['paid', 'a', 'b', 'c']);
  });

  it('ranks by posting date, newest first', () => {
    expect(titles(sortEntries(LISTINGS, 'newest'))).toEqual(['mid', 'unread', 'low', 'top']);
  });

  it('treats an undated listing as unknown, not as ancient', () => {
    const entries = [
      { title: 'undated', postedAt: null },
      { title: 'old', postedAt: 1 },
    ];
    expect(titles(sortEntries(entries, 'newest'))).toEqual(['old', 'undated']);
  });

  it('is stable, so equal rates never reshuffle between passes', () => {
    const tied = [
      { title: 'first', usdPerMonth: 500 },
      { title: 'second', usdPerMonth: 500 },
      { title: 'third', usdPerMonth: 500 },
    ];
    expect(titles(sortEntries(tied, 'rate-desc'))).toEqual(['first', 'second', 'third']);
    expect(titles(sortEntries(sortEntries(tied, 'rate-desc'), 'rate-desc'))).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('stamps each record with where it started', () => {
    const result = sortEntries(LISTINGS, 'rate-desc');
    expect(result[0]).toMatchObject({ title: 'top', index: 1 });
  });

  it('does not mutate what it was given', () => {
    const entries = [...LISTINGS];
    sortEntries(entries, 'rate-desc');
    expect(titles(entries)).toEqual(['mid', 'top', 'unread', 'low']);
  });

  it('copes with nothing at all', () => {
    expect(sortEntries([], 'rate-desc')).toEqual([]);
    expect(sortEntries(undefined, 'rate-desc')).toEqual([]);
  });

  it('treats a zero rate as a real value, not a missing one', () => {
    const entries = [
      { title: 'unpaid', usdPerMonth: 0 },
      { title: 'unread', usdPerMonth: null },
      { title: 'paid', usdPerMonth: 100 },
    ];
    expect(titles(sortEntries(entries, 'rate-asc'))).toEqual(['unpaid', 'paid', 'unread']);
  });
});
