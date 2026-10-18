import { describe, it, expect } from 'vitest';
import { calcSalary, CALC_PERIODS, CALC_CURRENCIES } from '../src/core/salary-calc.js';

const FX = { fxPhpPerUsd: 56, hoursPerWeek: 40, daysPerMonth: 22 };

describe('calcSalary', () => {
  it('rejects a non-numeric or negative amount', () => {
    expect(calcSalary({ amount: 'x', currency: 'USD', period: 'month' }, FX)).toBeNull();
    expect(calcSalary({ amount: -5, currency: 'USD', period: 'month' }, FX)).toBeNull();
  });

  it('converts a USD monthly figure straight through', () => {
    const r = calcSalary({ amount: 1000, currency: 'USD', period: 'month' }, FX);
    expect(r.usdPerMonth).toBe(1000);
    expect(r.phpPerMonth).toBe(56000);
  });

  it('turns hourly into monthly using the working assumptions', () => {
    // 40 h/week * 52/12 weeks = 173.33 hours/month
    const r = calcSalary({ amount: 6, currency: 'USD', period: 'hour' }, FX);
    expect(r.usdPerMonth).toBeCloseTo(6 * 40 * (52 / 12), 4);
    expect(r.usdPerHour).toBeCloseTo(6, 6);
  });

  it('is internally consistent: per-hour times hours equals per-month', () => {
    const r = calcSalary({ amount: 1200, currency: 'USD', period: 'month' }, FX);
    const hoursInMonth = 40 * (52 / 12);
    expect(r.usdPerHour * hoursInMonth).toBeCloseTo(r.usdPerMonth, 4);
  });

  it('converts a foreign currency through USD', () => {
    // 56000 PHP/month at 56 PHP per USD = 1000 USD/month
    const r = calcSalary({ amount: 56000, currency: 'PHP', period: 'month' }, FX);
    expect(r.usdPerMonth).toBeCloseTo(1000, 6);
  });

  it('returns null PHP figures when no PHP rate is supplied', () => {
    const r = calcSalary({ amount: 1000, currency: 'USD', period: 'month' }, { hoursPerWeek: 40 });
    expect(r.usdPerMonth).toBe(1000);
    expect(r.phpPerMonth).toBeNull();
  });

  it('returns null when a foreign FX rate is missing', () => {
    expect(calcSalary({ amount: 100, currency: 'AUD', period: 'month' }, FX)).toBeNull();
  });

  it('falls back to default assumptions when none are given', () => {
    const r = calcSalary({ amount: 10, currency: 'USD', period: 'hour' });
    expect(r.usdPerMonth).toBeCloseTo(10 * 40 * (52 / 12), 4);
  });
});

describe('exported option lists', () => {
  it('offer the expected periods and currencies', () => {
    expect(CALC_PERIODS.map((p) => p.value)).toEqual(['hour', 'day', 'week', 'month', 'year']);
    expect(CALC_CURRENCIES).toContain('USD');
    expect(CALC_CURRENCIES).toContain('PHP');
  });
});
