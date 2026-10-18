import { describe, it, expect } from 'vitest';
import {
  toUsdPerMonth,
  isSane,
  formatUsdPerMonth,
  formatRate,
  decide,
  hoursPerMonthFor,
} from '../src/core/normalize.js';
import { DEFAULTS } from '../src/core/settings.js';
import { parseRate } from '../src/core/parse-rate.js';

const settings = { ...DEFAULTS };

function rate(text) {
  return parseRate(text);
}

describe('toUsdPerMonth', () => {
  it('leaves a monthly dollar figure alone', () => {
    expect(toUsdPerMonth(rate('$800/month'), settings)).toBe(800);
  });

  it('converts pesos at the configured rate', () => {
    // The rate is stated rather than inherited from the defaults, so this stays
    // a test of the arithmetic when the shipped rate moves.
    expect(toUsdPerMonth(rate('P30,000/month'), { ...settings, fxPhpPerUsd: 60 })).toBe(500);
  });

  it('respects a changed exchange rate', () => {
    expect(toUsdPerMonth(rate('P30,000/month'), { ...settings, fxPhpPerUsd: 50 })).toBe(600);
  });

  it('scales an hourly rate by hours per month', () => {
    expect(toUsdPerMonth(rate('$5/hour'), settings)).toBe(800);
  });

  it('scales a yearly rate down', () => {
    expect(toUsdPerMonth(rate('$60,000/year'), settings)).toBe(5000);
  });

  it('scales a weekly rate up', () => {
    expect(toUsdPerMonth(rate('$100/week'), settings)).toBeCloseTo(433.33, 2);
  });

  it('returns null when currency or period is missing', () => {
    expect(toUsdPerMonth(rate('25000'), settings)).toBeNull();
    expect(toUsdPerMonth(rate('$500'), settings)).toBeNull();
    expect(toUsdPerMonth(null, settings)).toBeNull();
  });
});

describe('range basis', () => {
  const parsed = rate('$300-$500/month');

  it('judges by the high end by default', () => {
    expect(toUsdPerMonth(parsed, settings)).toBe(500);
  });

  it('judges by the low end when configured to', () => {
    expect(toUsdPerMonth(parsed, { ...settings, rangeBasis: 'low' })).toBe(300);
  });
});

describe('isSane', () => {
  it('accepts plausible monthly pay', () => {
    expect(isSane(500)).toBe(true);
  });

  it('rejects impossible values', () => {
    expect(isSane(0)).toBe(false);
    expect(isSane(5_000_000)).toBe(false);
    expect(isSane(null)).toBe(false);
    expect(isSane(Number.NaN)).toBe(false);
  });
});

describe('formatUsdPerMonth', () => {
  it('rounds and adds separators', () => {
    expect(formatUsdPerMonth(1234.56)).toBe('$1,235/mo');
  });

  it('returns an empty string for non-numbers', () => {
    expect(formatUsdPerMonth(null)).toBe('');
  });
});

describe('decide', () => {
  it('hides a confident parse below the threshold', () => {
    const verdict = decide(rate('P24,000/month'), settings); // $400/mo
    expect(verdict.hide).toBe(true);
    expect(verdict.reason).toBe('below-threshold');
  });

  it('keeps a confident parse above the threshold', () => {
    const verdict = decide(rate('$800/month'), settings);
    expect(verdict.hide).toBe(false);
    expect(verdict.reason).toBe('above-threshold');
  });

  it('hides pay above the max ceiling when one is set', () => {
    const verdict = decide(rate('$800/month'), { ...settings, maxUsdPerMonth: 700 });
    expect(verdict.hide).toBe(true);
    expect(verdict.reason).toBe('above-max');
  });

  it('keeps pay inside the band, and a zero ceiling means no ceiling', () => {
    expect(decide(rate('$600/month'), { ...settings, maxUsdPerMonth: 700 }).hide).toBe(false);
    expect(decide(rate('$9000/month'), { ...settings, maxUsdPerMonth: 0 }).hide).toBe(false);
  });

  it('ignores a ceiling at or below the floor instead of hiding everything', () => {
    // threshold 500, max 300: the band is empty, so obeying it would hide all.
    const cfg = { ...settings, thresholdUsdPerMonth: 500, maxUsdPerMonth: 300 };
    expect(decide(rate('$800/month'), cfg).hide).toBe(false);
    expect(decide(rate('$800/month'), cfg).reason).toBe('above-threshold');
    // Below the floor is still hidden by the floor itself.
    expect(decide(rate('$400/month'), cfg).reason).toBe('below-threshold');
  });

  it('never hides an unparsed rate', () => {
    expect(decide(null, settings).hide).toBe(false);
  });

  it('never hides a rate with no currency, however small', () => {
    expect(decide(rate('5'), settings).hide).toBe(false);
  });

  it('never hides a rate with no period, however small', () => {
    expect(decide(rate('$5'), settings).hide).toBe(false);
  });

  it('never hides an implausible result', () => {
    // 0.5 USD/month lands under the sanity floor, so we assume a misread.
    const verdict = decide(rate('P30/month'), settings);
    expect(verdict.hide).toBe(false);
    expect(verdict.reason).toBe('out-of-range');
  });

  it('hides nothing while disabled', () => {
    const verdict = decide(rate('P24,000/month'), { ...settings, enabled: false });
    expect(verdict.hide).toBe(false);
    expect(verdict.reason).toBe('disabled');
  });
});

/**
 * How a range is printed, which is a separate question from which end the
 * filter judges by.
 */
describe('formatRate', () => {
  const settings = { ...DEFAULTS, fxPhpPerUsd: 60 };
  const verdictFor = (text, overrides = {}) =>
    decide(parseRate(text), { ...settings, ...overrides });

  it('prints the high end by default', () => {
    expect(formatRate(verdictFor('$5,500 - $6,700 USD per month'), settings)).toBe('$6,700/mo');
  });

  it('prints the low end when asked', () => {
    const next = { ...settings, rangeDisplay: 'low' };
    expect(formatRate(verdictFor('$5,500 - $6,700 USD per month'), next)).toBe('$5,500/mo');
  });

  it('prints the whole spread when asked', () => {
    const next = { ...settings, rangeDisplay: 'range' };
    expect(formatRate(verdictFor('$5,500 - $6,700 USD per month'), next)).toBe(
      '$5,500–$6,700/mo',
    );
  });

  it('converts both ends, not just the one the filter judges by', () => {
    const next = { ...settings, rangeDisplay: 'range' };
    // 30,000 and 42,000 pesos at 60 to the dollar.
    expect(formatRate(verdictFor('PHP 30,000 to PHP 42,000 per month'), next)).toBe(
      '$500–$700/mo',
    );
  });

  it('is independent of which end the filter judges by', () => {
    // Judged on the low end, still shown as the whole spread.
    const next = { ...settings, rangeBasis: 'low', rangeDisplay: 'range' };
    expect(formatRate(verdictFor('$5,500 - $6,700 USD per month'), next)).toBe(
      '$5,500–$6,700/mo',
    );
  });

  it('prints one figure for a listing that is not a range', () => {
    for (const mode of ['high', 'low', 'range']) {
      expect(formatRate(verdictFor('$800/month'), { ...settings, rangeDisplay: mode })).toBe(
        '$800/mo',
      );
    }
  });

  it('collapses a range whose ends round to the same figure', () => {
    // "$800–$800/mo" is noise.
    const next = { ...settings, rangeDisplay: 'range' };
    expect(formatRate(verdictFor('$800 - $800 per month'), next)).toBe('$800/mo');
  });

  it('reports what the listing stated, so a caller can judge redundancy', () => {
    const verdict = verdictFor('$5,500 - $6,700 USD per month');
    expect(verdict.currency).toBe('USD');
    expect(verdict.period).toBe('month');
    expect(verdict.assumed).toBe(false);
  });

  it('marks an assumed reading as such, whatever the listing said', () => {
    expect(verdictFor('42,000').assumed).toBe(true);
  });
});

describe("the listing's own hours per week", () => {
  /**
   * The bug this fixes: an hourly rate was always multiplied by the settings
   * default of 160 hours, so "$5/hour, 20 hrs/week" was reported as $800/month
   * when the job pays $433. At a $500 threshold that part-time listing was
   * promoted over full-time work that genuinely pays more.
   */
  it('converts an hourly rate against the hours the job states', () => {
    const full = decide(rate('$5/hour'), settings, { hoursPerWeek: 40 });
    const part = decide(rate('$5/hour'), settings, { hoursPerWeek: 20 });

    expect(Math.round(part.usdPerMonth)).toBe(Math.round(full.usdPerMonth / 2));
    expect(Math.round(part.usdPerMonth)).toBe(433);
  });

  it('falls back to the setting when the card says nothing', () => {
    const verdict = decide(rate('$5/hour'), settings, {});
    expect(verdict.usdPerMonth).toBe(5 * settings.hoursPerMonth);
  });

  it('changes the hide decision, which is the point', () => {
    const strict = { ...settings, thresholdUsdPerMonth: 500 };

    expect(decide(rate('$5/hour'), strict, { hoursPerWeek: 40 }).hide).toBe(false);
    expect(decide(rate('$5/hour'), strict, { hoursPerWeek: 20 }).hide).toBe(true);
  });

  it('leaves a monthly rate alone - hours do not change what is quoted', () => {
    const stated = decide(rate('$800/month'), settings, { hoursPerWeek: 20 });
    expect(stated.usdPerMonth).toBe(800);
  });

  it('still reports an effective hourly for a monthly rate', () => {
    // The only fair way to compare $800 for 40 hours against $700 for 20.
    const verdict = decide(rate('$800/month'), settings, { hoursPerWeek: 20 });
    expect(Math.round(verdict.usdPerHour)).toBe(9);
  });

  it('scales a range by the stated hours too', () => {
    const verdict = decide(rate('$5-$10/hour'), settings, { hoursPerWeek: 20 });
    expect(Math.round(verdict.range.low)).toBe(433);
    expect(Math.round(verdict.range.high)).toBe(867);
  });

  it('ignores hours that cannot be true', () => {
    expect(hoursPerMonthFor(settings, 0)).toBe(settings.hoursPerMonth);
    expect(hoursPerMonthFor(settings, -5)).toBe(settings.hoursPerMonth);
    expect(hoursPerMonthFor(settings, null)).toBe(settings.hoursPerMonth);
    expect(hoursPerMonthFor(settings, NaN)).toBe(settings.hoursPerMonth);
  });

  it('reports what it used, so a badge need not re-derive it', () => {
    const verdict = decide(rate('$5/hour'), settings, { hoursPerWeek: 20 });
    expect(verdict.hoursPerWeek).toBe(20);
    expect(Math.round(verdict.usdPerHour)).toBe(5);
  });
});
