/**
 * Settings: defaults, validation, and a thin chrome.storage.sync wrapper.
 *
 * Shared verbatim by the content script and the React options page, so the two
 * can never disagree about what a default is.
 */

import { isSortMode } from './sort.js';
import { isExperienceFilter } from './experience-level.js';
import { isAlertInterval } from './alerts.js';
import { sanitizeRules } from './custom-rules.js';
import { DEFAULT_VOCABULARY, sanitizeVocabulary } from './vocabulary.js';

export const DEFAULTS = Object.freeze({
  enabled: true,

  /** Hide listings worth less than this, in USD per month. */
  thresholdUsdPerMonth: 500,

  /**
   * Hide listings worth more than this, in USD per month. Zero means no
   * ceiling - the common case. A max is for narrowing to a band you actually
   * want, not for hiding good pay; most people leave it off.
   */
  maxUsdPerMonth: 0,

  /**
   * The smallest one-off gig / fixed fee worth showing, in USD. Zero means show
   * every gig - the default. Above zero, a gig whose fee you can read but which
   * pays less is hidden, the same way the monthly floor works for salaried jobs.
   * A gig whose fee cannot be read is governed by `hideNoRate`, not this.
   */
  minFixedFeeUsd: 0,

  /**
   * Hide the shift you cannot take. 'any' filters nothing; 'day' hides posts
   * that clearly ask for night work, 'night' hides clear day-work posts. A post
   * that never states a shift is never hidden - guessing would bury good jobs.
   */
  shiftFilter: 'any',

  /** Philippine pesos per 1 USD. Manual on purpose - no network, no API to rot. */
  fxPhpPerUsd: 62.2,

  /** Australian dollars per 1 USD. Some employers post in AUD ("$10 AUD/Hour"). */
  fxAudPerUsd: 1.39,

  /**
   * The rest, in descending order of how often they turn up. A live sweep of
   * 1,403 distinct rate strings found 14 Canadian, 4 British and 3 euro - few,
   * but "CAD $900" written with a dollar sign was being read as US dollars,
   * which overstated the pay by about a third rather than merely missing it.
   *
   * Manual like the others: no network call, nothing to rot.
   */
  fxCadPerUsd: 1.38,
  fxGbpPerUsd: 0.73,
  fxEurPerUsd: 0.86,
  /*
   * Units per USD, all editable. Starting points, not a live feed - the
   * extension never calls out for a rate, so these drift and are meant to be
   * corrected. Checked against market rates on 2026-08-29. AED and HKD are
   * pegged and will not move.
   */
  fxNzdPerUsd: 1.67,
  fxAedPerUsd: 3.67,
  fxSgdPerUsd: 1.27,
  fxJpyPerUsd: 159,
  fxKrwPerUsd: 1385,
  fxHkdPerUsd: 7.84,
  fxNokPerUsd: 9.3,
  fxThbPerUsd: 32.6,

  /** Billable hours in a month, used to turn an hourly rate into a monthly one. */
  hoursPerMonth: 160,

  /** Working days in a month, for daily rates. */
  daysPerMonth: 22,

  /**
   * Which end of a range like "$300-$500/month" the hide decision uses.
   * 'high' is the forgiving choice: a job that might clear the bar stays visible.
   */
  rangeBasis: 'high',

  /**
   * What the badge prints for a range: 'high' | 'low' | 'range'.
   *
   * Separate from rangeBasis above, which decides the end the filter judges by.
   * Wanting to be judged forgivingly on the high end while still reading the
   * whole spread is a reasonable pair of preferences, so they are two settings.
   */
  rangeDisplay: 'high',

  /**
   * Many listings give an amount with no pay period ("$600", "USD 450 - 500").
   * When enabled, those are read as monthly - but only above the floor below,
   * where an hourly reading would be absurd. Under it, they stay visible.
   */
  assumeMonthlyWhenUnstated: true,

  /**
   * The split point between the two readings of a bare amount, in USD.
   * At or above it the figure is monthly; below it, hourly. $600/hour would be
   * $96,000 a month and $5/month is nobody's salary, so one number separates them.
   */
  assumeMonthlyMinUsd: 100,

  /** Read an amount below that split point as an hourly rate. */
  assumeHourlyWhenSmall: true,

  /**
   * When a monthly reading lands past the plausibility ceiling, try a year
   * before giving up.
   *
   * "17000 USD" with no period is not a monthly salary here - but it is an
   * ordinary annual one, and a year is the only other period anyone writes an
   * amount that size in. Off, such a listing resolves to nothing at all and is
   * invisible to the filter; on, it reads as ~$1,417/month.
   */
  assumeYearlyWhenTooLarge: true,

  /**
   * The most an hourly rate may be *assumed* to be, in USD.
   *
   * The platform caps applicants at $30/hour, so an assumed hourly rate above
   * that is impossible rather than merely unlikely - "60.00" read as hourly
   * claimed $9,600 a month. Above this the amount is left unresolved, and the
   * listing therefore stays visible.
   *
   * Applies only to the assumption. A rate the employer states outright is
   * their own word and is taken at face value.
   */
  assumeHourlyMaxUsd: 30,

  /** With no currency marker at all, read the figure as US dollars. */
  assumeUsdWhenNoCurrency: true,

  /**
   * Above this, a figure with no currency marker is read as pesos instead.
   * Nobody advertises $42,000 a month here, and "42,000" is the single most
   * common bare amount on the site.
   */
  assumeUsdMaxAmount: 10000,

  /** Read a bare amount above that ceiling as pesos rather than leaving it unread. */
  assumePhpAboveCeiling: true,

  /**
   * Discard any assumption that produces a salary larger than this. It means we
   * guessed wrong - "$80 USD" read as hourly would be $12,800 a month.
   */
  assumedMaxUsdPerMonth: 10000,

  /** Hide listings that state no rate at all ("TBD", "TBA", empty). */
  hideNoRate: false,

  /**
   * Hide listings whose rate is open rather than absent - "Negotiable", "DOE",
   * "Based on Experience", "Commensurate with experience".
   *
   * Separate from hideNoRate on purpose: these are the ones where the figure
   * could land high, so wanting to skip every silent listing while keeping
   * every negotiable one is a reasonable way to hunt.
   */
  hideNegotiable: false,

  /** Hide listings that state something we could not turn into a monthly figure. */
  hideUnclearRate: false,

  /** Hide piecework ("$1-$5 per approved comment", "$150 fixed price"). */
  hideTaskBased: false,

  /** Job types to hide, from 'full-time' | 'part-time' | 'gig' | 'any'. */
  hiddenJobTypes: [],

  /** Hide listings older than this many days. 0 disables the check. */
  maxAgeDays: 0,

  /** Hide listings whose title contains any of these (case-insensitive). */
  excludeKeywords: [],

  /**
   * Keep only listings matching one of these, checked against the title and the
   * skill chips on the card. Empty means no such restriction.
   *
   * Matched entirely in the page: the site's own skill filter is keyed by numeric
   * skill IDs, so this avoids depending on them.
   */
  requiredSkills: [],

  /**
   * Collapse listings you have dismissed. On by default - the whole point of
   * dismissing one is not seeing it again - but switchable, so you can go back
   * and look at what you rejected.
   */
  hideDismissed: true,

  /**
   * Collapse jobs the site has deleted.
   *
   * Discovered by opening one - the site answers 410 with "Job No Longer
   * Posted". Unlike a dismissal there is nothing to undo, so this is on by
   * default and the stub says why rather than offering to restore it.
   */
  hideExpired: true,

  /**
   * Collapse jobs you have already applied to.
   *
   * Off by default: seeing that you applied is usually the point, and the chip
   * on the card says so without taking the listing away. On, it turns the list
   * into "what is left to do".
   */
  hideApplied: false,

  /**
   * Hide jobs you have already opened. Off by default: a job you looked at is
   * not a job you dealt with, and hiding it on sight can bury one you meant to
   * come back to. On, it pares a daily scan down to only what is genuinely new.
   */
  hideViewed: false,

  /**
   * Show only listings posted since you were last here.
   *
   * Off by default - the first thing you want on a fresh install is the whole
   * board. On, it turns a merged list of three hundred into the handful you
   * have not already read.
   */
  onlyNew: false,

  /** Mark listings posted since your last visit with a NEW chip. */
  showNewChip: true,

  /**
   * Compare each rate against what you have already seen for that skill.
   *
   * Built only from listings that passed through the parser on pages you loaded
   * anyway - counts per bucket, never a log of individual jobs.
   */
  showBenchmark: true,
  hideReposts: true,
  showRedFlags: true,
  highlightTerms: true,
  showStaleness: true,
  hideRedFlagged: false,
  showEmployerChip: true,

  /** Collapse every listing from an employer you blocked. */
  hideBlockedEmployers: true,

  /**
   * You have seen, once, what pressing "Draft application" sends and what it
   * costs, and asked not to be told again.
   */
  draftConsent: false,

  /** How a draft should read: 'plain' | 'warm' | 'formal'. Remembered. */
  draftTone: 'plain',

  /** The profile last used to draft, so the picker can default to it. */
  draftProfileId: '',

  /**
   * The subject line when the employer did not demand one. Placeholders:
   * {jobTitle} {employer} {name} {profileLabel} {profileHeadline}.
   */
  draftSubjectPattern: 'Application: {jobTitle} — {name}',

  /**
   * The master switch for everything we inject on the site. On, the content
   * script runs and adds our UI; off, it bails at the bootstrap and the page is
   * left exactly as the site built it - nothing of ours loads. Toggled from the
   * toolbar popup; flipping it reloads the open OnlineJobs.ph tabs so it takes
   * effect both ways without a manual refresh.
   */
  injectionEnabled: true,

  /**
   * On an individual job page, draw one strip of ours under the site's facts
   * card - the converted rate, the experience level, concerns, the application
   * status and the dismiss control. Off, the job page is left exactly as the
   * site built it.
   */
  jobPageBar: true,

  /**
   * Render the markdown employers paste into a description as structure.
   *
   * Plenty of them write "## Requirements" and "- must have"; the site shows
   * the punctuation and none of the structure. On, the modal lays those out as
   * headings and lists. Descriptions with no markdown in them are untouched, so
   * this can only ever help - see markdown-lite.js.
   */
  formatDescription: true,

  /**
   * While a results tab is open, re-read the first page on a timer and put
   * anything new at the top.
   *
   * Unlike alerts this only ever runs with the tab open and in front, which is
   * ordinary browsing traffic rather than background fetching - so it needs no
   * extra permission and is on by default. One page per tick, serialised
   * against everything else by the fetch gate in prefetch.js.
   */
  autoRefresh: true,

  /** Minutes between checks. One of REFRESH_INTERVALS. */
  autoRefreshMinutes: 3,

  /**
   * Re-run saved searches on a timer and count new listings. Off by default:
   * it is the one feature that fetches while no tab is open, and turning it on
   * asks the browser for the permissions that needs.
   */
  alertsEnabled: false,

  /** Minutes between checks. One of ALERT_INTERVALS. */
  alertIntervalMinutes: 180,

  /**
   * Days an application may sit unanswered before it is due a follow-up.
   * Counted from your last follow-up when there was one.
   */
  followUpDays: 7,

  /** Mark a card whose application is due a follow-up. */
  showFollowUpChip: true,

  /**
   * Show only the listings whose application is due a follow-up. A view, not a
   * preference: like onlyNew it is off by default and not saved into searches.
   */
  onlyFollowUps: false,

  /**
   * Say on the card whether a listing reads as beginner-friendly or as wanting
   * experience. Listings that say neither get no chip at all.
   */
  showExperienceChip: true,

  /**
   * 'all' | 'beginner' | 'not-experienced'.
   *
   * Off by default, like every filter except the rate. 'beginner' keeps only
   * listings that say they welcome beginners; 'not-experienced' hides only the
   * ones that state a requirement, and keeps the ones that say nothing.
   */
  experienceFilter: 'all',

  /**
   * Display order: 'site' | 'rate-desc' | 'rate-asc' | 'newest'.
   *
   * Defaults to the site's own order, which is roughly newest-first. That
   * matters when you are checking back daily, so re-ranking by pay is offered
   * rather than imposed.
   */
  sortBy: 'site',

  /**
   * What becomes of a listing the filter hides.
   *
   * 'top' or 'bottom' gathers the stubs into one block so the listings you can
   * still consider are contiguous; 'inline' leaves each stub where its listing
   * sat; 'off' removes them with no stub at all.
   *
   * One setting rather than a switch plus a position, because "not shown, at
   * the top" is not a thing anyone can mean.
   */
  groupHiddenAt: 'top',

  /**
   * How many further result pages to pull in and merge on load. 0 disables it.
   *
   * The site shows 30 at a time; with a strict filter that can leave two or
   * three worth reading. Merging pages makes one long list to filter instead.
   *
   * One is the default: every saved-search term is its own site search, so
   * terms multiply pages (four terms over three pages is twelve requests) and a
   * preset can carry several terms. Pages load strictly one at a time either
   * way (see FETCH_CONCURRENCY). Capped at five so a load never fans out into
   * too many requests.
   */
  prefetchPages: 1,

  /**
   * Extra searches to run and merge, as keywords.
   *
   * The site searches one phrase at a time, so "engineer", "full stack",
   * "developer" and "fullstack" mean four searches and four sets of results to
   * eyeball. Listed here they are fetched together and combined into one
   * deduplicated list.
   */
  searchKeywords: [],

  /**
   * Rate formats you have taught the extension yourself.
   *
   * The built-in parser is calibrated against a live corpus, but the site has
   * no house style and employers keep inventing wording. Each rule is a regular
   * expression plus what it means, tried before the built-in parser - so a rule
   * can both read a format we cannot and override one we read wrongly.
   *
   * See src/core/custom-rules.js for the shape and the bounds.
   */
  customRules: [],

  /**
   * The words the built-in parser recognises, as editable lists.
   *
   * Seeded with everything it ships with, so the options page can show the
   * whole vocabulary rather than hiding it in the source - add "fortnightly",
   * or a currency word the site starts using, without waiting for a release.
   */
  vocabulary: DEFAULT_VOCABULARY,

  /** Show a small normalised "= $520/mo" badge on each listing. */
  showBadges: true,

  /**
   * Hide the site's own rate line. Our badge already states the rate in one
   * comparable unit, so the original is duplication.
   */
  hideOriginalRate: true,

  /** Show each listing's description excerpt. Off makes the results list compact. */
  showDescription: true,

  /**
   * Let the results area use the full window instead of the site's fixed
   * container width, which wastes most of a wide screen.
   */
  wideLayout: true,

  /** Width of the sidebar column, in pixels. The site allots it 25%. */
  sidebarWidth: 380,

  /**
   * Hide the site's own search bar at the top of the results.
   * Our search row does the same job and can hold several terms at once.
   */
  hideSiteSearch: true,
});

/**
 * How often the results page may re-check for new listings.
 *
 * Data lives here rather than beside the scheduler in content/auto-refresh.js
 * because the options page needs it too, the same way ALERT_INTERVALS sits in
 * core/alerts.js. The bounds are mirrored in LIMITS.autoRefreshMinutes.
 */
export const REFRESH_INTERVALS = Object.freeze([
  { value: 1, label: 'Every minute' },
  { value: 3, label: 'Every 3 minutes' },
  { value: 5, label: 'Every 5 minutes' },
  { value: 10, label: 'Every 10 minutes' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
]);

export function isRefreshInterval(value) {
  return REFRESH_INTERVALS.some((entry) => entry.value === Number(value));
}

export const GROUP_POSITIONS = Object.freeze([
  { value: 'top', label: 'Gathered at the top' },
  { value: 'bottom', label: 'Gathered at the bottom' },
  { value: 'inline', label: 'Left in place' },
  { value: 'off', label: 'Not shown at all' },
]);

/** Job types the site actually uses, for validation and for the options UI. */
/**
 * The four types the site uses, labelled exactly as its own chips are so a pill
 * maps to what you see on the card. "Any" is a real category - the employer
 * stated no arrangement - hence the hint, since as a bare filter label it could
 * be misread as "show anything".
 */
/** Ordered as the site presents them, which is also commonest first. */
export const JOB_TYPES = Object.freeze([
  { value: 'full-time', label: 'Full Time' },
  { value: 'part-time', label: 'Part Time' },
  { value: 'any', label: 'Any', hint: 'no arrangement stated' },
  { value: 'gig', label: 'Gig' },
]);

const VALID_JOB_TYPES = JOB_TYPES.map((type) => type.value);

/** Bounds that keep a typo in the options page from silently breaking the filter. */
const LIMITS = {
  // Matches MIN/MAX_INTERVAL_MINUTES in auto-refresh.js. Below a minute the
  // polling costs more than the browsing it is meant to save.
  autoRefreshMinutes: [1, 60],
  thresholdUsdPerMonth: [0, 100000],
  maxUsdPerMonth: [0, 1000000],
  minFixedFeeUsd: [0, 1000000],
  fxPhpPerUsd: [1, 1000],
  fxAudPerUsd: [1, 100],
  // Sterling and the euro are worth more than a dollar, so unlike the others
  // their rate is below 1 - the floor has to allow for that.
  fxCadPerUsd: [0.01, 100],
  fxGbpPerUsd: [0.01, 100],
  fxEurPerUsd: [0.01, 100],
  fxNzdPerUsd: [0.01, 100],
  fxAedPerUsd: [0.01, 100],
  fxSgdPerUsd: [0.01, 100],
  fxHkdPerUsd: [0.01, 100],
  fxNokPerUsd: [0.01, 100],
  fxThbPerUsd: [0.01, 1000],
  // Yen and won are quoted in the hundreds and thousands, so they need their
  // own ceilings rather than the shared one.
  fxJpyPerUsd: [1, 100000],
  fxKrwPerUsd: [1, 1000000],
  hoursPerMonth: [1, 744],
  daysPerMonth: [1, 31],
  assumeMonthlyMinUsd: [1, 100000],
  assumeHourlyMaxUsd: [1, 10000],
  assumeUsdMaxAmount: [1, 100000000],
  assumedMaxUsdPerMonth: [100, 1000000],
  maxAgeDays: [0, 3650],
  followUpDays: [1, 60],
  prefetchPages: [0, 5],
  sidebarWidth: [220, 640],
};

/** Keep the keyword list sane: trimmed, de-duplicated, bounded. */
const MAX_KEYWORDS = 40;
const MAX_KEYWORD_LENGTH = 60;

function sanitizeKeywords(value) {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .map((entry) => String(entry ?? '').trim())
    .filter((entry) => entry.length > 0 && entry.length <= MAX_KEYWORD_LENGTH);
  return [...new Set(cleaned)].slice(0, MAX_KEYWORDS);
}

function sanitizeJobTypes(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry) => VALID_JOB_TYPES.includes(entry)))];
}

const STORAGE_KEY = 'ojRateFilter';

function clampNumber(key, value) {
  const bounds = LIMITS[key];
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULTS[key];
  if (!bounds) return numeric;
  return Math.min(Math.max(numeric, bounds[0]), bounds[1]);
}

/**
 * Coerce anything that came out of storage (or a form field) into a settings
 * object that every downstream module can trust.
 */
export function sanitize(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  // Fresh array copies: DEFAULTS is frozen but its arrays are not, and callers
  // must never be handed a reference that could mutate the defaults.
  const result = {
    ...DEFAULTS,
    hiddenJobTypes: [...DEFAULTS.hiddenJobTypes],
    excludeKeywords: [...DEFAULTS.excludeKeywords],
    searchKeywords: [...DEFAULTS.searchKeywords],
    requiredSkills: [...DEFAULTS.requiredSkills],
    customRules: [...DEFAULTS.customRules],
    vocabulary: sanitizeVocabulary(DEFAULTS.vocabulary),
  };

  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in input)) continue;
    const value = input[key];

    if (key === 'hiddenJobTypes') {
      result[key] = sanitizeJobTypes(value);
    } else if (key === 'customRules') {
      result[key] = sanitizeRules(value);
    } else if (key === 'vocabulary') {
      result[key] = sanitizeVocabulary(value);
    } else if (
      key === 'excludeKeywords' ||
      key === 'searchKeywords' ||
      key === 'requiredSkills'
    ) {
      result[key] = sanitizeKeywords(value);
    } else if (typeof DEFAULTS[key] === 'boolean') {
      result[key] = Boolean(value);
    } else if (typeof DEFAULTS[key] === 'number') {
      result[key] = clampNumber(key, value);
    } else if (key === 'rangeBasis') {
      result[key] = value === 'low' ? 'low' : 'high';
    } else if (key === 'rangeDisplay') {
      result[key] = ['high', 'low', 'range'].includes(value) ? value : DEFAULTS[key];
    } else if (key === 'sortBy') {
      result[key] = isSortMode(value) ? value : DEFAULTS[key];
    } else if (key === 'draftTone') {
      result[key] = ['plain', 'warm', 'formal'].includes(value) ? value : DEFAULTS[key];
    } else if (key === 'draftProfileId') {
      result[key] = String(value ?? '').slice(0, 40);
    } else if (key === 'draftSubjectPattern') {
      result[key] = String(value ?? '').slice(0, 120);
    } else if (key === 'alertIntervalMinutes') {
      result[key] = isAlertInterval(Number(value)) ? Number(value) : DEFAULTS[key];
    } else if (key === 'experienceFilter') {
      result[key] = isExperienceFilter(value) ? value : DEFAULTS[key];
    } else if (key === 'groupHiddenAt') {
      result[key] = ['top', 'bottom', 'inline', 'off'].includes(value) ? value : DEFAULTS[key];
    } else if (key === 'shiftFilter') {
      result[key] = ['any', 'day', 'night'].includes(value) ? value : DEFAULTS[key];
    }
  }

  return result;
}

export async function loadSettings() {
  if (typeof chrome === 'undefined' || !chrome.storage?.sync) return { ...DEFAULTS };
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return sanitize(stored?.[STORAGE_KEY]);
}

export async function saveSettings(partial) {
  const current = await loadSettings();
  const next = sanitize({ ...current, ...partial });
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
  return next;
}

/**
 * Replace every setting at once.
 *
 * saveSettings merges a patch, which is right for editing and wrong for
 * restoring: a backup taken before a setting existed should leave that setting
 * at its default, not at whatever this profile happens to hold.
 */
export async function replaceSettings(next) {
  const clean = sanitize(next);
  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    await chrome.storage.sync.set({ [STORAGE_KEY]: clean });
  }
  return clean;
}

export async function resetSettings() {
  await chrome.storage.sync.set({ [STORAGE_KEY]: { ...DEFAULTS } });
  return { ...DEFAULTS };
}

/**
 * Subscribe to changes made anywhere (options page, other tabs, the injected bar).
 * Returns an unsubscribe function.
 */
export function onSettingsChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};

  const listener = (changes, area) => {
    if (area !== 'sync' || !changes[STORAGE_KEY]) return;
    callback(sanitize(changes[STORAGE_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
