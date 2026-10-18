import { describe, it, expect } from 'vitest';
import { creditNudge } from '../src/core/credit-nudge.js';

describe('creditNudge', () => {
  it('says nothing above the notice threshold', () => {
    expect(creditNudge(6)).toBeNull();
    expect(creditNudge(100)).toBeNull();
  });

  it('shows a quiet notice at 5 or fewer (but above the low threshold)', () => {
    const nudge = creditNudge(5);
    expect(nudge.level).toBe('notice');
    expect(nudge.title).toBe('5 Credits Remaining');
    expect(nudge.actions).toEqual([]);
    expect(creditNudge(3).level).toBe('notice');
  });

  it('prompts to get credits at 2 or fewer', () => {
    const nudge = creditNudge(2);
    expect(nudge.level).toBe('low');
    expect(nudge.title).toBe("You're Running Low");
    expect(nudge.actions).toEqual(['get-credits']);
  });

  it('uses a singular for one credit left', () => {
    expect(creditNudge(1).body).toContain('1 AI credit left');
  });

  it('is out at zero, with both actions and the free-features reassurance', () => {
    const nudge = creditNudge(0);
    expect(nudge.level).toBe('out');
    expect(nudge.title).toBe("You're Out of AI Credits");
    expect(nudge.body).toContain('free PowerTools features are still available');
    expect(nudge.actions).toEqual(['get-credits', 'invite']);
  });

  it('returns null for a non-numeric balance (unknown/unverified)', () => {
    expect(creditNudge(null)).toBeNull();
    expect(creditNudge(undefined)).toBeNull();
    expect(creditNudge(NaN)).toBeNull();
  });

  it('floors fractional balances defensively', () => {
    expect(creditNudge(2.9).level).toBe('low');
  });
});
