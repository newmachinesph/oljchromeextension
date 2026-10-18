import { describe, it, expect } from 'vitest';
import { parseRate } from '../src/core/parse-rate.js';

/**
 * Each row is a real-world shape of the salary field. `confident` is the
 * important column: only confident parses are ever allowed to hide a listing.
 */
const CASES = [
  // text,                     amount, currency, period,  confident
  ['$800/month', 800, 'USD', 'month', true],
  ['$800 / month', 800, 'USD', 'month', true],
  ['$1,200/month', 1200, 'USD', 'month', true],
  ['USD 750 per month', 750, 'USD', 'month', true],
  ['$5/hour', 5, 'USD', 'hour', true],
  ['5 USD per hour', 5, 'USD', 'hour', true],
  ['$3.50/hr', 3.5, 'USD', 'hour', true],
  ['$1.5k/month', 1500, 'USD', 'month', true],
  ['$60,000/year', 60000, 'USD', 'year', true],
  ['P30,000/month', 30000, 'PHP', 'month', true],
  ['P 25,000 / mo', 25000, 'PHP', 'month', true],
  ['Php 30,000 monthly', 30000, 'PHP', 'month', true],
  ['₱18,000/month', 18000, 'PHP', 'month', true],
  ['25000 pesos per month', 25000, 'PHP', 'month', true],
];

describe('parseRate', () => {
  for (const [text, amount, currency, period, confident] of CASES) {
    it(`reads ${JSON.stringify(text)}`, () => {
      const result = parseRate(text);
      expect(result).not.toBeNull();
      expect(result.amount).toBeCloseTo(amount, 5);
      expect(result.currency).toBe(currency);
      expect(result.period).toBe(period);
      expect(result.confident).toBe(confident);
    });
  }

  describe('text with no usable number', () => {
    for (const text of ['Not specified', 'TBD', 'Negotiable', '', '   ', null, undefined]) {
      it(`returns null for ${JSON.stringify(text)}`, () => {
        expect(parseRate(text)).toBeNull();
      });
    }
  });

  describe('refuses to guess', () => {
    it('will not hide a bare number with no currency', () => {
      const result = parseRate('25000');
      expect(result.confident).toBe(false);
      expect(result.reason).toBe('no-currency');
    });

    it('will not hide an amount with no stated period', () => {
      const result = parseRate('$500');
      expect(result.currency).toBe('USD');
      expect(result.period).toBeNull();
      expect(result.confident).toBe(false);
      expect(result.reason).toBe('no-period');
    });
  });

  describe('ranges', () => {
    it('captures both ends of a dollar range', () => {
      const result = parseRate('$300-$500/month');
      expect(result.isRange).toBe(true);
      expect(result.amountLow).toBe(300);
      expect(result.amountHigh).toBe(500);
      expect(result.confident).toBe(true);
    });

    it('handles a written "to" range', () => {
      const result = parseRate('$800 to $1,200 per month');
      expect(result.isRange).toBe(true);
      expect(result.amountLow).toBe(800);
      expect(result.amountHigh).toBe(1200);
    });

    it('handles a peso range', () => {
      const result = parseRate('P20,000 - P25,000/month');
      expect(result.isRange).toBe(true);
      expect(result.currency).toBe('PHP');
      expect(result.amountHigh).toBe(25000);
    });
  });

  describe('site-specific traps', () => {
    it('reads the "/mon" abbreviation as monthly, not per-task', () => {
      const result = parseRate('PHP 30,000/mon');
      expect(result.period).toBe('month');
      expect(result.taskBased).toBe(false);
      expect(result.currency).toBe('PHP');
      expect(result.amountHigh).toBe(30000);
    });

    it('does not read the language "PHP" as a currency', () => {
      expect(parseRate('PHP Developer')).toBeNull();
    });

    it('prefers the number that carries a currency marker', () => {
      const result = parseRate('40 hrs/week $500/month');
      expect(result.amount).toBe(500);
      expect(result.currency).toBe('USD');
      expect(result.period).toBe('month');
    });
  });
});
