import { describe, it, expect } from 'vitest';
import {
  EXPORT_COLUMNS,
  MAX_ENTRIES,
  sanitizeEntry,
  sanitizeEntries,
  sanitizeState,
  durationOf,
  formatDuration,
  formatHours,
  earnedOf,
  totalsByClient,
  groupByDay,
  totalMs,
  todayMs,
  toCsv,
  dayKey,
} from '../src/core/time-tracker.js';

const T0 = Date.parse('2026-08-23T09:00:00');
const HOUR = 3_600_000;

const entry = (over = {}) => ({
  id: 'a1',
  label: 'Edit reel',
  client: 'Bold Heart',
  startedAt: T0,
  endedAt: T0 + HOUR,
  rateUsd: 8,
  ...over,
});

describe('sanitizeEntry', () => {
  it('needs a start and nothing else', () => {
    expect(sanitizeEntry({ startedAt: T0 })).toMatchObject({ startedAt: T0, endedAt: null });
    expect(sanitizeEntry({ label: 'no start' })).toBeNull();
    expect(sanitizeEntry(null)).toBeNull();
  });

  it('drops an end that comes before the start', () => {
    // Corrupt, not a negative shift - and a negative duration would be reported
    // forever rather than once.
    expect(sanitizeEntry(entry({ endedAt: T0 - HOUR })).endedAt).toBeNull();
  });

  it('refuses a rate that is not money', () => {
    expect(sanitizeEntry(entry({ rateUsd: 0 })).rateUsd).toBeNull();
    expect(sanitizeEntry(entry({ rateUsd: -5 })).rateUsd).toBeNull();
    expect(sanitizeEntry(entry({ rateUsd: 'eight' })).rateUsd).toBeNull();
    expect(sanitizeEntry(entry({ rateUsd: 8.005 })).rateUsd).toBe(8.01);
  });

  it('flattens a label that would break a row', () => {
    expect(sanitizeEntry(entry({ label: 'Edit\treel\nfor Monday' })).label).toBe(
      'Edit reel for Monday',
    );
  });
});

describe('sanitizeEntries', () => {
  it('sorts newest first', () => {
    const list = sanitizeEntries([
      entry({ id: 'old', startedAt: T0 - HOUR }),
      entry({ id: 'new', startedAt: T0 + HOUR }),
    ]);
    expect(list.map((row) => row.id)).toEqual(['new', 'old']);
  });

  it('collapses a duplicate id', () => {
    expect(sanitizeEntries([entry(), entry()])).toHaveLength(1);
  });

  it('caps the log', () => {
    const many = Array.from({ length: MAX_ENTRIES + 40 }, (_, index) =>
      entry({ id: `e${index}`, startedAt: T0 + index }),
    );
    expect(sanitizeEntries(many)).toHaveLength(MAX_ENTRIES);
  });

  it('is safe on rubbish', () => {
    expect(sanitizeEntries(null)).toEqual([]);
    expect(sanitizeEntries(['x', 3, {}])).toEqual([]);
  });
});

describe('sanitizeState', () => {
  it('takes a finished "running" entry off the clock', () => {
    // One bad write must not pin a timer that has already stopped.
    expect(sanitizeState({ running: entry(), entries: [] }).running).toBeNull();
  });

  it('keeps a genuinely open one', () => {
    const state = sanitizeState({ running: entry({ endedAt: null }), entries: [] });
    expect(state.running.startedAt).toBe(T0);
  });
});

describe('durationOf', () => {
  it('measures a closed entry from its own two ends', () => {
    expect(durationOf(entry(), T0 + 99 * HOUR)).toBe(HOUR);
  });

  it('measures an open one up to now', () => {
    expect(durationOf(entry({ endedAt: null }), T0 + 2 * HOUR)).toBe(2 * HOUR);
  });

  it('is zero for nothing', () => {
    expect(durationOf(null, T0)).toBe(0);
  });
});

describe('earnedOf', () => {
  it('turns hours into money at the entry rate', () => {
    expect(earnedOf(entry(), T0)).toBe(8);
    expect(earnedOf(entry({ endedAt: T0 + HOUR / 2 }), T0)).toBe(4);
  });

  it('says nothing when no rate was set', () => {
    // Null, not zero: "you did not tell me" is not "this was worth nothing".
    expect(earnedOf(entry({ rateUsd: null }), T0)).toBeNull();
  });
});

describe('totalsByClient', () => {
  const entries = [
    entry({ id: 'a', client: 'Bold Heart', rateUsd: 8 }),
    entry({
      id: 'b',
      client: 'Bold Heart',
      startedAt: T0 + 2 * HOUR,
      endedAt: T0 + 3 * HOUR,
      rateUsd: 8,
    }),
    entry({
      id: 'c',
      client: 'Acme',
      startedAt: T0 + 4 * HOUR,
      endedAt: T0 + 7 * HOUR,
      rateUsd: null,
    }),
  ];

  it('adds up the hours and the money per client', () => {
    const rows = totalsByClient(entries, T0);
    // Acme first: three hours beats two, and this is sorted by time not money.
    expect(rows[0]).toMatchObject({ client: 'Acme', ms: 3 * HOUR, hasRate: false });
    expect(rows[1]).toMatchObject({ client: 'Bold Heart', ms: 2 * HOUR, earned: 16, hasRate: true });
  });

  it('groups unlabelled work rather than dropping it', () => {
    // Time you forgot to name is still time you spent; hiding it makes the
    // total wrong.
    const rows = totalsByClient([entry({ client: '' })], T0);
    expect(rows).toHaveLength(1);
    expect(rows[0].ms).toBe(HOUR);
  });
});

describe('groupByDay and the totals', () => {
  const entries = [
    entry({ id: 'today', startedAt: T0 }),
    entry({ id: 'earlier', startedAt: T0 - 86_400_000, endedAt: T0 - 86_400_000 + 2 * HOUR }),
  ];

  it('buckets by the day a session started, newest first', () => {
    const days = groupByDay(entries, T0 + HOUR);
    expect(days).toHaveLength(2);
    expect(days[0].day).toBe(dayKey(T0));
    expect(days[1].ms).toBe(2 * HOUR);
  });

  it('counts today separately from everything', () => {
    expect(todayMs(entries, T0 + HOUR)).toBe(HOUR);
    expect(totalMs(entries, T0 + HOUR)).toBe(3 * HOUR);
  });
});

describe('toCsv', () => {
  it('leads with the header even with nothing logged', () => {
    expect(toCsv([], { bom: false })).toBe(EXPORT_COLUMNS.join(','));
  });

  it('quotes only what needs it, per RFC 4180', () => {
    const csv = toCsv([entry({ client: 'Bold, Heart' })], { bom: false, now: T0 });
    expect(csv).toContain('"Bold, Heart"');
    expect(csv).toContain('Edit reel');
  });

  it('doubles an embedded quote', () => {
    const csv = toCsv([entry({ label: 'The "final" cut' })], { bom: false, now: T0 });
    expect(csv).toContain('"The ""final"" cut"');
  });

  it('joins rows with CRLF, which is what Excel on Windows needs', () => {
    const csv = toCsv([entry(), entry({ id: 'b' })], { bom: false, now: T0 });
    expect(csv.split('\r\n')).toHaveLength(3);
  });

  it('leads with a BOM so Excel reads it as UTF-8', () => {
    expect(toCsv([entry({ client: 'Señor Data' })], { now: T0 }).charCodeAt(0)).toBe(0xfeff);
  });

  it('writes hours and money to two places, the way an invoice line reads', () => {
    const [, row] = toCsv([entry({ endedAt: T0 + HOUR + HOUR / 2 })], {
      bom: false,
      now: T0,
    }).split('\r\n');
    const cells = row.split(',');
    expect(cells[5]).toBe('1.50');
    expect(cells[7]).toBe('12.00');
  });

  it('leaves the end blank on an entry still running', () => {
    const [, row] = toCsv([entry({ endedAt: null })], { bom: false, now: T0 + HOUR }).split('\r\n');
    const cells = row.split(',');
    expect(cells[4]).toBe('');
    expect(cells[5]).toBe('1.00');
  });
});

describe('formatting', () => {
  it('shows seconds while a timer runs', () => {
    expect(formatDuration(HOUR + 125_000)).toBe('1:02:05');
    expect(formatDuration(0)).toBe('0:00:00');
    expect(formatDuration(-1)).toBe('0:00:00');
  });

  it('bills in decimal hours', () => {
    expect(formatHours(HOUR)).toBe('1.00h');
    expect(formatHours(HOUR * 2.75)).toBe('2.75h');
    expect(formatHours(HOUR, { precision: 1 })).toBe('1.0h');
  });
});
