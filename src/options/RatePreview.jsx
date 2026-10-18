import { useMemo, useState } from 'react';
import { readRate } from '../core/custom-rules.js';
import { decide, formatUsdPerMonth } from '../core/normalize.js';
import { Section } from './fields.jsx';

const SAMPLES = ['$800/month', 'P 25,000 / mo', '$5/hour', '$300-$500/month', '25000'];

const REASON_TEXT = {
  'no-currency': 'no currency marker found - kept visible',
  'no-period': 'no pay period found - kept visible',
  'non-positive': 'amount is not positive - kept visible',
  'out-of-range': 'result outside sane bounds - kept visible',
  unparsed: 'no number found - kept visible',
  'below-threshold': 'below your threshold - would be collapsed',
  'above-threshold': 'clears your threshold - stays visible',
  disabled: 'filter is switched off',
};

/**
 * A window into the parser. Paste any salary text and see exactly how it is
 * read and what the filter would do with it - so the hide rules are auditable
 * rather than something you have to trust.
 */
export function RatePreview({ settings }) {
  const [text, setText] = useState('$800/month');

  // Custom rules first, exactly as the page reads it - a tester that ignored
  // your own rules would be a tester of the wrong thing.
  const { parsed, verdict } = useMemo(() => {
    const result = readRate(text, settings.customRules, settings.vocabulary);
    return { parsed: result, verdict: decide(result, settings) };
  }, [text, settings]);

  return (
    <Section
      title="Test the parser"
      description="Paste any salary text from a listing to see how it is read."
    >
      <input
        className="preview-input"
        type="text"
        value={text}
        placeholder="e.g. P 25,000 / month"
        onChange={(event) => setText(event.target.value)}
      />

      <div className="preview-samples">
        {SAMPLES.map((sample) => (
          <button key={sample} type="button" onClick={() => setText(sample)}>
            {sample}
          </button>
        ))}
      </div>

      <dl className="preview-result">
        <dt>Amount</dt>
        <dd>
          {parsed
            ? parsed.isRange
              ? `${parsed.amountLow} - ${parsed.amountHigh}`
              : String(parsed.amount)
            : '-'}
        </dd>

        {parsed?.matchedRule && (
          <>
            <dt>Read by</dt>
            <dd>your rule &ldquo;{parsed.matchedRule}&rdquo;</dd>
          </>
        )}

        <dt>Currency</dt>
        <dd>{parsed?.currency ?? 'not detected'}</dd>

        <dt>Period</dt>
        <dd>{parsed?.period ?? 'not detected'}</dd>

        <dt>Normalised</dt>
        <dd>{verdict.usdPerMonth !== null ? formatUsdPerMonth(verdict.usdPerMonth) : '-'}</dd>

        <dt>Verdict</dt>
        <dd className={verdict.hide ? 'verdict-hide' : 'verdict-keep'}>
          {verdict.hide ? 'Collapsed' : 'Visible'}
          <span className="verdict-reason">
            {REASON_TEXT[verdict.reason] ?? verdict.reason}
          </span>
        </dd>
      </dl>
    </Section>
  );
}
