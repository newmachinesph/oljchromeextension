import { describe, it, expect } from 'vitest';
import { readRateIntent, RATE_INTENTS } from '../src/core/rate-intent.js';
import { evaluateListing } from '../src/core/criteria.js';
import { parseRate } from '../src/core/parse-rate.js';
import { sanitize } from '../src/core/settings.js';

/**
 * Every unpriced string a 102-page sweep turned up, verbatim. The split is the
 * whole point: "TBD" is silence, "Based on Experience" is an invitation.
 */
const NEGOTIABLE = [
  'Negotiable',
  'negotiable',
  'Negotiable (Depending on Experience)',
  'Competitive Salary',
  'Commensurate with experience',
  'Based on Experience',
  'DOE',
  'Depends on knowledge',
  'depending on experience',
  'Depending on experience',
  'Variable',
  '% higher than last drawn',
  'TBD based on your experience',
];

const UNSTATED = [
  'TBD',
  'tbd',
  'TBA',
  'TBC',
  'to be determined',
  'To be agreed upon',
  'To be discussed',
  'Discussed at interview stage',
  'NA',
  'N/A',
  '$$$',
  'Not specified',
];

describe('readRateIntent', () => {
  for (const text of NEGOTIABLE) {
    it(`reads ${JSON.stringify(text)} as open to negotiation`, () => {
      expect(readRateIntent(text)).toBe(RATE_INTENTS.NEGOTIABLE);
    });
  }

  for (const text of UNSTATED) {
    it(`reads ${JSON.stringify(text)} as simply not stated`, () => {
      expect(readRateIntent(text)).toBe(RATE_INTENTS.UNSTATED);
    });
  }

  it('lets the more informative reading win when a string carries both', () => {
    // It says TBD, but what it tells you is that the number is yours to argue
    // for - which is the useful half.
    expect(readRateIntent('TBD based on your experience')).toBe(RATE_INTENTS.NEGOTIABLE);
  });

  it('claims nothing about a rate that is merely unreadable', () => {
    // A figure we could not parse is genuinely unclear, and saying so is more
    // honest than filing it under either bucket.
    expect(readRateIntent('225$ plus bonuses 5.63 hr')).toBeNull();
    expect(readRateIntent('$500/month')).toBeNull();
    expect(readRateIntent('0')).toBeNull();
  });

  it('handles nothing at all', () => {
    expect(readRateIntent(null)).toBeNull();
    expect(readRateIntent(undefined)).toBeNull();
    expect(readRateIntent('   ')).toBeNull();
  });

  it('reports the signal even when the rate also converts', () => {
    expect(readRateIntent('750 per month, negotiable')).toBe(RATE_INTENTS.NEGOTIABLE);
  });
});

describe('the hide rule', () => {
  const verdictFor = (rateText, settings = {}) =>
    evaluateListing({
      facts: { title: 'Virtual Assistant', rateText, jobType: 'full-time' },
      parsed: parseRate(rateText),
      settings: sanitize(settings),
      now: Date.now(),
    });

  it('reports a negotiable rate as its own reason, not as unclear', () => {
    const verdict = verdictFor('Based on Experience');
    expect(verdict.reason).toBe('negotiable');
    expect(verdict.hide).toBe(false);
  });

  it('still reports silence as no rate', () => {
    expect(verdictFor('TBD').reason).toBe('no-rate');
  });

  it('keeps calling an unreadable figure unclear', () => {
    expect(verdictFor('225$ plus bonuses 5.63 hr').reason).toBe('unclear-rate');
  });

  it('describes an unresolvable figure by what the employer wrote', () => {
    // "50-60" lands between the two readings, so no monthly figure comes out of
    // it - but the employer did tell us something, and that beats reporting our
    // own failure.
    const verdict = verdictFor('negotiable, 50-60');
    expect(verdict.usdPerMonth).toBeNull();
    expect(verdict.reason).toBe('negotiable');
  });

  it('can hide the silent ones while keeping every negotiable one', () => {
    // The reason the two settings are separate: these are the unpriced
    // listings where the figure could still land high.
    expect(verdictFor('TBD', { hideNoRate: true }).hide).toBe(true);
    expect(verdictFor('Based on Experience', { hideNoRate: true }).hide).toBe(false);
  });

  it('can hide the negotiable ones while keeping the silent ones', () => {
    expect(verdictFor('Based on Experience', { hideNegotiable: true }).hide).toBe(true);
    expect(verdictFor('TBD', { hideNegotiable: true }).hide).toBe(false);
  });

  it('keeps both visible by default', () => {
    expect(sanitize({}).hideNegotiable).toBe(false);
    expect(sanitize({}).hideNoRate).toBe(false);
  });

  it('never touches a listing whose rate we did read', () => {
    const verdict = verdictFor('$800/month, negotiable');
    expect(verdict.usdPerMonth).toBe(800);
    expect(verdict.reason).not.toBe('negotiable');
  });
});
