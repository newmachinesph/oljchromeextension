/**
 * Pure conversion of a parsed rate into one comparable number: USD per month.
 * No DOM, no chrome APIs.
 */

/** Below or above these, we assume we misread rather than that the job is real. */
export const SANE_MIN_USD_PER_MONTH = 1;
export const SANE_MAX_USD_PER_MONTH = 100000;

/** Weeks in a month, used wherever a weekly figure becomes a monthly one. */
const WEEKS_PER_MONTH = 52 / 12;

/**
 * Hours in a month for this listing.
 *
 * The listing's own "hours per week" when it states one, and the settings
 * default when it does not. A stated figure is a fact about the job and beats
 * any global assumption we could make about it.
 */
export function hoursPerMonthFor(settings, hoursPerWeek) {
  return Number.isFinite(hoursPerWeek) && hoursPerWeek > 0
    ? hoursPerWeek * WEEKS_PER_MONTH
    : settings.hoursPerMonth;
}

/**
 * How many of a given period fit in one month.
 * Days come from settings because they are a judgement call, not a fact.
 */
function periodsPerMonth(period, settings, hoursPerWeek) {
  switch (period) {
    case 'month':
      return 1;
    case 'hour':
      return hoursPerMonthFor(settings, hoursPerWeek);
    case 'day':
      return settings.daysPerMonth;
    case 'week':
      return WEEKS_PER_MONTH;
    case 'year':
      return 1 / 12;
    default:
      return null;
  }
}

/** Which setting holds each currency's units-per-USD rate. */
const FX_SETTING = {
  PHP: 'fxPhpPerUsd',
  AUD: 'fxAudPerUsd',
  CAD: 'fxCadPerUsd',
  GBP: 'fxGbpPerUsd',
  EUR: 'fxEurPerUsd',
  NZD: 'fxNzdPerUsd',
  AED: 'fxAedPerUsd',
  SGD: 'fxSgdPerUsd',
  JPY: 'fxJpyPerUsd',
  KRW: 'fxKrwPerUsd',
  HKD: 'fxHkdPerUsd',
  NOK: 'fxNokPerUsd',
  THB: 'fxThbPerUsd',
};

export function toUsd(amount, currency, settings) {
  if (currency === 'USD') return amount;

  const rate = settings[FX_SETTING[currency]];
  if (!Number.isFinite(rate) || rate <= 0) return null;

  return amount / rate;
}

/**
 * Most listings on this site state an amount but no period ("$600",
 * "USD 450 - USD 500"). Reading those as monthly is safe only when an hourly
 * reading would be absurd - $600/hour is $96,000 a month, nobody means that.
 *
 * Below the floor the amount is genuinely ambiguous ("6" could be $6/hour), so
 * it is left alone and therefore never hidden.
 */
export function applyAssumptions(parsed, settings, context = {}) {
  if (!parsed) return parsed;
  // Nothing to fill in.
  if (parsed.currency && parsed.period) return parsed;

  // Never assume over visible contrary evidence. "225$ plus bonuses 5.63 hr"
  // mentions an hour we could not attach; "$1-$5 per approved comment" is not a
  // salary at all. Both stay unresolved, and therefore stay visible.
  if (parsed.ambiguousPeriod || parsed.taskBased) return parsed;

  // No currency marker: split by magnitude. Small figures are dollars, which is
  // this site's convention; large ones are pesos, because nobody advertises
  // $42,000 a month here.
  let currency = parsed.currency;
  let currencyAssumed = false;
  if (!currency && settings.assumeUsdWhenNoCurrency) {
    if (parsed.amountHigh <= settings.assumeUsdMaxAmount) {
      currency = 'USD';
      currencyAssumed = true;
    } else if (settings.assumePhpAboveCeiling) {
      currency = 'PHP';
      currencyAssumed = true;
    }
  }
  if (!currency) return parsed;

  // A gig is one piece of work for one fee. A bare "60.00" on a gig means $60
  // for the job, not $60 an hour - and the hourly reading turns it into $9,600
  // a month, which is both wrong and high enough to clear any threshold.
  //
  // Only when no period is stated: "Gig, $25/hour" says what it means.
  if (!parsed.period && context.jobType === 'gig') {
    return { ...parsed, currency, currencyAssumed, fixedFee: true };
  }

  let period = parsed.period;
  let periodAssumed = false;
  if (!period && settings.assumeMonthlyWhenUnstated) {
    const usd = toUsd(parsed.amountHigh, currency, settings);
    if (usd === null) return parsed;

    // One split point, two readings: too big to be an hourly rate means monthly,
    // too small to be a monthly salary means hourly.
    if (usd >= settings.assumeMonthlyMinUsd) {
      period = 'month';
      periodAssumed = true;

      // ...unless a month is impossible. "17000 USD" is not a monthly salary on
      // this site, but it is an ordinary annual one - and a year is the only
      // other period anyone writes an amount that size in. Without this the
      // figure is discarded entirely and the listing becomes invisible to the
      // filter; with it, $1,417/month is something you can actually judge.
      const yearly = usd / 12;
      if (
        settings.assumeYearlyWhenTooLarge &&
        usd > settings.assumedMaxUsdPerMonth &&
        yearly >= settings.assumeMonthlyMinUsd &&
        yearly <= settings.assumedMaxUsdPerMonth
      ) {
        period = 'year';
      }
    } else if (settings.assumeHourlyWhenSmall && usd <= settings.assumeHourlyMaxUsd) {
      period = 'hour';
      periodAssumed = true;
    }
    // Between the two - too small to be a month's pay, too large to be an hour
    // of it - nothing sensible can be assumed, so nothing is.
  }
  if (!period) return parsed;

  // A guess that lands on an implausible salary was the wrong guess. Better to
  // report nothing and leave the listing visible than to print a fantasy.
  if (currencyAssumed || periodAssumed) {
    const result =
      toUsd(parsed.amountHigh, currency, settings) *
      periodsPerMonth(period, settings, context.hoursPerWeek);
    if (!Number.isFinite(result) || result > settings.assumedMaxUsdPerMonth) return parsed;
  }

  return {
    ...parsed,
    currency,
    period,
    currencyAssumed,
    periodAssumed,
    confident: parsed.amountHigh > 0,
    reason: parsed.amountHigh > 0 ? null : 'non-positive',
  };
}

/**
 * @param {object} parsed result of parseRate()
 * @param {object} settings sanitized settings object
 * @returns {number|null} USD per month, or null when it cannot be computed
 */
export function toUsdPerMonth(parsed, settings) {
  if (!parsed || !parsed.currency || !parsed.period) return null;

  const amount =
    parsed.isRange && settings.rangeBasis === 'low'
      ? parsed.amountLow
      : parsed.amountHigh;

  const usd = toUsd(amount, parsed.currency, settings);
  if (usd === null) return null;

  const multiplier = periodsPerMonth(parsed.period, settings, parsed.hoursPerWeek);
  if (multiplier === null || !Number.isFinite(multiplier)) return null;

  const result = usd * multiplier;
  return Number.isFinite(result) ? result : null;
}

export function isSane(usdPerMonth) {
  return (
    typeof usdPerMonth === 'number' &&
    Number.isFinite(usdPerMonth) &&
    usdPerMonth >= SANE_MIN_USD_PER_MONTH &&
    usdPerMonth <= SANE_MAX_USD_PER_MONTH
  );
}

/**
 * Both ends of a range, in USD per month.
 *
 * toUsdPerMonth answers "the one figure the filter judges by"; this answers
 * "what the listing actually offers", which is what a badge should be free to
 * show. Null when either end cannot be resolved.
 */
export function toUsdPerMonthRange(parsed, settings) {
  if (!parsed || !parsed.currency || !parsed.period) return null;

  const multiplier = periodsPerMonth(parsed.period, settings, parsed.hoursPerWeek);
  if (multiplier === null || !Number.isFinite(multiplier)) return null;

  const low = toUsd(parsed.amountLow, parsed.currency, settings);
  const high = toUsd(parsed.amountHigh, parsed.currency, settings);
  if (low === null || high === null) return null;

  const result = { low: low * multiplier, high: high * multiplier };
  return Number.isFinite(result.low) && Number.isFinite(result.high) ? result : null;
}

export function formatUsd(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '';
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

export function formatUsdPerMonth(usdPerMonth) {
  if (typeof usdPerMonth !== 'number' || !Number.isFinite(usdPerMonth)) return '';
  return `${formatUsd(usdPerMonth)}/mo`;
}

/**
 * The figure a badge should print, given how you asked ranges to be shown.
 *
 * Separate from `rangeBasis`, which decides the end the *filter judges by*.
 * Wanting to be judged forgivingly on the high end while reading the whole
 * spread is a perfectly reasonable pair of preferences.
 *
 * A "range" that resolves to one number prints as one number - "$800–$800/mo"
 * is noise.
 */
export function formatRate(verdict, settings) {
  const mode = settings.rangeDisplay;
  const range = verdict.range;

  if (range && Math.round(range.low) !== Math.round(range.high)) {
    if (mode === 'range') return `${formatUsd(range.low)}–${formatUsdPerMonth(range.high)}`;
    if (mode === 'low') return formatUsdPerMonth(range.low);
    if (mode === 'high') return formatUsdPerMonth(range.high);
  }

  return formatUsdPerMonth(verdict.usdPerMonth);
}

/**
 * The single place that decides whether a listing may be hidden.
 *
 * A listing is hidden only when the parse was fully confident AND the resulting
 * number is sane AND it falls under the threshold. Every other path keeps the
 * listing visible, so a parser gap costs scrolling, never a missed job.
 *
 * @returns {{hide: boolean, usdPerMonth: number|null, reason: string}}
 */
export function decide(rawParsed, settings, context = {}) {
  if (!settings.enabled) {
    return { hide: false, usdPerMonth: null, assumed: false, reason: 'disabled' };
  }
  if (!rawParsed) {
    return { hide: false, usdPerMonth: null, assumed: false, reason: 'unparsed' };
  }

  // Set here rather than inside applyAssumptions, which returns early on
  // several paths - this way the listing's own hours survive all of them.
  const parsed = {
    ...applyAssumptions(rawParsed, settings, context),
    hoursPerWeek: Number.isFinite(context.hoursPerWeek) ? context.hoursPerWeek : null,
  };
  const assumed = Boolean(parsed.periodAssumed || parsed.currencyAssumed);

  // One fee for one piece of work. There is no monthly figure to compute, but
  // the fee itself is worth stating.
  if (parsed.fixedFee) {
    const fee = toUsd(parsed.amountHigh, parsed.currency, settings);
    return {
      hide: false,
      usdPerMonth: null,
      assumed,
      fixedFeeUsd: Number.isFinite(fee) ? fee : null,
      reason: 'fixed-fee',
    };
  }

  if (!parsed.confident) {
    return {
      hide: false,
      usdPerMonth: null,
      assumed,
      reason: parsed.reason ?? 'low-confidence',
    };
  }

  const usdPerMonth = toUsdPerMonth(parsed, settings);
  if (!isSane(usdPerMonth)) {
    return { hide: false, usdPerMonth, assumed, reason: 'out-of-range' };
  }

  const below = usdPerMonth < settings.thresholdUsdPerMonth;
  // A ceiling of zero means no ceiling; above it, the pay is more than you asked
  // to see. A ceiling at or below the floor would leave no band at all and hide
  // every priced listing, so it is ignored rather than obeyed - the floor still
  // stands, and the UI warns about the inverted pair.
  const rawMax = Number.isFinite(settings.maxUsdPerMonth) ? settings.maxUsdPerMonth : 0;
  const max = rawMax > settings.thresholdUsdPerMonth ? rawMax : 0;
  const above = max > 0 && usdPerMonth > max;
  return {
    hide: below || above,
    usdPerMonth,
    // Both ends, so a badge can show the spread without re-deriving it. The
    // hide decision above still rests on the single rangeBasis figure.
    range: parsed.isRange ? toUsdPerMonthRange(parsed, settings) : null,
    assumed,
    // What the listing states, so a caller can tell whether restating it in our
    // own words would add anything.
    currency: parsed.currency,
    period: parsed.period,
    // What the monthly figure was actually built on, so the badge can say
    // "$5/hr x 20 hrs/week" rather than leaving the reader to guess whether we
    // assumed full time.
    hoursPerWeek: parsed.hoursPerWeek ?? null,
    usdPerHour: usdPerMonth / hoursPerMonthFor(settings, parsed.hoursPerWeek),
    reason: below ? 'below-threshold' : above ? 'above-max' : 'above-threshold',
  };
}
