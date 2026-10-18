import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VOCABULARY,
  sanitizeVocabulary,
  vocabularySignature,
  isDefaultVocabulary,
  buildPatterns,
} from '../src/core/vocabulary.js';
import { parseRate } from '../src/core/parse-rate.js';
import { sanitize } from '../src/core/settings.js';

/** The shipped vocabulary with one group replaced. */
const withPeriod = (name, words) => ({
  ...DEFAULT_VOCABULARY,
  period: { ...DEFAULT_VOCABULARY.period, [name]: words },
});

const withCurrency = (code, words) => ({
  ...DEFAULT_VOCABULARY,
  currency: { ...DEFAULT_VOCABULARY.currency, [code]: words },
});

describe('the shipped vocabulary', () => {
  it('is what the parser uses when it is given nothing', () => {
    expect(parseRate('PHP 20-25K')).toMatchObject({ currency: 'PHP' });
    expect(parseRate('PHP 20-25K', DEFAULT_VOCABULARY)).toMatchObject({ currency: 'PHP' });
  });

  it('names every currency the extension can convert', () => {
    expect(Object.keys(DEFAULT_VOCABULARY.currency).sort()).toEqual([
      'AED',
      'AUD',
      'CAD',
      'EUR',
      'GBP',
      'HKD',
      'JPY',
      'KRW',
      'NOK',
      'NZD',
      'PHP',
      'SGD',
      'THB',
      'USD',
    ]);
  });

  /*
   * The guard that matters more than the list above.
   *
   * A currency the parser can DETECT but cannot CONVERT resolves to nothing:
   * the listing reads as unpriced and quietly drops out of every rate filter.
   * The two tables have to move together, so this fails loudly if one is
   * extended without the other.
   */
  it('can convert every currency it can detect', async () => {
    const { DEFAULTS } = await import('../src/core/settings.js');
    const { toUsd } = await import('../src/core/normalize.js');

    for (const code of Object.keys(DEFAULT_VOCABULARY.currency)) {
      const converted = toUsd(100, code, DEFAULTS);
      expect(converted, `${code} has no usable exchange rate`).toBeGreaterThan(0);
    }
  });

  it('leaves symbols out - their weaker precedence lives in the parser', () => {
    // "$" in the USD list would outrank the word "AUD" and break this.
    expect(DEFAULT_VOCABULARY.currency.USD).not.toContain('$');
    expect(parseRate('$8 - $10 AUD/Hour').currency).toBe('AUD');
  });
});

describe('teaching it a new word', () => {
  it('reads a period the parser shipped without', () => {
    expect(parseRate('900 per fortnight').period).toBeNull();

    const taught = withPeriod('week', [...DEFAULT_VOCABULARY.period.week, 'fortnight']);
    expect(parseRate('900 per fortnight', taught).period).toBe('week');
  });

  it('reads a currency word the parser shipped without', () => {
    // SGD used to be the example here and is now shipped, which is the point of
    // this test working at all - it needs one the parser genuinely does not know.
    expect(parseRate('2400 MYR').currency).toBeNull();

    const taught = withCurrency('USD', [...DEFAULT_VOCABULARY.currency.USD, 'myr']);
    expect(parseRate('2400 MYR', taught).currency).toBe('USD');
  });

  it('escapes what it is given rather than treating it as a pattern', () => {
    // A word with regex metacharacters must match literally, not blow up.
    const taught = withCurrency('EUR', ['eur', '(euro)']);
    expect(() => parseRate('1200 (euro)', taught)).not.toThrow();
    expect(parseRate('1200 (euro)', taught).currency).toBe('EUR');
  });

  it('still matches whole words only', () => {
    // "ph" reads "ph 11000" as pesos without matching the end of "paragraph".
    expect(parseRate('ph 11000/month').currency).toBe('PHP');
    expect(parseRate('paragraph 500/month').currency).toBeNull();
  });

  it('applies to the range separator too', () => {
    const taught = withCurrency('USD', [...DEFAULT_VOCABULARY.currency.USD, 'bucks']);
    const parsed = parseRate('400 bucks - 600 bucks per month', taught);
    expect(parsed.isRange).toBe(true);
    expect(parsed.amountHigh).toBe(600);
    expect(parsed.currency).toBe('USD');
  });

  it('forgets a word that is removed', () => {
    const stripped = withCurrency('PHP', ['php']);
    expect(parseRate('20000 pesos per month', stripped).currency).toBeNull();
  });

  it('keeps the ordinal guard on years', () => {
    expect(parseRate('Up to 25k-40k Php 1st Year', DEFAULT_VOCABULARY).period).toBeNull();
  });
});

describe('buildPatterns', () => {
  it('returns the same compiled set for the same vocabulary', () => {
    expect(buildPatterns(DEFAULT_VOCABULARY)).toBe(buildPatterns(DEFAULT_VOCABULARY));
  });

  it('returns a different one once a word changes', () => {
    expect(buildPatterns(DEFAULT_VOCABULARY)).not.toBe(
      buildPatterns(withPeriod('week', ['week', 'fortnight'])),
    );
  });
});

describe('sanitizeVocabulary', () => {
  it('fills anything missing from the defaults', () => {
    // A half-written vocabulary must never leave a currency unreadable.
    const cleaned = sanitizeVocabulary({ currency: { USD: ['usd'] } });
    expect(cleaned.currency.USD).toEqual(['usd']);
    expect(cleaned.currency.PHP).toEqual([...DEFAULT_VOCABULARY.currency.PHP]);
    expect(cleaned.period.month).toEqual([...DEFAULT_VOCABULARY.period.month]);
  });

  it('rejects anything that is not an object', () => {
    expect(sanitizeVocabulary(null)).toEqual(sanitizeVocabulary(DEFAULT_VOCABULARY));
    expect(sanitizeVocabulary('words')).toEqual(sanitizeVocabulary(DEFAULT_VOCABULARY));
  });

  it('trims, lowercases and deduplicates', () => {
    const cleaned = sanitizeVocabulary({ currency: { USD: ['  USD ', 'usd', 'US$', ''] } });
    expect(cleaned.currency.USD).toEqual(['usd', 'us$']);
  });

  it('bounds a runaway list', () => {
    const many = Array.from({ length: 80 }, (_, i) => `w${i}`);
    expect(sanitizeVocabulary({ period: { hour: many } }).period.hour).toHaveLength(40);
  });

  it('is applied by the settings sanitizer', () => {
    const settings = sanitize({ vocabulary: { currency: { USD: ['USD', 'bucks'] } } });
    expect(settings.vocabulary.currency.USD).toEqual(['usd', 'bucks']);
    expect(settings.vocabulary.period.month).toEqual([...DEFAULT_VOCABULARY.period.month]);
  });

  it('defaults to the shipped words', () => {
    expect(isDefaultVocabulary(sanitize({}).vocabulary)).toBe(true);
  });
});

describe('vocabularySignature', () => {
  it('is stable for an unchanged vocabulary', () => {
    expect(vocabularySignature(DEFAULT_VOCABULARY)).toBe(vocabularySignature(DEFAULT_VOCABULARY));
  });

  it('moves when any word does', () => {
    expect(vocabularySignature(DEFAULT_VOCABULARY)).not.toBe(
      vocabularySignature(withPeriod('day', ['day'])),
    );
  });
});
