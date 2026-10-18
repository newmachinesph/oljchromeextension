import { describe, it, expect } from 'vitest';
import { gatherConcerns, describeConcerns, explainConcerns } from '../src/core/concerns.js';
import { RED_FLAGS } from '../src/core/red-flags.js';

describe('gatherConcerns', () => {
  it('is empty with nothing to say', () => {
    expect(gatherConcerns({})).toEqual([]);
    expect(gatherConcerns()).toEqual([]);
    expect(
      gatherConcerns({ flags: [], staleness: '', standingTone: null, employerMemory: null }),
    ).toEqual([]);
  });

  it('leads with red flags, then employer memory, then staleness, then standing', () => {
    const list = gatherConcerns({
      flags: [RED_FLAGS[0]],
      staleness: 'advertised 5 wks',
      standingTone: 'low',
      employerMemory: { newAccount: true, censored: true },
    });
    expect(list.map((c) => c.id)).toEqual([
      'upfront-payment',
      'new-employer',
      'censored',
      'stale',
      'below-rate',
    ]);
    for (const concern of list) {
      expect(concern.label.length).toBeGreaterThan(0);
      expect(concern.why.length).toBeGreaterThan(0);
    }
  });

  it('ignores high standing and null memory fields', () => {
    expect(
      gatherConcerns({ standingTone: 'high', employerMemory: { newAccount: null, censored: false } }),
    ).toEqual([]);
  });

  it('keeps every red flag, in their own order', () => {
    const list = gatherConcerns({ flags: [RED_FLAGS[2], RED_FLAGS[1]] });
    expect(list.map((c) => c.id)).toEqual([RED_FLAGS[2].id, RED_FLAGS[1].id]);
  });
});

describe('describeConcerns', () => {
  it('reads as the first label plus a count', () => {
    const list = gatherConcerns({ flags: [RED_FLAGS[1]], staleness: 'advertised 3 wks' });
    expect(describeConcerns(list)).toBe('unpaid trial +1');
    expect(describeConcerns(list.slice(0, 1))).toBe('unpaid trial');
    expect(describeConcerns([])).toBe('');
    expect(describeConcerns(undefined)).toBe('');
  });

  it('explains one per line', () => {
    const list = gatherConcerns({ staleness: 'advertised 3 wks', standingTone: 'low' });
    const lines = explainConcerns(list).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^advertised 3 wks: /);
    expect(lines[1]).toMatch(/^below going rate: /);
    expect(explainConcerns([])).toBe('');
  });
});
