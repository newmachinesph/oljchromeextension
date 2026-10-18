import { describe, it, expect } from 'vitest';
import { score, rank } from '../src/core/palette.js';

const entries = [
  { label: 'Show only new since my last visit', hint: 'What changed' },
  { label: 'Sort by highest rate', hint: 'Order' },
  { label: 'Hide Full Time listings', hint: 'Job type' },
  { label: 'Virtual Assistant - Video Editor', hint: 'Bold Heart Media' },
  { label: 'Data Entry Clerk', hint: 'KeepingCount HR' },
];

describe('score', () => {
  it('matches letters in order, not only as a run', () => {
    // The whole point of a palette: type what you remember.
    expect(score('Virtual Assistant - Video Editor', 'vaed')).not.toBeNull();
  });

  it('refuses a query whose letters are out of order', () => {
    expect(score('Data Entry', 'yrtad')).toBeNull();
  });

  it('refuses a letter that is not there at all', () => {
    expect(score('Data Entry', 'dz')).toBeNull();
  });

  it('rewards word beginnings over letters buried mid-word', () => {
    expect(score('Data Entry Clerk', 'dec')).toBeGreaterThan(score('Coded Sentence', 'dec'));
  });

  it('prefers the shorter of two equally good matches', () => {
    expect(score('Data', 'data')).toBeGreaterThan(score('Database administrator', 'data'));
  });

  it('ignores case and spaces in the query', () => {
    expect(score('Data Entry Clerk', 'D E C')).toBe(score('Data Entry Clerk', 'dec'));
  });

  it('scores everything equally when nothing is typed', () => {
    expect(score('anything', '')).toBe(0);
    expect(score('anything', '   ')).toBe(0);
  });

  it('never matches against nothing', () => {
    expect(score('', 'a')).toBeNull();
    expect(score(null, 'a')).toBeNull();
  });
});

describe('rank', () => {
  it('keeps the declared order when nothing is typed', () => {
    expect(rank(entries, '').map((e) => e.label)).toEqual(entries.map((e) => e.label));
  });

  it('drops what does not match', () => {
    const found = rank(entries, 'sort');
    expect(found).toHaveLength(1);
    expect(found[0].label).toBe('Sort by highest rate');
  });

  it('finds a job by a few letters of its title', () => {
    expect(rank(entries, 'video')[0].label).toBe('Virtual Assistant - Video Editor');
  });

  it('finds a job by its employer, through the hint', () => {
    expect(rank(entries, 'keepingcount')[0].label).toBe('Data Entry Clerk');
  });

  it('lets a title outrank a hint that says the same thing', () => {
    // "the employer wrote it" should not beat "the title says it".
    const mixed = [
      { label: 'Something else entirely', hint: 'Data Entry Co' },
      { label: 'Data Entry Clerk', hint: 'Acme' },
    ];
    expect(rank(mixed, 'data entry')[0].label).toBe('Data Entry Clerk');
  });

  it('bounds how many it returns', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ label: `Job ${i}` }));
    expect(rank(many, 'job')).toHaveLength(40);
    expect(rank(many, 'job', 5)).toHaveLength(5);
  });

  it('copes with nothing to rank', () => {
    expect(rank([], 'x')).toEqual([]);
    expect(rank(undefined, 'x')).toEqual([]);
  });

  it('returns nothing rather than everything for a hopeless query', () => {
    expect(rank(entries, 'zzzzqx')).toEqual([]);
  });
});
