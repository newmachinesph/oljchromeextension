import { describe, it, expect } from 'vitest';
import {
  applyRule,
  readRate,
  ruleError,
  sanitizeRules,
  rulesSignature,
  RULE_LIMITS,
} from '../src/core/custom-rules.js';
import { decide } from '../src/core/normalize.js';
import { DEFAULTS, sanitize } from '../src/core/settings.js';

const rule = (overrides) => ({
  id: 'r1',
  enabled: true,
  name: 'Test rule',
  pattern: '',
  currency: '',
  period: '',
  ...overrides,
});

describe('ruleError', () => {
  it('accepts a workable pattern', () => {
    expect(ruleError(rule({ pattern: '([\\d,]+)\\s*per fortnight' }))).toBeNull();
  });

  it('asks for a pattern when there is none', () => {
    expect(ruleError(rule({ pattern: '   ' }))).toMatch(/pattern/i);
  });

  it('reports an uncompilable expression rather than throwing', () => {
    expect(ruleError(rule({ pattern: '([unclosed' }))).toMatch(/not a valid regular expression/i);
  });

  it('bounds the length', () => {
    expect(ruleError(rule({ pattern: 'a'.repeat(RULE_LIMITS.MAX_PATTERN + 1) }))).toMatch(
      /under \d+ characters/,
    );
  });
});

describe('applyRule', () => {
  it('reads the amount from the first capture group', () => {
    const parsed = applyRule(
      rule({ pattern: '([\\d,]+)\\s*per fortnight', currency: 'USD', period: 'week' }),
      '900 per fortnight',
    );

    expect(parsed.amountHigh).toBe(900);
    expect(parsed.currency).toBe('USD');
    expect(parsed.period).toBe('week');
    expect(parsed.isRange).toBe(false);
  });

  it('makes a range out of two capture groups', () => {
    const parsed = applyRule(
      rule({ pattern: '(\\d+)\\s*-\\s*(\\d+)\\s*k php', currency: 'PHP', period: 'month' }),
      '25-35k php',
    );

    expect(parsed.amountLow).toBe(25);
    expect(parsed.amountHigh).toBe(35);
    expect(parsed.isRange).toBe(true);
  });

  it('orders a backwards range rather than trusting the writer', () => {
    const parsed = applyRule(
      rule({ pattern: '(\\d+)\\D+(\\d+)', currency: 'USD', period: 'month' }),
      '1200 down from 900',
    );
    expect(parsed.amountLow).toBe(900);
    expect(parsed.amountHigh).toBe(1200);
  });

  it('falls back to the first number when the pattern captures nothing', () => {
    const parsed = applyRule(
      rule({ pattern: 'retainer of [\\d,]+', currency: 'USD', period: 'month' }),
      'monthly retainer of 1,250',
    );
    expect(parsed.amountHigh).toBe(1250);
  });

  it('matches case-insensitively without being asked', () => {
    expect(applyRule(rule({ pattern: 'sgd\\s*([\\d,]+)' }), 'SGD 2,400').amountHigh).toBe(2400);
  });

  it('returns nothing when the pattern does not match', () => {
    expect(applyRule(rule({ pattern: 'fortnight' }), '$900/month')).toBeNull();
  });

  it('returns nothing for a disabled rule', () => {
    expect(applyRule(rule({ pattern: '(\\d+)', enabled: false }), '900')).toBeNull();
  });

  it('returns nothing for a pattern that will not compile', () => {
    expect(applyRule(rule({ pattern: '([unclosed' }), '900')).toBeNull();
  });

  it('returns nothing when the match holds no number', () => {
    expect(applyRule(rule({ pattern: 'negotiable' }), 'negotiable')).toBeNull();
  });

  it('leaves currency and period unset when the rule says to detect them', () => {
    const parsed = applyRule(rule({ pattern: '([\\d,]+)' }), '1200');
    expect(parsed.currency).toBeNull();
    expect(parsed.period).toBeNull();
    expect(parsed.confident).toBe(false);
  });

  it('names the rule that matched, for the tester', () => {
    expect(applyRule(rule({ pattern: '(\\d+)', name: 'Fortnight' }), '900').matchedRule).toBe(
      'Fortnight',
    );
  });
});

describe('readRate', () => {
  it('prefers a rule over the built-in parser', () => {
    // The built-in parser reads "$50/hour" perfectly well; a rule saying
    // otherwise is an explicit override and must win.
    const parsed = readRate('$50/hour', [
      rule({ pattern: '\\$(\\d+)/hour', currency: 'USD', period: 'month' }),
    ]);
    expect(parsed.period).toBe('month');
  });

  it('falls back to the built-in parser when no rule matches', () => {
    const parsed = readRate('$800/month', [rule({ pattern: 'fortnight' })]);
    expect(parsed.amountHigh).toBe(800);
    expect(parsed.period).toBe('month');
  });

  it('takes the first matching rule when several would', () => {
    const parsed = readRate('1200', [
      rule({ id: 'a', pattern: '(\\d+)', currency: 'USD', period: 'month' }),
      rule({ id: 'b', pattern: '(\\d+)', currency: 'PHP', period: 'hour' }),
    ]);
    expect(parsed.currency).toBe('USD');
  });

  it('skips a broken rule and carries on', () => {
    const parsed = readRate('$800/month', [
      rule({ id: 'bad', pattern: '([unclosed' }),
      rule({ id: 'good', pattern: 'nothing here' }),
    ]);
    expect(parsed.amountHigh).toBe(800);
  });

  it('behaves exactly as before with no rules at all', () => {
    expect(readRate('PHP 20-25K')).toMatchObject({ currency: 'PHP', amountHigh: 25000 });
    expect(readRate('nothing numeric')).toBeNull();
  });

  it('feeds straight into the existing decision', () => {
    const parsed = readRate('900 per fortnight', [
      rule({ pattern: '([\\d,]+) per fortnight', currency: 'USD', period: 'week' }),
    ]);
    // 900 a week over 52/12 weeks a month.
    expect(Math.round(decide(parsed, DEFAULTS).usdPerMonth)).toBe(3900);
  });

  it('lets the assumptions finish a rule that only names the currency', () => {
    const parsed = readRate('SGD 2,400', [
      rule({ pattern: 'sgd\\s*([\\d,]+)', currency: 'USD', period: '' }),
    ]);
    const verdict = decide(parsed, DEFAULTS);
    expect(verdict.usdPerMonth).toBe(2400);
    expect(verdict.assumed).toBe(true);
  });
});

describe('sanitizeRules', () => {
  it('rejects anything that is not a list', () => {
    expect(sanitizeRules(null)).toEqual([]);
    expect(sanitizeRules('rule')).toEqual([]);
  });

  /*
   * This used to assert that a pattern-less rule is DROPPED, and that was the
   * bug rather than the contract: the rules editor renders straight from saved
   * settings, so "Add a rule" produced a blank row, saved it, had it sanitised
   * away, and re-rendered the same empty list. The button did nothing at all.
   *
   * A draft is kept so it survives its own save, and forced off so it cannot
   * match - an empty pattern is a regex that matches everything.
   */
  it('keeps a rule with no pattern yet, so a new one can be typed into', () => {
    const rules = sanitizeRules([{ pattern: '' }, { pattern: '  ' }]);
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.pattern)).toEqual(['', '']);
  });

  it('forces a pattern-less rule off, so a blank regex never runs', () => {
    expect(sanitizeRules([{ pattern: '', enabled: true }])[0].enabled).toBe(false);
    expect(sanitizeRules([{ pattern: '   ', enabled: true }])[0].enabled).toBe(false);
  });

  it('never lets a draft rule read a rate', async () => {
    const { applyRule } = await import('../src/core/custom-rules.js');
    const [draft] = sanitizeRules([{ pattern: '', enabled: true }]);
    expect(applyRule(draft, '$1,200/month')).toBeNull();
  });

  it('keeps a rule enabled unless it says otherwise', () => {
    expect(sanitizeRules([{ pattern: 'x' }])[0].enabled).toBe(true);
    expect(sanitizeRules([{ pattern: 'x', enabled: false }])[0].enabled).toBe(false);
  });

  it('discards a currency or period it does not recognise', () => {
    const [cleaned] = sanitizeRules([{ pattern: 'x', currency: 'XYZ', period: 'fortnight' }]);
    expect(cleaned.currency).toBe('');
    expect(cleaned.period).toBe('');
  });

  it('bounds the list, since every rule is tried against every listing', () => {
    const many = Array.from({ length: RULE_LIMITS.MAX_RULES + 10 }, () => ({ pattern: 'x' }));
    expect(sanitizeRules(many)).toHaveLength(RULE_LIMITS.MAX_RULES);
  });

  it('truncates an over-long pattern rather than storing it', () => {
    const [cleaned] = sanitizeRules([{ pattern: 'a'.repeat(500) }]);
    expect(cleaned.pattern.length).toBe(RULE_LIMITS.MAX_PATTERN);
  });

  it('is applied by the settings sanitizer', () => {
    const settings = sanitize({ customRules: [{ pattern: 'x', currency: 'nope' }] });
    expect(settings.customRules).toEqual([
      { id: 'rule-0', enabled: true, name: '', pattern: 'x', currency: '', period: '' },
    ]);
  });

  it('defaults to none', () => {
    expect(sanitize({}).customRules).toEqual([]);
  });
});

describe('rulesSignature', () => {
  it('changes when something that affects parsing changes', () => {
    const base = [rule({ pattern: 'a' })];
    expect(rulesSignature(base)).not.toBe(rulesSignature([rule({ pattern: 'b' })]));
    expect(rulesSignature(base)).not.toBe(rulesSignature([rule({ pattern: 'a', period: 'hour' })]));
    expect(rulesSignature(base)).not.toBe(rulesSignature([rule({ pattern: 'a', enabled: false })]));
  });

  it('does not change when only the name does', () => {
    // Renaming a rule must not force a re-parse of every listing.
    expect(rulesSignature([rule({ pattern: 'a', name: 'One' })])).toBe(
      rulesSignature([rule({ pattern: 'a', name: 'Two' })]),
    );
  });

  it('handles an empty list', () => {
    expect(rulesSignature()).toBe('');
  });
});
