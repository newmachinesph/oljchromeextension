/**
 * A standalone pay converter, for the question the filter cannot answer:
 * "$5/hour - is that any good?" The badges already normalise every listing to
 * USD per month; this exposes the same arithmetic as a tool you drive by hand.
 *
 * Given an amount in some currency over some period, it returns the equivalent
 * per hour and per month, in both USD and PHP - the two frames a jobseeker here
 * actually thinks in. Pure: no DOM, no storage, no clock.
 */

import { toUsd } from './normalize.js';

const WEEKS_PER_MONTH = 52 / 12;

/** The periods a pay figure can be quoted over, in the order a form lists them. */
export const CALC_PERIODS = Object.freeze([
  { value: 'hour', label: 'per hour' },
  { value: 'day', label: 'per day' },
  { value: 'week', label: 'per week' },
  { value: 'month', label: 'per month' },
  { value: 'year', label: 'per year' },
]);

/** The currencies the converter offers, keyed to the FX settings normalize uses. */
export const CALC_CURRENCIES = Object.freeze(['USD', 'PHP', 'AUD', 'CAD', 'GBP', 'EUR']);

/** Sensible defaults when the caller does not pass working assumptions. */
export const DEFAULT_ASSUMPTIONS = Object.freeze({ hoursPerWeek: 40, daysPerMonth: 22 });

/** How many of a period fit in one month. Null when the period is unknown. */
function periodsPerMonth(period, { hoursPerWeek, daysPerMonth }) {
  switch (period) {
    case 'hour':
      return hoursPerWeek * WEEKS_PER_MONTH;
    case 'day':
      return daysPerMonth;
    case 'week':
      return WEEKS_PER_MONTH;
    case 'month':
      return 1;
    case 'year':
      return 1 / 12;
    default:
      return null;
  }
}

/**
 * Convert one pay figure into per-hour and per-month, in USD and PHP.
 *
 * @param {{amount: number, currency: string, period: string}} input
 * @param {{fxPhpPerUsd?: number, fxAudPerUsd?: number, fxCadPerUsd?: number,
 *   fxGbpPerUsd?: number, fxEurPerUsd?: number, hoursPerWeek?: number,
 *   daysPerMonth?: number}} [opts] FX rates (units per USD) and assumptions.
 * @returns {{usdPerHour: number, usdPerMonth: number, phpPerHour: number,
 *   phpPerMonth: number}|null} null when the input or FX rate is unusable.
 */
export function calcSalary(input, opts = {}) {
  const amount = Number(input?.amount);
  if (!Number.isFinite(amount) || amount < 0) return null;

  const period = input?.period ?? 'month';
  const currency = input?.currency ?? 'USD';

  const hoursPerWeek =
    Number.isFinite(opts.hoursPerWeek) && opts.hoursPerWeek > 0
      ? opts.hoursPerWeek
      : DEFAULT_ASSUMPTIONS.hoursPerWeek;
  const daysPerMonth =
    Number.isFinite(opts.daysPerMonth) && opts.daysPerMonth > 0
      ? opts.daysPerMonth
      : DEFAULT_ASSUMPTIONS.daysPerMonth;

  const perMonth = periodsPerMonth(period, { hoursPerWeek, daysPerMonth });
  if (perMonth === null || perMonth <= 0) return null;

  // Everything goes through USD, exactly as the badge pipeline does.
  const usdAmount = toUsd(amount, currency, opts);
  if (!Number.isFinite(usdAmount)) return null;

  const usdPerMonth = usdAmount * perMonth;
  const hoursInMonth = hoursPerWeek * WEEKS_PER_MONTH;
  const usdPerHour = hoursInMonth > 0 ? usdPerMonth / hoursInMonth : null;

  const phpPerUsd = opts.fxPhpPerUsd;
  const hasPhp = Number.isFinite(phpPerUsd) && phpPerUsd > 0;

  return {
    usdPerHour: usdPerHour,
    usdPerMonth,
    phpPerHour: hasPhp && usdPerHour !== null ? usdPerHour * phpPerUsd : null,
    phpPerMonth: hasPhp ? usdPerMonth * phpPerUsd : null,
  };
}
