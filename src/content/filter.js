/**
 * Orchestrator: find listings once, parse each rate once, then re-decide
 * cheaply every time a setting changes.
 *
 * Parsing is the expensive part and never depends on settings, so dragging the
 * threshold only re-runs the decision over cached numbers.
 */

import { readRate, rulesSignature } from '../core/custom-rules.js';
import { vocabularySignature } from '../core/vocabulary.js';
import { formatUsdPerMonth, formatUsd, formatRate } from '../core/normalize.js';
import { evaluateListing, matchesRequired, reasonLabel } from '../core/criteria.js';
import { findListings, findResultsContainer } from './find-listings.js';
import {
  collapse,
  expand,
  restoreAll,
  configureGrouping,
  setGroupHeading,
  setPartHidden,
} from './collapse.js';
import { renderMeta, clearMeta } from './meta-row.js';
import { sortEntries } from '../core/sort.js';
import { JOB_TYPES } from '../core/settings.js';
import { isNew } from '../core/visits.js';
import { rateStanding, describeStanding, standingTone } from '../core/benchmark.js';
import { employerCounts, findReposts, describeEmployer } from '../core/employers.js';
import { memoryFor, noteFor } from '../core/employer-book.js';
import { isDue, dueFollowUps } from '../core/follow-ups.js';
import { findRedFlags } from '../core/red-flags.js';
import { gatherConcerns, describeConcerns, explainConcerns } from '../core/concerns.js';
import { judgeExperience, describeLevel } from '../core/experience-level.js';
import { applyHighlights, clearHighlights, highlightTerms } from './highlight.js';
import { weeksAdvertised, describeStaleness } from '../core/history.js';

const JOB_TYPE_LABELS = Object.fromEntries(JOB_TYPES.map((type) => [type.value, type.label]));
import { applyOrder, clearOrder } from './order.js';

/**
 * @param {object} [hooks]
 * @param {Function} [hooks.onDismiss] called with (listing, dismissed) when the
 *   user triages a listing by hand. Absent means no dismiss controls are drawn.
 */
export function createFilter({ onDismiss, onSave, isSaved } = {}) {
  let records = [];
  let source = 'none';
  let scanWarning = null;
  /**
   * The custom rules the cached parses were produced with.
   *
   * Parsing is the expensive half and normally settings-independent, so it runs
   * once per scan. Custom rules are the one setting that changes its outcome,
   * so they are tracked and the parses redone only when they actually move.
   */
  let parsedWithRules = null;
  /** element -> the monthly figure the last pass settled on, for exporting. */
  const exported = new Map();

  function parseAll(rules, vocabulary) {
    for (const record of records) {
      try {
        record.parsed = readRate(record.rateText, rules, vocabulary);
      } catch {
        record.parsed = null; // A parser crash must not cost the user a listing.
      }
    }
    parsedWithRules = rulesSignature(rules) + vocabularySignature(vocabulary);
  }

  /** Read the page and parse every rate. Safe to call again after navigation. */
  function scan(root = document, rules = [], vocabulary = undefined) {
    const result = findListings(root);
    source = result.source;
    scanWarning = result.warning;

    records = result.listings.map((listing) => ({ ...listing, parsed: null }));
    parseAll(rules, vocabulary);

    return records.length;
  }

  /** How the rate chip should read, and in which tone. */
  function rateChip(listing, verdict, settings) {
    if (verdict.reason === 'task-based') {
      // A gig quoting one figure is quoting the fee for the work. Stating it
      // beats "per-task", which throws away the number we did read.
      return {
        rate: verdict.fixedFeeUsd !== null ? `${formatUsd(verdict.fixedFeeUsd)} fixed` : 'per-task',
        tone: 'task',
      };
    }
    if (verdict.usdPerMonth !== null) {
      // "~" flags a rate we resolved by assumption rather than read outright.
      return {
        rate: `${verdict.assumed ? '~' : ''}${formatRate(verdict, settings)}`,
        tone: verdict.assumed ? 'assumed' : 'ok',
      };
    }
    // Open rather than absent. Its own tone and a two-way arrow, because the
    // useful thing to know is that the figure is still in play.
    if (verdict.reason === 'negotiable') {
      return { rate: 'negotiable', tone: 'open', icon: 'swing' };
    }
    if (verdict.reason === 'no-rate') return { rate: 'not stated', tone: 'unknown' };

    return { rate: 'rate unclear', tone: 'unknown' };
  }

  /** What to print on the stub of a collapsed listing. */
  /**
   * What each card was last painted with.
   *
   * A merged page runs to well over a thousand cards carrying four thousand
   * chips, and every render used to rebuild all of them. Dismissing one listing
   * repainted the other 1,423 identically, which is where the pauses came from.
   *
   * Keyed weakly so a card removed from the page takes its entry with it.
   */
  const painted = new WeakMap();

  /** "follow up · 9d" when the application has waited long enough. */
  function followUpChip(listing, applications, now, settings) {
    if (!settings.showFollowUpChip || !listing.jobKey) return '';
    const application = applications.get(listing.jobKey);
    if (!isDue(application, now, settings.followUpDays)) return '';
    const [entry] = dueFollowUps(new Map([[listing.jobKey, application]]), now, settings.followUpDays);
    return entry ? `follow up · ${entry.daysWaiting}d` : '';
  }

  function stubLabel(listing, verdict) {
    if (verdict.reason === 'below-threshold') return formatUsdPerMonth(verdict.usdPerMonth);
    return reasonLabel(verdict.reason, listing, verdict.extra);
  }

  /**
   * Apply the current settings to every listing.
   * @returns {{total: number, hidden: number, unparsed: number, assumed: number,
   *   byReason: Record<string, number>, source: string, warning: string|null}}
   */
  function apply(
    settings,
    dismissed = new Set(),
    expired = new Set(),
    applications = new Map(),
    newSince = null,
    stats = null,
    history = null,
    book = null,
    viewed = new Set(),
  ) {
    // Editing a rule in the options page must re-read every listing, not just
    // re-decide the numbers we already have.
    if (
      rulesSignature(settings.customRules) + vocabularySignature(settings.vocabulary) !==
      parsedWithRules
    ) {
      parseAll(settings.customRules, settings.vocabulary);
    }

    const now = Date.now();
    const byReason = {};
    /** Listings eligible for the cloud tally, counted once the loop ends. */
    const countable = [];
    /** One entry per listing, in page order, for the sort to rank. */
    const ordering = [];
    exported.clear();
    /** Rates this pass resolved, for the benchmark to learn from. */
    const samples = [];
    // Computed once over the whole list rather than per listing: both answer a
    // question about the page, and on a merged page of several hundred cards
    // doing it per listing would be quadratic.
    const employers = employerCounts(records);
    const reposts = settings.hideReposts ? findReposts(records) : null;
    let hidden = 0;
    let unparsed = 0;
    let assumed = 0;

    const container = findResultsContainer(records);

    // Ours, toggled rather than set, so switching the filter off takes it back
    // with everything else and the site's own spacing returns untouched.
    container?.classList.toggle('ojrf-results-padded', Boolean(settings.enabled));

    configureGrouping({
      container,
      position: settings.enabled ? settings.groupHiddenAt : 'inline',
    });

    for (const listing of records) {
      try {
        const verdict = evaluateListing({
          facts: listing,
          parsed: listing.parsed,
          settings,
          now,
          dismissed,
          expired,
          applications,
          newSince,
          reposts,
          book,
          viewed,
        });

        ordering.push({
          element: listing.element,
          usdPerMonth: verdict.usdPerMonth,
          postedAt: listing.postedAt,
        });
        exported.set(listing.element, verdict.usdPerMonth);
        if (verdict.usdPerMonth !== null && !verdict.assumed) {
          // Only rates read outright. An assumed figure would teach the
          // benchmark our own guesswork and then be measured against it.
          samples.push({ usdPerMonth: verdict.usdPerMonth, skills: listing.skills ?? [] });
        }

        // Judge on the verdict, not the raw parse: a rate we resolved by
        // assuming the period is understood, not unreadable.
        if (verdict.usdPerMonth === null) unparsed += 1;
        else if (verdict.assumed) assumed += 1;

        // Counted before the hide decision, and excluding the skill rule itself,
        // so the cloud shows what you could still narrow to rather than only
        // what survived the current narrowing.
        //
        // Only the candidates are gathered here; the tally itself is computed
        // after the loop, because counting with the filter's own rule needs the
        // whole vocabulary and that is not known until every listing is seen.
        if (verdict.reason !== 'not-in-search') {
          countable.push(listing);
        }

        // Tallies are counted every pass regardless of whether anything is
        // repainted: they describe the list, and the bar must stay correct even
        // when no card needed touching.
        if (verdict.hide) {
          hidden += 1;
          byReason[verdict.reason] = (byReason[verdict.reason] ?? 0) + 1;
        }

        const stub = verdict.hide ? stubLabel(listing, verdict) : '';
        const flags = settings.showRedFlags ? findRedFlags(listing.searchText) : [];
        const showMeta = settings.showBadges && settings.enabled;
        const standing =
          showMeta && settings.showBenchmark && verdict.usdPerMonth !== null
            ? rateStanding(stats, verdict.usdPerMonth, listing.skills ?? [])
            : null;

        // One list, so the card shows one chip and the tooltip says the rest.
        // Each source is still gated by its own setting, so switching staleness
        // off takes it out of the roll-up rather than out of a chip of its own.
        const concerns = showMeta
          ? gatherConcerns({
              flags: settings.showRedFlags ? flags : [],
              staleness: settings.showStaleness
                ? describeStaleness(weeksAdvertised(history, listing, now))
                : '',
              standingTone: standingTone(standing),
              employerMemory: memoryFor(book, listing.employer),
            })
          : [];

        // Read off the card's excerpt; the modal re-reads the full description.
        const level =
          showMeta && settings.showExperienceChip
            ? judgeExperience(listing.title, listing.searchText)
            : null;

        // Kept on the record so the modal can say whether the full description
        // agrees with what the card showed.
        listing.level = level?.level ?? null;

        const meta = showMeta
          ? {
              ...rateChip(listing, verdict, settings),
              standing: standing ? describeStanding(standing) : '',
              standingTone: standingTone(standing),
              jobType: listing.jobType,
              postedAt: listing.postedAt,
              application: listing.jobKey ? applications.get(listing.jobKey) : undefined,
              isNew: settings.showNewChip && isNew(listing.postedAt, newSince),
              employer: settings.showEmployerChip
                ? describeEmployer(employers.get(listing.jobKey))
                : '',
              hoursPerWeek: verdict.hoursPerWeek ?? null,
              usdPerHour: verdict.usdPerHour ?? null,
              concerns: describeConcerns(concerns),
              concernsWhy: explainConcerns(concerns),
              note: noteFor(book, listing.employer),
              followUp: followUpChip(listing, applications, now, settings),
              level: level ? describeLevel(level.level) : '',
              levelTone: level?.level ?? '',
              levelWhy: level?.why ?? '',
            }
          : null;

        // `now` is deliberately absent from the signature. It moves on every
        // pass, and including it would repaint every card each time for the
        // sake of "2h ago" becoming "3h ago" - which nobody is watching, and
        // which refreshes anyway the moment anything real changes.
        const signature = JSON.stringify([verdict.hide, stub, meta]);

        if (painted.get(listing.element) !== signature) {
          painted.set(listing.element, signature);

          if (verdict.hide) {
            // A dismissed stub restores permanently; every other stub just
            // opens for this visit, since nothing was decided by hand to undo.
            const undo =
              verdict.reason === 'dismissed' && onDismiss
                ? (record) => onDismiss(record, false)
                : undefined;

            collapse(listing, stub, verdict.reason, undo);
          } else {
            expand(listing);
          }

          if (meta) {
            renderMeta(listing, {
              ...meta,
              now,
              onDismiss: onDismiss ? (record) => onDismiss(record, true) : undefined,
              onSave,
              isSaved,
            });
          } else {
            clearMeta(listing);
          }
        }

        // Trim the card: our badge restates the rate, and the excerpt is long.
        setPartHidden(listing.rateBlock, settings.enabled && settings.hideOriginalRate);
        setPartHidden(listing.descBlock, settings.enabled && !settings.showDescription);
      } catch {
        // Any failure on one listing leaves that listing visible and untouched.
        expand(listing);
        ordering.push({ element: listing.element, usdPerMonth: null, postedAt: null });
      }
    }

    // Once over the whole list rather than per card: the highlight registry
    // takes every range in one call, and painting is not per-listing work.
    if (settings.enabled && settings.highlightTerms) {
      applyHighlights(
        records.map((listing) => listing.descBlock),
        highlightTerms(settings.searchKeywords, settings.requiredSkills),
      );
    } else {
      clearHighlights();
    }

    setGroupHeading(
      hidden === 1 ? '1 listing hidden' : `${hidden} listings hidden`,
    );

    // Ranking runs last, over the figures the pass just settled. Nothing is
    // moved: applyOrder only sets a CSS `order` on each child.
    if (settings.enabled && settings.sortBy !== 'site') {
      applyOrder(
        container,
        sortEntries(ordering, settings.sortBy).map((entry) => entry.element),
      );
    } else {
      clearOrder(container);
    }

    /*
     * The cloud, counted with the rule the chip will actually filter by.
     *
     * The vocabulary is still the skills listings declare - that is what makes
     * a useful chip - but each one is then counted with `matchesRequired`,
     * which also reads the title. Otherwise the number under a chip is not the
     * number of listings you get when you press it, and a count that cannot
     * predict its own result is worse than no count at all.
     *
     * Two passes, both over at most a few hundred listings: gather the
     * vocabulary, then count. The nested scan is bounded by
     * vocabulary x listings, which stays small because the vocabulary only ever
     * holds skills these listings named.
     */
    const vocabulary = new Set();
    for (const listing of countable) {
      for (const skill of listing.skills ?? []) vocabulary.add(skill);
    }
    const skillCounts = new Map();
    for (const skill of vocabulary) {
      let count = 0;
      for (const listing of countable) {
        if (matchesRequired(listing, [skill])) count += 1;
      }
      if (count > 0) skillCounts.set(skill, count);
    }

    return {
      total: records.length,
      hidden,
      unparsed,
      assumed,
      byReason,
      skills: [...skillCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, count]) => ({ name, count })),
      source,
      warning: scanWarning,
      samples,
    };
  }

  return {
    scan,
    apply,
    restore: () => {
      records.forEach(clearMeta);
      restoreAll(records);
      clearOrder(findResultsContainer(records));
    },
    resultsContainer: () => findResultsContainer(records),
    /**
     * Every listing still on screen, in the shape job-export wants.
     *
     * Reads the figure off the badge the last pass drew rather than re-deciding
     * it: what gets exported should be exactly what you were looking at.
     */
    visibleForExport: () =>
      records
        .filter((record) => !record.element.classList.contains('ojrf-hidden'))
        .map((record) => ({
          title: record.title,
          employer: record.employer,
          rateText: record.rateText,
          usdPerMonth: exported.get(record.element) ?? null,
          // The label, not the slug: a spreadsheet is read by a person.
          jobType: JOB_TYPE_LABELS[record.jobType] ?? record.jobType ?? '',
          hoursPerWeek: '',
          postedAt: record.postedAt,
          status: '',
          url: record.href ? new URL(record.href, location.origin).href : '',
        })),
    get records() {
      return records;
    },
  };
}
