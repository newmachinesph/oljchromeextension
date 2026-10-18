import { describe, it, expect } from 'vitest';
import { parseRate } from '../src/core/parse-rate.js';
import { decide } from '../src/core/normalize.js';
import { evaluateListing, reasonLabel } from '../src/core/criteria.js';
import { DEFAULTS } from '../src/core/settings.js';

/**
 * Calibration corpus: rate strings sampled from 9 pages of live search results
 * (255 listings, 189 distinct strings). Every format class the site produces is
 * represented here.
 *
 * A null expectation means the text is too ambiguous to judge, and the listing
 * must therefore stay visible.
 *
 * At the pinned rates below: $500/mo threshold, 60 PHP = $1, 1.4 AUD = $1,
 * 160 h/month.
 */
/**
 * Exchange rates pinned to what the corpus was calibrated against.
 *
 * This suite is about the parser, not about today's rates. Left on the live
 * defaults, every rate change would rewrite thirty expected values and say
 * nothing about whether the parsing still works.
 */
const settings = {
  ...DEFAULTS,
  fxPhpPerUsd: 60,
  fxAudPerUsd: 1.4,
  fxCadPerUsd: 1.37,
  fxGbpPerUsd: 0.79,
  fxEurPerUsd: 0.92,
};

const HOURLY_USD = [
  ['4USD/hour', 640],
  ['3USD/hour', 480],
  ['12 USD per hour *negotiable', 1920],
  ['$3/hour', 480],
  ['$15/hr', 2400],
  ['$4.50/hr', 720],
  ['$5/Hour', 800],
  ['US$3-4/Hour', 640],
  ['5-15$ per hour', 2400],
  ['$6-$10 / HOUR', 1600],
  ['$5-6/hour', 960],
  ['$20-$30 hour', 4800],
  ['$7.50 hr', 1200],
  ['$5 hour', 800],
  ['10 USD per hour', 1600],
  ['Up to 10 usd per hour', 1600],
  ['12-15 USD/hr', 2400],
  ['$9 - $12 USD/hr depending on experience', 1920],
  ['$5-$10+ USD / hour', 1600],
  ['$4–$7/hour USD', 1120],
  ['$10-20/hour', 3200],
  ['$15 to $20 per hour', 3200],
  ['$5 -10 / hour', 1600],
  ['$4-6` per/hr + commission', 960],
  ['USD $9 – $12/hour based on experience', 1920],
];

const MONTHLY_USD = [
  ['$700/mo', 700],
  ['$240/month', 240],
  ['$1,000/month', 1000],
  ['$600/month + bonus', 600],
  ['$800 to $1,200/month', 1200],
  ['$1,250 - $1,500/Month', 1500],
  ['$500-600/month', 600],
  ['$900-1000/month', 1000],
  ['$600-850/month', 850],
  ['$2,000 - $3,000/month', 3000],
  ['$4,000-$6,000 per month', 6000],
  ['$80/month', 80],
  ['$500 Per Month', 500],
  ['$3,500 month', 3500],
  ['$2k/mo', 2000],
  ['USD $1,000/month', 1000],
  ['1000 USD/MONTH', 1000],
  ['us$300-400 per month', 400],
  ['$600 - $1000 USD per month', 1000],
  ['$600 - $900 USD per month', 900],
  ['Up to $2000/month', 2000],
  ['$600-$1000/month 15-20 hours /week', 1000],
  ['$1,200/month - $7.50/hour', 1200],
  ['50-300usd fixed per month + commission', 300],
];

/** "p/m" means per month. The payment schedule in parentheses is not the rate. */
const PER_MONTH_SHORTHAND = [
  ['$1500 p/m', 1500],
  ['$900 p/m (Twice a month via Wise)', 900],
  ['$2,000 p/m (Twice a month via Wise)', 2000],
  ['$3,000–$5,000 p/m (Twice a month)', 5000],
  ['$1,000–$1,500 p/m (paid every two weeks)', 1500],
  ['$800 p/m (paid every two weeks)', 800],
];

const PESOS = [
  ['PHP50,000/month', 833.33],
  ['PHP 80,000 - 125,000/mo', 2083.33],
  ['70,000 - 90,000PHP / Month', 1500],
  ['Starts at 30k PHP+ per month', 500],
  ['30k PHP+ per month', 500],
  ['Starts at 35k PHP+ per month', 583.33],
  ['30,000 php to 70,000 php monthly (25-40h', 1166.67],
  ['$100,000 PHP per month', 1666.67],
  ['?25,000–?30,000 per month', 500],
  ['32 hours = 11-12,000 PHP per month', 200],
];

const AUSSIE = [
  ['AUD 8 / hour', 914.29],
  ['AUD 1000 / month', 714.29],
  ['$8 - $10 AUD/Hour', 1142.86],
  ['$7-$9 AUD/Hour + 10%-20% Commission', 1028.57],
  ['$10 AUD an hour', 1142.86],
  ['$100 AUD per week base retainer $30 AUD', 309.52],
];

const OTHER_PERIODS = [
  ['$400/week', 1733.33],
  ['Circa Annual Salary - US$6000', 500],
];

describe.each([
  ['hourly USD', HOURLY_USD],
  ['monthly USD', MONTHLY_USD],
  ['p/m shorthand', PER_MONTH_SHORTHAND],
  ['pesos', PESOS],
  ['Australian dollars', AUSSIE],
  ['other periods', OTHER_PERIODS],
])('%s', (_label, cases) => {
  for (const [text, expected] of cases) {
    it(`reads ${JSON.stringify(text)} as $${expected}/mo`, () => {
      const verdict = decide(parseRate(text), settings);
      expect(verdict.usdPerMonth).toBeCloseTo(expected, 1);
      expect(verdict.assumed).toBe(false);
    });
  }
});

/** No period stated, but large enough that an hourly reading is absurd. */
const ASSUMED_MONTHLY = [
  ['$600', 600],
  ['$800', 800],
  ['$450', 450],
  ['$750', 750],
  ['Starting 1000$', 1000],
  ['$2000-$3000', 3000],
  ['$400 - $800', 800],
  ['$500 - $700', 700],
  ['$700 - $900 based on experience', 900],
  ['$800 - $1000 based on experience', 1000],
  ['$2,400 to $3,600', 3600],
  ['$1,500-$2000', 2000],
  ['$500 for 50% Position', 500],
  ['Php 40,000', 666.67],
  ['PHP 28,000', 466.67],
  ['14000 PHP', 233.33],
  ['80,000 PHP', 1333.33],
  ['PHP 30,000 to PHP 42,000', 700],
  ['PHP 110,000 - 140,000', 2333.33],
  ['Php 16,000 to Php 30,000', 500],
  ['PHP 20-25K (depends on skills & experien', 416.67],
  ['Up to 150,000 php or depends on your experience', 2500],
  ['PHP 20,000 + commission', 333.33],
  ['20000php[nego OK after 4months]', 333.33],
  ['40,000.00 - Php45,000', 750],
  ['?65,000', 1083.33],
  ['1500 AUD', 1071.43],
  ['1200 AUD', 857.14],

  // No currency marker either: read as USD, since that is the site's convention
  // and the figure is small enough that pesos would be absurd.
  ['300', 300],
  ['600', 600],
  ['700', 700],
  ['800', 800],
  ['480', 480],
  ['560', 560],
  ['1600', 1600],
  ['1800', 1800],
  ['2000', 2000],
  ['1500-2500', 2500],
  ['700-1100', 1100],
  ['200-350', 350],
  ['750 per month, negotiable', 750],
  ['500 per month, negotiable', 500],
  ['1k a month + bonusses', 1000],
];

/**
 * Below the split point, an unstated period means hourly. A bare "5" on a
 * full-time listing is $5 an hour, not $5 a month.
 *
 * Bounded above by the platform's own $30/hour cap for applicants - see
 * ASSUMED_HOURLY_OUT_OF_REACH.
 */
const ASSUMED_HOURLY = [
  ['5', 800],
  ['6', 960],
  ['4', 640],
  ['8', 1280],
  ['10', 1600],
  ['30', 4800],
  ['7-8', 1280],
  ['10-18', 2880],
  ['5-15', 2400],
  ['$5', 800],
  ['10$', 1600],
  ['$6-$12', 1920],
  ['$5-$7', 1120],
  ['$6–$10', 1600],
  ['$12 to $15- Depending on skill set and experience', 2400],
  ['$10 to $15 - Depending on skill set and experience', 2400],
  ['$12-$18 Depending on experience', 2880],
  ['Php 65- Php 300', 800],
];

/**
 * Amounts caught between the two readings, which are therefore left alone.
 *
 * The platform caps applicants at $30 an hour, so reading "50" as hourly would
 * claim a rate the site does not permit - and $8,000 a month with it. Too small
 * to be a month's pay and too large to be an hour of it, so nothing is assumed
 * and the listing stays visible.
 */
const ASSUMED_HOURLY_OUT_OF_REACH = ['50', '60', '60.00', '75', '99', '45-80'];

/**
 * Bare amounts above the dollar ceiling, read as pesos. These are the single
 * largest group the 50-page sweep found unhandled - "42,000" alone appeared ten
 * times - and every one is a peso monthly salary.
 */
const ASSUMED_PESOS = [
  ['42,000', 700],
  ['25000', 416.67],
  ['30000', 500],
  ['35000', 583.33],
  ['65000', 1083.33],
  ['70,000', 1166.67],
  ['90,000', 1500],
  ['40,000', 666.67],
  ['110K', 1833.33],
  ['35k', 583.33],
  ['35,000 per month', 583.33],
  ['31,960/Month', 532.67],
  ['42k/month', 700],
  ['up to 210000', 3500],
  ['40000 and above', 666.67],
  ['12000 base plus incentives', 200],
  ['30000-40000', 666.67],
  ['25000 - 30000', 500],
  ['30,000 - 50,000', 833.33],
  ['45,000 - 50,000', 833.33],
  ['15,000-17000', 283.33],
  ['40,000-57,000', 950],
  ['40,000 - 80,000', 1333.33],
  ['40,000 - 60,000', 1000],
  ['25,000 - 40,000 (negotiable)', 666.67],
  ['25k-40k (First Year)', 666.67],
  ['Salary: 33,800 - 78,200 vary on experience', 1303.33],
  ['Up to 25k-40k Php 1st Year', 666.67],
];

/** Period stated, currency missing: only the currency is assumed. */
const ASSUMED_CURRENCY_ONLY = [
  ['8/hr', 1280],
  ['10.00/hr', 1600],
  ['10 PER HOUR', 1600],
  ['3/hr plus commission', 480],
  ['8-20 / hour, based on experience', 3200],
  ['5-10/h', 1600],
];

describe.each([
  ['assumed monthly', ASSUMED_MONTHLY],
  ['assumed pesos', ASSUMED_PESOS],
  ['assumed hourly', ASSUMED_HOURLY],
  ['assumed currency only', ASSUMED_CURRENCY_ONLY],
])('%s', (_label, cases) => {
  for (const [text, expected] of cases) {
    it(`reads ${JSON.stringify(text)} as about $${expected}/mo`, () => {
      const verdict = decide(parseRate(text), settings);
      expect(verdict.usdPerMonth).toBeCloseTo(expected, 1);
      expect(verdict.assumed).toBe(true);
    });
  }
});

describe('the two-sided split', () => {
  it('reads an amount above the split point as monthly', () => {
    expect(decide(parseRate('$600'), settings).usdPerMonth).toBe(600);
  });

  it('reads an amount below the split point as hourly', () => {
    // $5 x 160 hours, not $5 a month.
    expect(decide(parseRate('$5'), settings).usdPerMonth).toBe(800);
  });

  it('moves with the split point', () => {
    // Drop the split below 5 and "$5" becomes a monthly figure instead.
    const lowSplit = { ...settings, assumeMonthlyMinUsd: 3 };
    expect(decide(parseRate('$5'), lowSplit).usdPerMonth).toBe(5);
  });

  it('discards a guess that lands on an implausible salary', () => {
    // "$80 USD" read as hourly would be $12,800 a month. Better to say nothing.
    const verdict = decide(parseRate('$80 USD'), settings);
    expect(verdict.usdPerMonth).toBeNull();
    expect(verdict.hide).toBe(false);
  });

  it('keeps an implausible figure when the listing states it outright', () => {
    // Explicitly "/hr", so it is read, not guessed - no ceiling applies.
    expect(decide(parseRate('$75/hr'), settings).usdPerMonth).toBe(12000);
  });

  it('can have the hourly half switched off', () => {
    const verdict = decide(parseRate('$5'), { ...settings, assumeHourlyWhenSmall: false });
    expect(verdict.usdPerMonth).toBeNull();
    expect(verdict.hide).toBe(false);
  });

  it('can have the currency guess switched off', () => {
    const verdict = decide(parseRate('5'), { ...settings, assumeUsdWhenNoCurrency: false });
    expect(verdict.usdPerMonth).toBeNull();
    expect(verdict.reason).toBe('no-currency');
  });

  it('splits the currency guess by magnitude', () => {
    // Small figures are dollars; large ones are pesos. Nobody here advertises
    // $42,000 a month, and "42,000" is the commonest bare amount on the site.
    expect(decide(parseRate('9,000'), settings).usdPerMonth).toBe(9000);
    expect(decide(parseRate('42,000'), settings).usdPerMonth).toBeCloseTo(700, 1);
  });

  it('can have the peso half switched off', () => {
    const verdict = decide(parseRate('42,000'), { ...settings, assumePhpAboveCeiling: false });
    expect(verdict.usdPerMonth).toBeNull();
    expect(verdict.reason).toBe('no-currency');
  });
});

/** Anything here must stay visible: we could not read it well enough to judge. */
const UNJUDGEABLE = [
  // An assumption here would land on an implausible salary, so it is dropped.
  'USD75',
  '$80 USD',
  '70',

  // paid per unit of work, not per unit of time
  '$1-$5 per approved comment',
  '$15-$100 a project',
  '$150 AUD fixed price',
  '$30 AUD fixed price',
  '$10 per 100 images',
  '$6/lead',
  '$3 per minute of finished video',

  // a period word we could not attach to the amount
  '225$ plus bonuses 5.63 hr',

  // no number at all
  'TBD',
  'TBA',
  'Negotiable',
  'Commensurate with experience',
  'Depending on experience',
  '',
];

describe('left visible because unreadable', () => {
  for (const text of UNJUDGEABLE) {
    it(`refuses to judge ${JSON.stringify(text)}`, () => {
      const verdict = decide(parseRate(text), settings);
      expect(verdict.usdPerMonth).toBeNull();
      expect(verdict.hide).toBe(false);
    });
  }
});

/**
 * Every Canadian, British and euro string a 102-page sweep turned up
 * (1,403 distinct rate strings across 17 queries), verbatim.
 *
 * These were the whole reason for adding the three currencies: written with a
 * dollar sign, "CAD $900" was being read as US dollars and overstating the pay
 * by about a third - wrong, rather than merely unread.
 *
 * At defaults: 1.37 CAD, 0.79 GBP, 0.92 EUR to the dollar.
 */
describe('currencies beyond USD, PHP and AUD', () => {
  const FOUND_LIVE = [
    ['CAD $900', 'CAD', 900],
    ['$650/month CAD', 'CAD', 650],
    ['1200 CAD +Healthcare', 'CAD', 1200],
    ['$1,600 CAD per Month', 'CAD', 1600],
    ['750 CAD', 'CAD', 750],
    ['6 CAD', 'CAD', 6],
    ['$6-10 CAD', 'CAD', 10],
    ['CAD $8 to $9/hour', 'CAD', 9],
    ['$11 to $12 CAD per hour', 'CAD', 12],
    ['CAD $550-700 per month', 'CAD', 700],
    ['CAD $8-10/hr + 10% Commission', 'CAD', 10],
    ['£550', 'GBP', 550],
    ['£4', 'GBP', 4],
    ['£80/weekend', 'GBP', 80],
    ['£1,550 GBP / month', 'GBP', 1550],
    ['300 Euros per month', 'EUR', 300],
    ['1200 - 1400 euros/month', 'EUR', 1400],
    ['€1275,-/month', 'EUR', 1275],
  ];

  for (const [text, currency, amount] of FOUND_LIVE) {
    it(`reads ${JSON.stringify(text)} as ${currency}`, () => {
      const parsed = parseRate(text);
      expect(parsed.currency).toBe(currency);
      expect(parsed.amountHigh).toBe(amount);
    });
  }

  it('converts Canadian dollars down, not across', () => {
    // The bug this fixes: read as USD, this cleared the $500 threshold outright.
    const verdict = decide(parseRate('$650/month CAD'), settings);
    expect(Math.round(verdict.usdPerMonth)).toBe(474);
    expect(verdict.hide).toBe(true);
  });

  it('converts sterling and euros up, since both outvalue the dollar', () => {
    expect(Math.round(decide(parseRate('£1,550 GBP / month'), settings).usdPerMonth)).toBe(1962);
    expect(Math.round(decide(parseRate('300 Euros per month'), settings).usdPerMonth)).toBe(326);
  });

  it('honours a changed rate for each of them', () => {
    const doubled = { ...settings, fxCadPerUsd: 2, fxGbpPerUsd: 2, fxEurPerUsd: 2 };
    expect(decide(parseRate('CAD $900 per month'), doubled).usdPerMonth).toBe(450);
    expect(decide(parseRate('£900 per month'), doubled).usdPerMonth).toBe(450);
    expect(decide(parseRate('900 euros per month'), doubled).usdPerMonth).toBe(450);
  });

  it('leaves a currency it has no rate for unjudged rather than guessing', () => {
    // Removing the rate must fail closed - the listing stays visible.
    const verdict = decide(parseRate('CAD $900 per month'), { ...settings, fxCadPerUsd: 0 });
    expect(verdict.usdPerMonth).toBeNull();
    expect(verdict.hide).toBe(false);
  });

  it('does not let one currency word hijack a number beside another', () => {
    // Two words is genuine ambiguity, so the number's own neighbourhood wins.
    expect(parseRate('PHP 50,000 (approx USD 900) per month').currency).toBe('PHP');
  });

  it('still reads a plain dollar amount as US dollars', () => {
    expect(parseRate('$650/month').currency).toBe('USD');
    expect(parseRate('$8 - $10/hour').currency).toBe('USD');
  });
});

describe('the platform\'s $30/hour ceiling', () => {
  for (const text of ASSUMED_HOURLY_OUT_OF_REACH) {
    it(`refuses to assume an hourly rate for ${JSON.stringify(text)}`, () => {
      const verdict = decide(parseRate(text), settings);
      expect(verdict.usdPerMonth).toBeNull();
      expect(verdict.hide).toBe(false);
    });
  }

  it('still assumes hourly right up to the cap', () => {
    expect(decide(parseRate('30'), settings).usdPerMonth).toBe(4800);
    expect(decide(parseRate('31'), settings).usdPerMonth).toBeNull();
  });

  it('takes a stated rate at face value, cap or no cap', () => {
    // The ceiling bounds what we are willing to assume, not what an employer
    // is allowed to write.
    expect(decide(parseRate('$60/hour'), settings).usdPerMonth).toBe(9600);
  });

  it('can be moved', () => {
    const generous = { ...settings, assumeHourlyMaxUsd: 100 };
    expect(decide(parseRate('60'), generous).usdPerMonth).toBe(9600);
  });
});

describe('a gig quoting one figure', () => {
  const gig = (text) =>
    evaluateListing({
      facts: { title: 'Amazon Storefront Designer', jobType: 'gig' },
      parsed: parseRate(text),
      settings,
      now: Date.now(),
    });

  it('reads "60.00" as a $60 fee, not $60 an hour', () => {
    // The live listing that exposed this claimed $9,600/mo: 60 x 160 hours.
    const verdict = gig('60.00');

    expect(verdict.reason).toBe('task-based');
    expect(verdict.usdPerMonth).toBeNull();
    expect(verdict.fixedFeeUsd).toBe(60);
  });

  it('names the fee on the stub rather than discarding it', () => {
    const verdict = gig('60.00');
    expect(reasonLabel(verdict.reason, {}, verdict.extra)).toBe('$60 fixed');
  });

  it('converts the fee like any other amount', () => {
    expect(gig('PHP 3,000').fixedFeeUsd).toBe(50);
  });

  it('leaves a gig alone when it does state a period', () => {
    // "Gig, $25/hour" says what it means.
    const verdict = gig('$25/hour');
    expect(verdict.reason).not.toBe('task-based');
    expect(verdict.usdPerMonth).toBe(4000);
  });

  it('reads the slash shorthand as a period too', () => {
    // Found live: a gig listed "5-10/h" was being called a $10 fixed fee,
    // because no pattern recognised a bare "/h" as an hour.
    const verdict = gig('5-10/h');
    expect(verdict.reason).not.toBe('task-based');
    expect(verdict.usdPerMonth).toBe(1600);
  });

  it('does not apply to listings that are not gigs', () => {
    const verdict = evaluateListing({
      facts: { title: 'Virtual Assistant', jobType: 'full-time' },
      parsed: parseRate('8'),
      settings,
      now: Date.now(),
    });
    expect(verdict.usdPerMonth).toBe(1280);
  });

  it('is never hidden unless per-task listings are being hidden', () => {
    expect(gig('60.00').hide).toBe(false);
    expect(
      evaluateListing({
        facts: { title: 'x', jobType: 'gig' },
        parsed: parseRate('60.00'),
        settings: { ...settings, hideTaskBased: true },
        now: Date.now(),
      }).hide,
    ).toBe(true);
  });
});

describe('calibration invariants', () => {
  it('treats a bare $ as US dollars', () => {
    expect(parseRate('$600/month').currency).toBe('USD');
  });

  it('lets an explicit AUD outrank a bare $ in a range', () => {
    expect(parseRate('$8 - $10 AUD/Hour').currency).toBe('AUD');
  });

  it('lets an explicit PHP outrank a bare $', () => {
    expect(parseRate('$100,000 PHP per month').currency).toBe('PHP');
  });

  it('reads the slash shorthand for a period', () => {
    expect(parseRate('5-10/h').period).toBe('hour');
    expect(parseRate('$40/hr').period).toBe('hour');
    expect(parseRate('1200/mo').period).toBe('month');
    expect(parseRate('$300/wk').period).toBe('week');
    expect(parseRate('$80/d').period).toBe('day');
  });

  it('does not read a plain fraction as a period', () => {
    // "$500 for 50% Position" and similar must not pick up a stray letter.
    expect(parseRate('$500 for 50% Position').period).toBeNull();
  });

  it('reads a currency word placed before the symbol', () => {
    // "AUD $10" - without this the bare $ would win and call it US dollars.
    expect(parseRate('AUD $10 to $15 per month').currency).toBe('AUD');
  });

  it('accepts "ph" as shorthand for pesos', () => {
    const parsed = parseRate('ph 11000/month');
    expect(parsed.currency).toBe('PHP');
    expect(parsed.period).toBe('month');
  });

  it('does not read "ph" at the end of another word as pesos', () => {
    expect(parseRate('paragraph 500/month').currency).toBeNull();
  });

  it('treats an ordinal year as tenure, not an annual salary', () => {
    // "1st Year" means the first year of employment.
    expect(parseRate('Up to 25k-40k Php 1st Year').period).toBeNull();
    expect(parseRate('$60,000/year').period).toBe('year');
  });

  it('ignores a "k" suffix on an already-large number', () => {
    // "45,000K PHP Monthly" is a typo, not 45 million pesos.
    expect(parseRate('45,000K PHP Monthly').amountHigh).toBe(45000);
    expect(parseRate('40k').amountHigh).toBe(40000);
  });

  it('requires a range to involve the primary amount', () => {
    // The bonus range must not be mistaken for the salary.
    const parsed = parseRate('$1500/month + Bonuses ( Total $5-10k/mo(');
    expect(parsed.isRange).toBe(false);
    expect(parsed.amountHigh).toBe(1500);
    expect(parsed.period).toBe('month');
  });

  it('applies a single "k" to both ends of a range', () => {
    const parsed = parseRate('PHP 20-25K');
    expect(parsed.amountLow).toBe(20000);
    expect(parsed.amountHigh).toBe(25000);
  });

  it('reads a range whose currency appears on one end only', () => {
    const parsed = parseRate('$500-600/month');
    expect(parsed.isRange).toBe(true);
    expect(parsed.amountHigh).toBe(600);
    expect(parsed.currency).toBe('USD');
  });

  it('does not mistake a payment schedule for a pay period', () => {
    expect(parseRate('$800 p/m (paid every two weeks)').period).toBe('month');
  });

  it('flags a per-task rate rather than treating it as salary', () => {
    expect(parseRate('$10 per 100 images').taskBased).toBe(true);
    expect(parseRate('$1-$5 per approved comment').taskBased).toBe(true);
    expect(parseRate('$600/month').taskBased).toBe(false);
  });

  it('flags a period word it could not attach', () => {
    expect(parseRate('225$ plus bonuses 5.63 hr').ambiguousPeriod).toBe(true);
  });

  it('honours a changed AUD rate', () => {
    const verdict = decide(parseRate('AUD 1000 / month'), { ...settings, fxAudPerUsd: 2 });
    expect(verdict.usdPerMonth).toBe(500);
  });
});
