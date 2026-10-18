/**
 * The built-in parser's own vocabulary, laid open.
 *
 * Everything the parser knows about naming a currency or a pay period is these
 * two lists. Showing them is partly so they can be extended without waiting for
 * a release, and partly so the parser stops being a black box you have to trust.
 *
 * Words, not patterns - see core/vocabulary.js for why. Symbols like a bare "$"
 * are deliberately absent: their weaker precedence is what makes "$10 AUD/Hour"
 * come out Australian, and that ordering lives in the parser.
 */

import {
  DEFAULT_VOCABULARY,
  CURRENCY_ORDER,
  PERIOD_ORDER,
  isDefaultVocabulary,
} from '../core/vocabulary.js';

const PERIOD_LABELS = {
  hour: 'Per hour',
  day: 'Per day',
  week: 'Per week',
  month: 'Per month',
  year: 'Per year',
};

const CURRENCY_LABELS = {
  PHP: 'Philippine pesos',
  AUD: 'Australian dollars',
  CAD: 'Canadian dollars',
  GBP: 'Pounds sterling',
  EUR: 'Euros',
  USD: 'US dollars',
};

const toList = (text) =>
  text
    .split(',')
    .map((word) => word.trim())
    .filter(Boolean);

function WordRow({ label, words, fallback, onChange }) {
  const changed = words.join(',') !== fallback.join(',');

  return (
    <div className="vocab-row">
      <div className="vocab-head">
        <span className="vocab-label">{label}</span>
        {changed && (
          <button type="button" className="vocab-reset" onClick={() => onChange([...fallback])}>
            Reset
          </button>
        )}
      </div>
      <input
        type="text"
        className="text-input mono"
        spellCheck="false"
        value={words.join(', ')}
        onChange={(event) => onChange(toList(event.target.value))}
      />
    </div>
  );
}

export function Vocabulary({ vocabulary, onChange }) {
  const setGroup = (kind, name, words) =>
    onChange({ ...vocabulary, [kind]: { ...vocabulary[kind], [name]: words } });

  return (
    <div className="vocab">
      <p className="section-desc">
        These are the words the built-in parser looks for. Comma-separated, matched
        case-insensitively, and matched as whole words — so <code>ph</code> reads
        &ldquo;ph 11000&rdquo; as pesos without also matching the end of
        &ldquo;paragraph&rdquo;. Add one when the site starts using wording the parser
        does not know.
      </p>
      <p className="section-desc">
        Symbols are handled separately and are not listed here. A bare <code>$</code> is
        deliberately weaker evidence than the word <code>usd</code>, which is what makes
        &ldquo;$10 AUD/Hour&rdquo; come out Australian rather than American.
      </p>

      <h3 className="rules-examples-heading">Currency words</h3>
      {CURRENCY_ORDER.map((code) => (
        <WordRow
          key={code}
          label={`${code} — ${CURRENCY_LABELS[code]}`}
          words={vocabulary.currency[code] ?? []}
          fallback={DEFAULT_VOCABULARY.currency[code]}
          onChange={(words) => setGroup('currency', code, words)}
        />
      ))}

      <h3 className="rules-examples-heading">Pay period words</h3>
      {PERIOD_ORDER.map((name) => (
        <WordRow
          key={name}
          label={PERIOD_LABELS[name]}
          words={vocabulary.period[name] ?? []}
          fallback={DEFAULT_VOCABULARY.period[name]}
          onChange={(words) => setGroup('period', name, words)}
        />
      ))}

      {!isDefaultVocabulary(vocabulary) && (
        <div className="rules-actions">
          <button type="button" className="reset" onClick={() => onChange(DEFAULT_VOCABULARY)}>
            Restore every built-in word
          </button>
        </div>
      )}
    </div>
  );
}
