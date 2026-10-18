import { describe, it, expect } from 'vitest';
import { detectShift, isWrongShift, SHIFT_OPTIONS } from '../src/core/shift.js';

describe('detectShift', () => {
  it('reads a clear night marker', () => {
    expect(detectShift('Must work US hours, night shift')).toBe('night');
    expect(detectShift('Graveyard schedule, EST timezone')).toBe('night');
  });

  it('reads a clear day marker', () => {
    expect(detectShift('Day shift, PH time')).toBe('day');
    expect(detectShift('Morning shift, Manila time')).toBe('day');
  });

  it('is unsure when there is no marker or conflicting ones', () => {
    expect(detectShift('Virtual assistant for data entry')).toBeNull();
    expect(detectShift('Day shift but overlaps US hours at night')).toBeNull();
    expect(detectShift('')).toBeNull();
  });
});

describe('isWrongShift', () => {
  it('hides only the opposite of a chosen shift, never the unknown', () => {
    expect(isWrongShift('day', 'night')).toBe(true);
    expect(isWrongShift('night', 'day')).toBe(true);
    expect(isWrongShift('day', 'day')).toBe(false);
    expect(isWrongShift('day', null)).toBe(false); // unknown is never hidden
    expect(isWrongShift('any', 'night')).toBe(false); // no preference
  });

  it('offers three options', () => {
    expect(SHIFT_OPTIONS.map((o) => o.value)).toEqual(['any', 'day', 'night']);
  });
});
