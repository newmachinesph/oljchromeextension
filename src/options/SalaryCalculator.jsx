import { useEffect, useMemo, useState } from 'react';
import { loadSettings } from '../core/settings.js';
import { calcSalary, CALC_PERIODS, CALC_CURRENCIES, DEFAULT_ASSUMPTIONS } from '../core/salary-calc.js';

/**
 * A standalone pay converter.
 *
 * The badges answer "is this listing good?" one job at a time. This answers the
 * bare question - "$5/hour, is that any good?" - with no job attached. It reuses
 * the same arithmetic and the same FX rates you set for the filter, so the
 * answer here matches the badges you see on the page.
 */

const money = (value, currency) =>
  value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: value >= 100 ? 0 : 2,
      }).format(value);

export function SalaryCalculator() {
  const [settings, setSettings] = useState(null);
  const [amount, setAmount] = useState('5');
  const [currency, setCurrency] = useState('USD');
  const [period, setPeriod] = useState('hour');
  const [hoursPerWeek, setHoursPerWeek] = useState('40');

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  // One effective hours/week, so the number the table is computed on is the
  // same one the footer names - a blank or non-positive entry falls back to 40
  // in both places rather than showing one value and computing another.
  const typedHours = Number(hoursPerWeek);
  const effectiveHours = Number.isFinite(typedHours) && typedHours > 0 ? typedHours : DEFAULT_ASSUMPTIONS.hoursPerWeek;

  const result = useMemo(() => {
    if (!settings) return null;
    // A blank amount is "nothing entered", not zero.
    const amt = amount.trim() === '' ? NaN : Number(amount);
    return calcSalary({ amount: amt, currency, period }, { ...settings, hoursPerWeek: effectiveHours });
  }, [settings, amount, currency, period, effectiveHours]);

  if (settings === null) return <p className="loading">Loading...</p>;

  const daysPerMonth =
    Number.isFinite(settings.daysPerMonth) && settings.daysPerMonth > 0
      ? settings.daysPerMonth
      : DEFAULT_ASSUMPTIONS.daysPerMonth;

  return (
    <div className="salary-calc">
      <div className="salary-calc-inputs">
        <label className="field">
          <span className="field-label">Amount</span>
          <input
            type="number"
            className="text-input"
            min="0"
            step="any"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>

        <label className="field">
          <span className="field-label">Currency</span>
          <select
            className="text-input"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
          >
            {CALC_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Per</span>
          <select
            className="text-input"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          >
            {CALC_PERIODS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label.replace('per ', '')}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Hours / week</span>
          <input
            type="number"
            className="text-input"
            min="1"
            step="any"
            value={hoursPerWeek}
            onChange={(event) => setHoursPerWeek(event.target.value)}
          />
        </label>
      </div>

      {result === null ? (
        <p className="field-hint">
          Enter an amount. Foreign currencies need their rate set on the Reading rates tab.
        </p>
      ) : (
        <table className="data-table salary-calc-out">
          <thead>
            <tr>
              <th></th>
              <th>USD</th>
              <th>PHP</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Per hour</th>
              <td>{money(result.usdPerHour, 'USD')}</td>
              <td>{money(result.phpPerHour, 'PHP')}</td>
            </tr>
            <tr>
              <th>Per month</th>
              <td>{money(result.usdPerMonth, 'USD')}</td>
              <td>{money(result.phpPerMonth, 'PHP')}</td>
            </tr>
          </tbody>
        </table>
      )}

      <p className="field-hint">
        Monthly assumes {effectiveHours} hours a week
        {period === 'day' ? ` and ${daysPerMonth} working days a month` : ''}. Uses your saved
        exchange rates, so it agrees with the badges on the job list.
      </p>
    </div>
  );
}
