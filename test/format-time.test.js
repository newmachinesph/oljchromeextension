import { describe, it, expect } from 'vitest';
import { formatRelativeTime, formatExactTime } from '../src/core/format-time.js';

/** Pinned clock: this must not depend on when the suite runs. */
const NOW = Date.parse('2026-08-17T18:00:00Z');

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ago = (ms) => NOW - ms;

describe('formatRelativeTime', () => {
  const cases = [
    [0, 'just now'],
    [30 * 1000, 'just now'],
    [MINUTE, '1m ago'],
    [42 * MINUTE, '42m ago'],
    [HOUR, '1h ago'],
    [3 * HOUR + 20 * MINUTE, '3h ago'],
    [23 * HOUR, '23h ago'],
    [DAY, '1d ago'],
    [6 * DAY, '6d ago'],
    [7 * DAY, '1w ago'],
    [29 * DAY, '4w ago'],
    [30 * DAY, '1mo ago'],
    [200 * DAY, '6mo ago'],
    [400 * DAY, '1y ago'],
  ];

  for (const [elapsed, expected] of cases) {
    it(`renders ${expected}`, () => {
      expect(formatRelativeTime(ago(elapsed), NOW)).toBe(expected);
    });
  }

  it('reads a slightly future stamp as new rather than negative', () => {
    expect(formatRelativeTime(NOW + 5 * MINUTE, NOW)).toBe('just now');
  });

  it('returns null when there is no date', () => {
    expect(formatRelativeTime(null, NOW)).toBeNull();
    expect(formatRelativeTime(undefined, NOW)).toBeNull();
    expect(formatRelativeTime(Number.NaN, NOW)).toBeNull();
  });
});

describe('formatExactTime', () => {
  it('spells out the stamp for the tooltip', () => {
    // Local time, so assert the shape rather than a fixed hour.
    expect(formatExactTime(NOW)).toMatch(/^\d{1,2} Aug 2026, \d{2}:\d{2}$/);
  });

  it('returns an empty string when there is no date', () => {
    expect(formatExactTime(null)).toBe('');
  });
});
