import { describe, it, expect } from 'vitest';
import {
  COMMON_ZONES,
  DEFAULT_CLOCKS,
  MAX_CLOCKS,
  sanitizeClocks,
  isValidZone,
  zoneCity,
  hourIn,
  isNight,
  dayDelta,
  offsetLabel,
  readClock,
  overlapHours,
} from '../src/core/clocks.js';

// 16:00 UTC, so the date differences below are unambiguous: Manila is already
// on the 24th while New York is still on the 23rd.
const MIDNIGHT_UTC = Date.parse('2026-08-23T16:00:00Z');

describe('isValidZone', () => {
  it('accepts the zones we offer', () => {
    for (const zone of COMMON_ZONES) expect(isValidZone(zone.timeZone), zone.timeZone).toBe(true);
  });

  it('rejects anything Intl does not know', () => {
    // The throw is the only check available - there is no list to consult - so
    // this is what stops one bad saved zone taking the panel down.
    expect(isValidZone('Middle/Earth')).toBe(false);
    expect(isValidZone('')).toBe(false);
    expect(isValidZone(null)).toBe(false);
    expect(isValidZone(42)).toBe(false);
  });
});

describe('sanitizeClocks', () => {
  it('keeps the defaults intact', () => {
    expect(sanitizeClocks(DEFAULT_CLOCKS)).toHaveLength(DEFAULT_CLOCKS.length);
  });

  it('drops a zone the browser cannot read', () => {
    const list = sanitizeClocks([
      { id: 'a', timeZone: 'Asia/Manila' },
      { id: 'b', timeZone: 'Nowhere/Special' },
    ]);
    expect(list.map((clock) => clock.id)).toEqual(['a']);
  });

  it('names an unlabelled clock after its city', () => {
    expect(sanitizeClocks([{ id: 'a', timeZone: 'America/New_York' }])[0].label).toBe('New York');
  });

  it('collapses a duplicate id', () => {
    const list = sanitizeClocks([
      { id: 'a', timeZone: 'Asia/Manila' },
      { id: 'a', timeZone: 'Asia/Tokyo' },
    ]);
    expect(list).toHaveLength(1);
  });

  it('caps the list', () => {
    const many = Array.from({ length: MAX_CLOCKS + 5 }, (_, index) => ({
      id: `c${index}`,
      timeZone: 'Asia/Manila',
    }));
    expect(sanitizeClocks(many)).toHaveLength(MAX_CLOCKS);
  });

  it('is safe on rubbish', () => {
    expect(sanitizeClocks(null)).toEqual([]);
    expect(sanitizeClocks(['x', 7])).toEqual([]);
  });
});

describe('zoneCity', () => {
  it('reads the way someone would have typed it', () => {
    expect(zoneCity('America/New_York')).toBe('New York');
    expect(zoneCity('Asia/Manila')).toBe('Manila');
    expect(zoneCity('UTC')).toBe('UTC');
    expect(zoneCity(null)).toBe('UTC');
  });
});

describe('hourIn', () => {
  it('reads the local hour in that zone', () => {
    // 16:00 UTC is midnight in Manila (+8) and noon in New York (-4, on DST).
    expect(hourIn('Asia/Manila', MIDNIGHT_UTC)).toBe(0);
    expect(hourIn('America/New_York', MIDNIGHT_UTC)).toBe(12);
  });

  it('never reports a 24th hour', () => {
    // Some hour cycles render midnight as "24"; a 24 in a clock face is wrong
    // in every locale.
    expect(hourIn('Asia/Manila', MIDNIGHT_UTC)).toBeLessThan(24);
  });
});

describe('isNight', () => {
  it('calls midnight night and noon day', () => {
    expect(isNight('Asia/Manila', MIDNIGHT_UTC)).toBe(true);
    expect(isNight('America/New_York', MIDNIGHT_UTC)).toBe(false);
  });
});

describe('dayDelta', () => {
  it('says when a city is already on tomorrow', () => {
    // The fact that trips people up when they agree to a Monday call.
    expect(dayDelta('Asia/Manila', 'America/New_York', MIDNIGHT_UTC)).toBe(1);
    expect(dayDelta('America/New_York', 'Asia/Manila', MIDNIGHT_UTC)).toBe(-1);
  });

  it('is zero against itself', () => {
    expect(dayDelta('Asia/Manila', 'Asia/Manila', MIDNIGHT_UTC)).toBe(0);
  });
});

describe('offsetLabel', () => {
  it('reads the way a job post writes it', () => {
    expect(offsetLabel('Asia/Manila', MIDNIGHT_UTC)).toBe('GMT+8');
  });
});

describe('readClock', () => {
  it('gives a face everything it needs at once', () => {
    const face = readClock('Asia/Manila', MIDNIGHT_UTC, { from: 'America/New_York' });
    expect(face).toMatchObject({ timeZone: 'Asia/Manila', dayDelta: 1, isNight: true });
    expect(face.time).toBeTruthy();
    expect(face.weekday).toBeTruthy();
    expect(face.offsetLabel).toBe('GMT+8');
  });

  it('honours the 24-hour setting', () => {
    const twelve = readClock('America/New_York', MIDNIGHT_UTC, { hour12: true });
    const twentyFour = readClock('America/New_York', MIDNIGHT_UTC, { hour12: false });
    expect(twelve.time).toMatch(/PM|AM/i);
    expect(twentyFour.time).not.toMatch(/PM|AM/i);
  });

  it('says nothing rather than throwing on a bad zone', () => {
    expect(readClock('Nowhere/Special', MIDNIGHT_UTC)).toBeNull();
    expect(readClock('Asia/Manila', Number.NaN)).toBeNull();
  });
});

describe('overlapHours', () => {
  it('finds the hours both working days share', () => {
    // Manila and Singapore are the same offset, so a 9-6 day overlaps entirely.
    const hours = overlapHours('Asia/Manila', 'Asia/Singapore', { at: MIDNIGHT_UTC });
    expect(hours).toHaveLength(9);
    expect(hours[0].hourHere).toBe(9);
    expect(hours[hours.length - 1].hourHere).toBe(17);
  });

  it('returns nothing when the days do not meet', () => {
    // Manila and Los Angeles have no 9-6 overlap at all, which is exactly the
    // answer someone needs before promising an employer a daytime call.
    expect(overlapHours('Asia/Manila', 'America/Los_Angeles', { at: MIDNIGHT_UTC })).toEqual([]);
  });

  it('widens with the working day', () => {
    const wide = overlapHours('Asia/Manila', 'America/Los_Angeles', {
      at: MIDNIGHT_UTC,
      start: 0,
      end: 24,
    });
    expect(wide).toHaveLength(24);
  });

  it('is empty rather than throwing on a bad zone', () => {
    expect(overlapHours('Nowhere/Special', 'Asia/Manila')).toEqual([]);
  });

  it('reports hours in ascending order of your own clock', () => {
    const hours = overlapHours('Asia/Manila', 'Australia/Sydney', { at: MIDNIGHT_UTC });
    const mine = hours.map((hour) => hour.hourHere);
    expect([...mine].sort((a, b) => a - b)).toEqual(mine);
  });
});
