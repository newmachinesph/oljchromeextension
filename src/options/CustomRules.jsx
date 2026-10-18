/**
 * The custom-parser editor.
 *
 * The built-in parser is regular expressions calibrated against a live corpus,
 * and the site has no house style - so this exposes the same mechanism. A rule
 * is a pattern plus what it means, tried before the built-in parser.
 *
 * Every rule carries its own test box, because a regular expression you cannot
 * try is a regular expression you will get wrong.
 */

import { useState } from 'react';
import {
  applyRule,
  ruleError,
  RULE_CURRENCIES,
  RULE_PERIODS,
  RULE_LIMITS,
} from '../core/custom-rules.js';
import { decide, formatUsdPerMonth } from '../core/normalize.js';
import { TextField } from './fields.jsx';

/**
 * Starting points, each a format the built-in parser handles poorly or not at
 * all. Loading one is faster than writing a pattern from scratch, and they
 * double as worked examples of the capture-group convention.
 */
const EXAMPLES = [
  {
    name: 'Per fortnight',
    pattern: '([\\d,]+)\\s*(?:per|/|a)\\s*(?:fortnight|two weeks|2 weeks)',
    currency: 'USD',
    period: '',
    sample: '900 per fortnight',
    why: 'A period the parser has no word for. Left with no period so the assumptions still fill the rest in.',
  },
  {
    name: 'Range in thousands of pesos',
    pattern: '(\\d+)\\s*-\\s*(\\d+)\\s*k\\s*(?:php|pesos)',
    currency: 'PHP',
    period: 'month',
    sample: '25-35k php',
    why: 'Two capture groups make it a range; the high end is what the filter judges by default.',
  },
  {
    name: 'Singapore dollars',
    pattern: '(?:sgd|s\\$)\\s*([\\d,]+)',
    currency: 'USD',
    period: '',
    sample: 'SGD 2,400',
    why: 'A currency we carry no rate for. Never appeared in the sweep, but this is the shape to copy if it turns up.',
  },
];

const blankRule = () => ({
  id: `rule-${Math.random().toString(36).slice(2, 9)}`,
  enabled: true,
  name: '',
  pattern: '',
  currency: '',
  period: '',
});

/** What a rule makes of a sample, in one line. */
function RuleTest({ rule, settings }) {
  const [sample, setSample] = useState('');

  const box = (
    <input
      type="text"
      className="text-input rule-test"
      placeholder="Try it: paste a rate here…"
      spellCheck="false"
      value={sample}
      onChange={(event) => setSample(event.target.value)}
    />
  );

  if (sample.trim().length === 0) return box;

  let parsed = null;
  try {
    parsed = applyRule({ ...rule, enabled: true }, sample);
  } catch {
    parsed = null;
  }

  const monthly = parsed ? decide(parsed, settings).usdPerMonth : null;
  const amount = parsed
    ? parsed.isRange
      ? `${parsed.amountLow.toLocaleString('en-US')}–${parsed.amountHigh.toLocaleString('en-US')}`
      : parsed.amountHigh.toLocaleString('en-US')
    : null;

  return (
    <>
      {box}
      <p className={parsed ? 'rule-result rule-match' : 'rule-result rule-nomatch'}>
        {!parsed && 'No match — this rule would not change how that reads.'}
        {parsed && (
          <>
            Matched <strong>{amount}</strong> {parsed.currency ?? '(currency auto)'}{' '}
            {parsed.period ? `per ${parsed.period}` : '(period auto)'}
            {monthly === null || monthly === undefined
              ? ' → not resolvable on its own'
              : ` → ${formatUsdPerMonth(monthly)}`}
          </>
        )}
      </p>
    </>
  );
}

function RuleRow({ rule, settings, onChange, onRemove }) {
  const error = ruleError(rule);

  return (
    <li className={rule.enabled ? 'rule' : 'rule rule-off'}>
      <div className="rule-head">
        <label className="rule-enable">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(event) => onChange({ ...rule, enabled: event.target.checked })}
          />
          <span>Enabled</span>
        </label>
        <input
          type="text"
          className="text-input rule-name"
          placeholder="Name this rule"
          value={rule.name}
          maxLength={RULE_LIMITS.MAX_NAME}
          onChange={(event) => onChange({ ...rule, name: event.target.value })}
        />
        <button type="button" className="rule-remove" onClick={onRemove}>
          Remove
        </button>
      </div>

      <TextField
        label="Pattern"
        mono
        invalid={error !== null}
        value={rule.pattern}
        placeholder="([\d,]+)\s*per\s*fortnight"
        hint="A JavaScript regular expression, always matched case-insensitively. The first capture group is the amount; a second makes it a range. With no capture groups, the first number inside the match is used."
        onChange={(value) => onChange({ ...rule, pattern: value })}
      />
      {error && <p className="rule-error">{error}</p>}

      <div className="rule-selects">
        <label className="field">
          <span className="field-label">Currency</span>
          <select
            value={rule.currency}
            onChange={(event) => onChange({ ...rule, currency: event.target.value })}
          >
            {RULE_CURRENCIES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Period</span>
          <select
            value={rule.period}
            onChange={(event) => onChange({ ...rule, period: event.target.value })}
          >
            {RULE_PERIODS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <RuleTest rule={rule} settings={settings} />
    </li>
  );
}

export function CustomRules({ settings, onChange }) {
  const rules = settings.customRules;
  const atLimit = rules.length >= RULE_LIMITS.MAX_RULES;

  const replace = (index, next) =>
    onChange(rules.map((rule, position) => (position === index ? next : rule)));

  return (
    <div className="rules">
      <p className="section-desc">
        The built-in parser is regular expressions tuned against a sweep of the live
        site — but employers keep inventing wording, and waiting for the parser to
        catch up is not much use to you now. A rule is tried <strong>before</strong> the
        built-in parser, so it can both read a format we cannot and correct one we read
        wrongly. The first matching rule wins; if none match, nothing changes.
      </p>

      {rules.length === 0 && (
        <p className="rules-empty">
          No rules yet. The parser handles the site&apos;s usual vocabulary on its own —
          add one when you meet a format it gets wrong.
        </p>
      )}

      <ul className="rule-list">
        {rules.map((rule, index) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            settings={settings}
            onChange={(next) => replace(index, next)}
            onRemove={() => onChange(rules.filter((_, position) => position !== index))}
          />
        ))}
      </ul>

      <div className="rules-actions">
        <button
          type="button"
          className="reset"
          disabled={atLimit}
          onClick={() => onChange([...rules, blankRule()])}
        >
          Add a rule
        </button>
        {atLimit && (
          <span className="field-hint">
            {RULE_LIMITS.MAX_RULES} is the limit — every rule is tried against every
            listing, so the list is bounded deliberately.
          </span>
        )}
      </div>

      <h3 className="rules-examples-heading">Start from an example</h3>
      <ul className="rules-examples">
        {EXAMPLES.map((example) => (
          <li key={example.name}>
            <div>
              <strong>{example.name}</strong>
              <code>{example.pattern}</code>
              <span className="field-hint">
                Matches <em>{example.sample}</em>. {example.why}
              </span>
            </div>
            <button
              type="button"
              className="reset"
              disabled={atLimit}
              onClick={() =>
                onChange([
                  ...rules,
                  {
                    ...blankRule(),
                    name: example.name,
                    pattern: example.pattern,
                    currency: example.currency,
                    period: example.period,
                  },
                ])
              }
            >
              Add
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
