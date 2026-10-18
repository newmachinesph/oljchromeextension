/**
 * Every reason a listing can be hidden, in one pure place.
 *
 * The rate threshold is only one filter among several now. Keeping them together
 * means the control bar and the stub can always say exactly which rule fired,
 * and the whole set stays testable without a browser.
 */

import { decide } from './normalize.js';
import { findRedFlags } from './red-flags.js';
import { readRateIntent, RATE_INTENTS } from './rate-intent.js';
import { statusLabel } from './applications.js';
import { isNew } from './visits.js';
import { isBlocked } from './employer-book.js';
import { isDue } from './follow-ups.js';
import { judgeExperience, passesExperienceFilter } from './experience-level.js';
import { detectShift, isWrongShift } from './shift.js';

export const MS_PER_DAY = 86400000;

const JOB_TYPE_NAMES = {
  'full-time': 'Full Time',
  'part-time': 'Part Time',
  gig: 'Gig',
  any: 'Any',
};

/** Human wording for each reason, used on the collapsed stub. */
export const REASON_LABELS = {
  expired: () => 'no longer posted',
  applied: (facts, extra) => extra.statusLabel || 'applied',
  'not-new': () => 'seen before',
  'not-follow-up': () => 'not due',
  // The stub says which copy it is, so a collapsed row is self-explanatory
  // rather than an unexplained gap where a job used to be.
  'red-flag': (facts, extra) => extra.flag ?? 'flagged',
  repost: (facts, extra) =>
    extra.copies > 2 ? `1 of ${extra.copies} copies` : 'posted twice',
  dismissed: () => 'dismissed',
  viewed: () => 'already viewed',
  'blocked-employer': () => 'blocked employer',
  'job-type': (facts) => JOB_TYPE_NAMES[facts.jobType] ?? 'job type',
  shift: (facts, extra) => (extra.shift === 'night' ? 'night shift' : 'day shift'),
  experience: (facts, extra) =>
    extra.level === 'experienced' ? 'experienced' : 'not beginner-friendly',
  'too-old': (facts, extra) => `${extra.ageDays}d old`,
  keyword: (facts, extra) => `matched "${extra.keyword}"`,
  'not-in-search': () => 'not in search',
  'no-skill-match': () => 'no skill match',
  'no-rate': () => 'not stated',
  negotiable: () => 'negotiable',
  'unclear-rate': () => 'rate unclear',
  'above-max': () => 'over your max',
  'task-based': (facts, extra) =>
    extra.fixedFeeUsd !== null && extra.fixedFeeUsd !== undefined
      ? `$${Math.round(extra.fixedFeeUsd).toLocaleString('en-US')} fixed`
      : 'per-task rate',
};

function ageInDays(postedAt, now) {
  if (postedAt === null || postedAt === undefined) return null;
  return Math.floor((now - postedAt) / MS_PER_DAY);
}

function matchedKeyword(title, keywords) {
  const haystack = String(title ?? '').toLowerCase();
  return keywords.find((word) => word && haystack.includes(word.toLowerCase())) ?? null;
}

/**
 * Does the listing match at least one required term?
 *
 * Checked against the title and the skill chips on the card - all in the page,
 * so no dependency on the site's numeric skill IDs.
 */
/**
 * Does the listing match any search term?
 *
 * The site's own answer comes first. A card is an excerpt of the post, while
 * the site searches all of it: measured on jobkeyword=claude, thirty results
 * came back and not one card contained the word, so re-reading the card text
 * hid every hit and our box and the site's navbar disagreed completely.
 * `searchHit` is set on the listings that search returned, and it settles the
 * question - the server has already read the whole post.
 *
 * The text test remains for everything else on the page, and reads the whole
 * card rather than the title, because the site searches descriptions too - a
 * job titled "DevOps Specialist" is a legitimate hit for "engineer".
 */
function matchesSearch(facts, terms) {
  if (facts.searchHit) return true;
  const haystack = facts.searchText ?? String(facts.title ?? '').toLowerCase();
  return terms.some((term) => term && haystack.includes(term.toLowerCase()));
}

/**
 * Does this listing satisfy any of the required skills?
 *
 * Exported because the skills cloud has to COUNT with the very rule the filter
 * SELECTS with. It did not: the cloud tallied each listing's parsed skills
 * while this function also reads the title, so a job titled "Facebook Ads
 * Specialist" that never lists the skill passed the filter without being
 * counted. Measured on a live page the chip promised 22 and produced 23.
 *
 * A count that does not predict its own result is worse than no count. One
 * function with two callers is the only way they cannot drift apart again.
 */
export function matchesRequired(facts, required) {
  const haystack = [facts.title, ...(facts.skills ?? [])].join(' ').toLowerCase();
  return required.some((term) => term && haystack.includes(term.toLowerCase()));
}

/**
 * Decide the fate of one listing.
 *
 * Non-rate filters run first: they rest on facts the page states outright,
 * whereas the rate filter rests on a parse. The order also decides which reason
 * the user sees when more than one rule applies.
 *
 * @param {object} facts     {title, rateText, jobType, postedAt, jobKey}
 * @param {object} parsed    result of parseRate(), may be null
 * @param {object} settings  sanitized settings
 * @param {number} now       epoch ms
 * @param {Set<string>} dismissed job keys the user has already triaged
 * @returns {{hide: boolean, reason: string, usdPerMonth: number|null, assumed: boolean, extra: object}}
 */
export function evaluateListing({
  facts,
  parsed,
  settings,
  now,
  dismissed,
  expired,
  applications,
  newSince = null,
  reposts = null,
  book = null,
  viewed = null,
}) {
  // The job type informs the rate: a gig quoting a bare amount is quoting a
  // fee for the work, not a rate per hour.
  const verdict = decide(parsed, settings, {
    jobType: facts.jobType,
    // The listing's own stated hours beat any global assumption about them.
    hoursPerWeek: facts.hoursPerWeek,
  });
  const base = {
    usdPerMonth: verdict.usdPerMonth,
    // Both ends, and what the listing stated, carried through so a badge can
    // show the spread and judge whether restating it would add anything.
    range: verdict.range ?? null,
    currency: verdict.currency ?? null,
    period: verdict.period ?? null,
    assumed: verdict.assumed,
    fixedFeeUsd: verdict.fixedFeeUsd ?? null,
    // Hand-built rather than spread, so anything decide() gains has to be
    // added here too or it reaches the job page but not the list.
    hoursPerWeek: verdict.hoursPerWeek ?? null,
    usdPerHour: Number.isFinite(verdict.usdPerHour) ? verdict.usdPerHour : null,
    extra: {},
  };

  if (!settings.enabled) return { hide: false, reason: 'disabled', ...base };

  // Before everything, including your own decisions: a deleted post is not a
  // job you could take, so no other rule about it is worth evaluating.
  if (settings.hideExpired && facts.jobKey && expired?.has(facts.jobKey)) {
    return { hide: true, reason: 'expired', ...base };
  }

  // Then the one reason that is a decision you made by hand rather than
  // something we inferred.
  if (settings.hideDismissed && facts.jobKey && dismissed?.has(facts.jobKey)) {
    return { hide: true, reason: 'dismissed', ...base };
  }

  // Blocking an employer is the same kind of decision, applied to everything
  // they post. A listing with no employer named can never be blocked.
  if (settings.hideBlockedEmployers && isBlocked(book, facts.employer)) {
    return { hide: true, reason: 'blocked-employer', ...base };
  }

  // Applying is also a decision you made, but it is worth seeing rather than
  // hiding, so this one is off unless asked for.
  const application = facts.jobKey ? applications?.get(facts.jobKey) : null;
  if (settings.hideApplied && application) {
    return {
      hide: true,
      reason: 'applied',
      ...base,
      extra: { statusLabel: statusLabel(application.status) },
    };
  }

  // Having merely opened a job is the weakest of the "you've triaged this"
  // signals, so it sits below applied and dismissed: if either of those hid it
  // they said something more useful about why. Off unless asked for.
  if (settings.hideViewed && facts.jobKey && viewed?.has(facts.jobKey)) {
    return { hide: true, reason: 'viewed', ...base };
  }

  // Narrowing to what you have not seen is a statement about the whole list
  // rather than about this listing, so it sits with the other list-shaping
  // rules rather than among the rate ones.
  if (settings.onlyNew && !isNew(facts.postedAt, newSince)) {
    return { hide: true, reason: 'not-new', ...base };
  }

  // The same kind of narrowing: the list becomes the applications waiting on you.
  if (settings.onlyFollowUps && !isDue(application, now, settings.followUpDays)) {
    return { hide: true, reason: 'not-follow-up', ...base };
  }

  // Same shape of rule: this listing is redundant given the rest of the list,
  // rather than unsuitable in itself. The first copy is kept and stays subject
  // to every rule below, so collapsing a repost never smuggles a job past your
  // rate threshold.
  const repost = facts.jobKey ? reposts?.get(facts.jobKey) : null;
  if (settings.hideReposts && repost) {
    return { hide: true, reason: 'repost', ...base, extra: { copies: repost.size } };
  }

  // Off by default. A warning you can read and overrule is useful; a listing
  // removed without explanation teaches you nothing, and some of these are
  // worth taking with your eyes open.
  if (settings.hideRedFlagged) {
    const flags = findRedFlags(facts.searchText);
    if (flags.length > 0) {
      return { hide: true, reason: 'red-flag', ...base, extra: { flag: flags[0].label } };
    }
  }

  if (facts.jobType && settings.hiddenJobTypes.includes(facts.jobType)) {
    return { hide: true, reason: 'job-type', ...base };
  }

  // The shift you cannot take, when the post states one plainly.
  if (settings.shiftFilter && settings.shiftFilter !== 'any') {
    const shift = detectShift(facts.searchText);
    if (isWrongShift(settings.shiftFilter, shift)) {
      return { hide: true, reason: 'shift', ...base, extra: { shift } };
    }
  }

  // What the listing says about experience. Off unless asked for, and it only
  // ever hides on something the text states - "unclear" is hidden under the
  // strict setting because that setting asks for listings that say so.
  if (settings.experienceFilter && settings.experienceFilter !== 'all') {
    const { level } = judgeExperience(facts.title, facts.searchText);
    if (!passesExperienceFilter(level, settings.experienceFilter)) {
      return { hide: true, reason: 'experience', ...base, extra: { level } };
    }
  }

  const ageDays = ageInDays(facts.postedAt, now);
  if (settings.maxAgeDays > 0 && ageDays !== null && ageDays > settings.maxAgeDays) {
    return { hide: true, reason: 'too-old', ...base, extra: { ageDays } };
  }

  const keyword = matchedKeyword(facts.title, settings.excludeKeywords);
  if (keyword !== null) {
    return { hide: true, reason: 'keyword', ...base, extra: { keyword } };
  }

  // Search terms are a filter as well as a fetch. Without this the page's own
  // unrelated listings sit above the search results and it looks like the search
  // did nothing.
  if (settings.searchKeywords.length > 0 && !matchesSearch(facts, settings.searchKeywords)) {
    return { hide: true, reason: 'not-in-search', ...base };
  }

  if (settings.requiredSkills.length > 0 && !matchesRequired(facts, settings.requiredSkills)) {
    return { hide: true, reason: 'no-skill-match', ...base };
  }

  // Piecework outright ("$1-$5 per approved comment"), or a gig quoting one
  // figure - which is the fee for the whole job, not a rate per unit of time.
  if (parsed?.taskBased || verdict.reason === 'fixed-fee') {
    const feeUsd = base.fixedFeeUsd;
    const minFee = Number.isFinite(settings.minFixedFeeUsd) ? settings.minFixedFeeUsd : 0;
    // A gig minimum keeps gigs on the list but hides the ones whose readable fee
    // falls below it - "show gigs, but only worth-my-time ones". A gig with an
    // unreadable fee is left to hideTaskBased, not guessed at.
    const belowMin = minFee > 0 && Number.isFinite(feeUsd) && feeUsd < minFee;
    return {
      hide: settings.hideTaskBased || belowMin,
      reason: 'task-based',
      ...base,
      // Carried through so the collapsed stub can name the fee rather than
      // discarding the one number we did manage to read.
      extra: { fixedFeeUsd: base.fixedFeeUsd },
    };
  }

  // Whether the words themselves say anything, when the numbers do not.
  // "Based on Experience" is a different statement from "TBD": one says the
  // figure is yours to argue for, the other that there is no figure yet.
  const intent = readRateIntent(facts.rateText);
  const negotiable = intent === RATE_INTENTS.NEGOTIABLE;

  // No number anywhere: "TBD", "Negotiable", or an empty field.
  if (parsed === null) {
    return negotiable
      ? { hide: settings.hideNegotiable, reason: 'negotiable', ...base }
      : { hide: settings.hideNoRate, reason: 'no-rate', ...base };
  }

  // A rate is stated but we could not turn it into a monthly figure.
  if (verdict.usdPerMonth === null) {
    // "50,000 negotiable" that would not resolve is still better described by
    // what the employer wrote than by our failure to read it.
    return negotiable
      ? { hide: settings.hideNegotiable, reason: 'negotiable', ...base }
      : { hide: settings.hideUnclearRate, reason: 'unclear-rate', ...base };
  }

  return { hide: verdict.hide, reason: verdict.reason, ...base };
}

/** Wording for the collapsed stub, e.g. "Part Time" or "14d old". */
export function reasonLabel(reason, facts, extra) {
  const build = REASON_LABELS[reason];
  return build ? build(facts, extra ?? {}) : '';
}
