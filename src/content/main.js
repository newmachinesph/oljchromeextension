/**
 * Content script entry point (loaded as a real ES module by content.js).
 *
 * Wires together: settings -> scan -> filter -> control bar, and keeps them in
 * sync when settings change anywhere or the page swaps in new results.
 */

import { loadSettings, saveSettings, onSettingsChanged } from '../core/settings.js';
import { loadDismissed, setDismissed, onDismissedChanged } from '../core/dismissed.js';
import { loadSaved, toggleSaved, onSavedChanged } from '../core/saved.js';
import { loadViewed, setViewed, onViewedChanged } from '../core/viewed.js';
import { loadJobNotes, setJobNote, onJobNotesChanged } from '../core/job-notes.js';
import { loadJobTags, toggleJobTag, addJobTag, removeJobTag, allTags, onJobTagsChanged } from '../core/job-tags.js';
import { loadTagColors, onTagColorsChanged } from '../core/tag-colors.js';
import { DEFAULT_TAGS, tagColor } from '../core/tags-catalog.js';
import { createFilter } from './filter.js';
import { createControlBar } from './control-bar.js';
import { createWidgetShell } from './widget-shell.js';
import { mountDock } from './dock.js';
import {
  fetchAdditionalPages,
  fetchSearches,
  mergeCards,
  removeImported,
  clearSearchHits,
  fetchLatestCards,
  prependCards,
  clearFresh,
  PAGE_SIZE,
} from './prefetch.js';
import { createAutoRefresh } from './auto-refresh.js';
import {
  loadUserPresets,
  onUserPresetsChanged,
  saveUserPreset,
  removeUserPreset,
  loadHiddenPresets,
  toggleHiddenPreset,
  onHiddenPresetsChanged,
} from '../core/user-presets.js';
import { replacePagination, restorePagination } from './pagination.js';
import { mountSidebar, restoreSidebar } from './sidebar.js';
import { applyLayout, resetLayout, setSiteSearchHidden } from './layout.js';
import { showSkeletons, hideSkeletons } from './skeleton.js';
import {
  updateResultCount,
  restoreResultCount,
  dockSummary,
  undockSummary,
} from './result-count.js';
import { loadExpired, markExpired, onExpiredChanged } from '../core/expired.js';
import {
  loadApplications,
  setApplication,
  removeApplication,
  markFollowedUp,
  onApplicationsChanged,
} from '../core/applications.js';
import { createJobModal, writeToClipboard } from './job-modal.js';
import { createDraftPanel } from './draft-panel.js';
import { draftDeps } from './draft-deps.js';
import { markVisit } from '../core/visits.js';
import { loadStats, recordSamples } from '../core/benchmark.js';
import { createPalette } from './palette-ui.js';
import {
  loadSearches,
  saveSearch,
  filtersFromSettings,
  settingsFromSearch,
  describeSearch,
  onSearchesChanged,
} from '../core/saved-searches.js';
import { PRESETS } from '../core/presets.js';
import { loadHistory, recordPage } from '../core/history.js';
import { createPresetPicker } from './preset-picker.js';
import { SORT_MODES } from '../core/sort.js';
import { JOB_TYPES, DEFAULTS } from '../core/settings.js';
import { toTabDelimited } from '../core/job-export.js';
import { readRate } from '../core/custom-rules.js';
import { decide, formatUsd, formatRate } from '../core/normalize.js';
import { readRateIntent, RATE_INTENTS } from '../core/rate-intent.js';
import { jobTypeSlug } from './find-listings.js';
import { EXPERIENCE_FILTERS } from '../core/experience-level.js';
import { createKeyboardTriage } from './keys.js';
import { describeBindings } from '../core/key-nav.js';
import {
  loadBook,
  setBlocked,
  setNote,
  rememberSignals,
  isBlocked,
  noteFor,
  onBookChanged,
} from '../core/employer-book.js';

const RESCAN_DEBOUNCE_MS = 300;

let settings = null;
/** Your own presets and overrides, for the picker. Empty until loaded. */
let userPresets = [];
/** Preset names you have hidden from the picker. */
let hiddenPresets = [];
let lastResult = null;
let rescanTimer = null;
/** Job keys already triaged. Loaded once, kept current by its own subscription. */
let dismissed = new Set();
/** Job keys the site has deleted, learned by opening them. */
let expired = new Set();
/** Job key -> the application you made, and where it got to. */
let applications = new Map();
/** Jobs you bookmarked to come back to, kept current by its subscription. */
let saved = new Map();
/** Jobs you have opened, so the list can hide what you have already read. */
let viewed = new Set();
/** A private note per job, edited from the modal or the Saved tab. */
let jobNotes = new Map();
/** Free-form tags per job. */
let jobTags = new Map();
/** The colour picked for each tag (lower-cased tag -> hex). */
let tagColors = new Map();
/** Listings posted after this are new since you were last here. */
let newSince = null;
/** The rate distribution learned so far, for percentile readings. */
let stats = null;
/** Named filter sets, kept current by their own subscription. */
let searches = [];
/** How long each role has been advertised, learned across sessions. */
let history = {};
/** Employers you blocked or wrote about, and what their job pages said. */
let book = new Map();

const filter = createFilter({
  onDismiss: async (listing, hide) => {
    // Update in place first so the card responds to the click immediately;
    // storage confirms a moment later and the subscription is idempotent.
    if (hide) dismissed.add(listing.jobKey);
    else dismissed.delete(listing.jobKey);
    render();

    dismissed = await setDismissed(listing.jobKey, hide);
    render();
  },
  isSaved: (key) => saved.has(key),
  onSave: async (listing) => {
    const result = await toggleSaved(listing.jobKey, {
      title: listing.title,
      url: listing.href,
      employer: listing.employer ?? '',
      usdPerMonth: Number.isFinite(listing.usdPerMonth) ? listing.usdPerMonth : undefined,
    });
    saved = result.saved;
    // No render: the card button already flipped optimistically, and the store
    // subscription repaints every card in one pass if anything else changed.
  },
});

/**
 * How the modal should state a rate: the same words the card uses, so opening a
 * listing never seems to disagree with the row you opened it from.
 */
function describeRate(rateText, jobTypeLabel, hoursPerWeek = null) {
  const parsed = readRate(rateText, settings.customRules, settings.vocabulary);
  const verdict = decide(parsed, settings, {
    jobType: jobTypeSlug(jobTypeLabel),
    hoursPerWeek,
  });
  // Carried alongside the wording so the modal can put a number in a spreadsheet.
  const usdPerMonth = verdict.usdPerMonth;

  if (verdict.reason === 'fixed-fee') {
    return {
      rate: verdict.fixedFeeUsd !== null ? `${formatUsd(verdict.fixedFeeUsd)} fixed` : 'per-task',
      tone: 'task',
      usdPerMonth,
    };
  }
  if (parsed?.taskBased) return { rate: 'per-task', tone: 'task', usdPerMonth };
  if (usdPerMonth !== null) {
    return {
      rate: `${verdict.assumed ? '~' : ''}${formatRate(verdict, settings)}`,
      tone: verdict.assumed ? 'assumed' : 'ok',
      usdPerMonth,
    };
  }

  const intent = readRateIntent(rateText);
  if (intent === RATE_INTENTS.NEGOTIABLE) {
    return { rate: 'negotiable', tone: 'open', usdPerMonth };
  }
  if (intent === RATE_INTENTS.UNSTATED || rateText === null) {
    return { rate: 'not stated', tone: 'unknown', usdPerMonth };
  }
  return { rate: 'rate unclear', tone: 'unknown', usdPerMonth };
}

const modal = createJobModal({
  describeRate,
  shouldFormatDescription: () => settings?.formatDescription !== false,
  onExpired: async (key) => {
    expired.add(key);
    render();
    expired = await markExpired(key);
    render();
  },
  onDismiss: async (key, hide) => {
    if (hide) dismissed.add(key);
    else dismissed.delete(key);
    render();
    dismissed = await setDismissed(key, hide);
    render();
  },
  isDismissed: (key) => dismissed.has(key),
  isSaved: (key) => saved.has(key),
  onSaveToggle: async (key, snapshot) => {
    const result = await toggleSaved(key, snapshot);
    saved = result.saved;
    render();
  },
  onViewed: async (key) => {
    if (viewed.has(key)) return;
    viewed.add(key);
    render();
    viewed = await setViewed(key, true);
  },
  getJobNote: (key) => jobNotes.get(key)?.text ?? '',
  onJobNote: async (key, text) => {
    jobNotes = await setJobNote(key, text);
  },
  getJobTags: (key) => jobTags.get(key) ?? [],
  onJobTagToggle: async (key, tag) => {
    jobTags = await toggleJobTag(key, tag);
  },
  onJobTagAdd: async (key, tag) => {
    jobTags = await addJobTag(key, tag);
  },
  onJobTagRemove: async (key, tag) => {
    jobTags = await removeJobTag(key, tag);
  },
  getTagColor: (tag) => tagColor(tag, tagColors),
  getTagSuggestions: () => {
    const used = allTags(jobTags);
    const seen = new Set(used.map((t) => t.toLowerCase()));
    return [...used, ...DEFAULT_TAGS.map((d) => d.label).filter((d) => !seen.has(d.toLowerCase()))];
  },
  getApplication: (key) => applications.get(key) ?? null,
  getCardLevel: (href) => filter.records.find((record) => record.href === href)?.level ?? null,
  isEmployerBlocked: (name) => isBlocked(book, name),
  onBlockEmployer: async (name, blocked) => {
    book = await setBlocked(name, blocked);
    render();
  },
  getEmployerNote: (name) => noteFor(book, name),
  onNoteEmployer: async (name, note) => {
    book = await setNote(name, note);
    render();
  },
  onRememberSignals: async (name, signals) => {
    book = await rememberSignals(name, signals);
    render();
  },
  onApply: async (key, details) => {
    applications = await setApplication(key, details);
    render();
  },
  onFollowedUp: async (key) => {
    applications = await markFollowedUp(key);
    render();
  },
  onMountDraft: (actionsHost, panelHost, jobForDraft) => {
    createDraftPanel(
      draftDeps({
        getSettings: () => settings,
        saveSettings: async (patch) => {
          settings = await saveSettings(patch);
        },
        onCredits: () => {},
        openOptions: () => chrome.runtime.sendMessage({ type: 'open-options' }),
      }),
    ).mount({ actionsHost, panelHost, job: jobForDraft });
  },
});

/** Names the current filters, so applying a preset is not a one-way door. */
async function saveCurrentFilters() {
  // The one prompt in the extension. A name is a single short string, and a
  // modal to collect it would be more surface than that earns.
  const name = window.prompt('Name for this search');
  if (!name?.trim()) return;

  searches = await saveSearch(name, filtersFromSettings(settings), Date.now());
}

const presetPicker = createPresetPicker({
  getUserPresets: () => userPresets,
  // The picker edits presets in place, so it needs the store, not just a read.
  // Both hand the fresh list back so the modal repaints without waiting for the
  // storage change event to come round.
  onSavePreset: async (preset) => {
    userPresets = await saveUserPreset(preset);
    return userPresets;
  },
  onDeletePreset: async (id) => {
    userPresets = await removeUserPreset(id);
    return userPresets;
  },
  getHiddenPresets: () => hiddenPresets,
  onToggleHidden: async (name) => {
    hiddenPresets = await toggleHiddenPreset(name);
    return hiddenPresets;
  },
  onApply: async (preset) => {
    settings = await saveSettings(settingsFromSearch(preset, DEFAULTS));
    render();
    runSearches();
  },
  onSaveCurrent: saveCurrentFilters,
});

const widgets = createWidgetShell();

const bar = createControlBar({
  onChange: async (partial) => {
    settings = await saveSettings(partial);
    render();
  },
  onOpenOptions: () => {
    chrome.runtime.sendMessage({ type: 'open-options' });
  },
  onOpenBoard: () => widgets.open('board'),
  onOpenPalette: () => palette.open(),
  onOpenPresets: () => presetPicker.open(),

  /**
   * Keep the search you are looking at, and say what that means.
   *
   * Saving is the easy half. The half worth wording carefully is what happens
   * next: a saved search is only watched when alerts are on and it has search
   * terms, and someone who just pressed Keep expecting to be told about new
   * listings deserves to hear that it will not happen, right now, rather than
   * wonder in a week why nothing arrived.
   */
  onSaveSearch: async (name) => {
    try {
      // The clock has to be passed: saveSearch defaults `now` to null rather
      // than reading it itself, so omitting it here stored savedAt: null and
      // the search had no idea when it was kept. The other call site passed it
      // and this one did not, so the two disagreed about the same record.
      await saveSearch(name, filtersFromSettings(settings), Date.now());
    } catch {
      return 'Could not save that search.';
    }

    if (settings.searchKeywords.length === 0) {
      return `Saved “${name}”. Add search terms if you want to be told about new listings.`;
    }
    if (settings.alertsEnabled !== true) {
      return `Saved “${name}”. Turn alerts on in settings to be told when it finds something new.`;
    }
    return `Saved “${name}”, and watching it every ${settings.alertIntervalMinutes} minutes.`;
  },
  onCopyAll: async () => {
    const jobs = filter.visibleForExport();
    if (jobs.length === 0) return 0;

    const ok = await writeToClipboard(toTabDelimited(jobs));
    return ok ? jobs.length : 0;
  },
});

function restoreAndCount() {
  filter.restore();
  return {
    total: filter.records.length,
    hidden: 0,
    unparsed: 0,
    source: lastResult?.source ?? 'none',
    warning: lastResult?.warning ?? null,
  };
}

function render() {
  lastResult = settings.enabled
    ? filter.apply(settings, dismissed, expired, applications, newSince, stats, history, book, viewed)
    : restoreAndCount();
  bar.update(settings, lastResult);
  // Kept in step with the setting rather than with this control's own clicks,
  // so the options page and another tab both show up here.
  bar.setAutoRefresh({
    enabled: settings.autoRefresh !== false,
    minutes: settings.autoRefreshMinutes ?? 5,
  });
  // A card that just collapsed should not keep the keyboard focus ring.
  keys.refresh();

  if (settings.enabled) {
    applyLayout({ wide: settings.wideLayout, sidebarWidth: settings.sidebarWidth });
    setSiteSearchHidden(settings.hideSiteSearch);
    // The site's "Displaying 30 out of 299" stops being true the moment we
    // merge pages into the page.
    updateResultCount({ loaded: lastResult.total, hidden: lastResult.hidden });
    // The breakdown explains that line, so it reads beside it rather than up in
    // the controls. Re-docked every pass: the site replaces the line on some
    // navigations, and a summary left behind would point at nothing.
    dockSummary(bar.rows.summary);
    // Step by everything on screen, not by the site's 30.
    replacePagination({
      span: PAGE_SIZE * (settings.prefetchPages + 1),
      total: lastResult.total,
    });
  } else {
    resetLayout();
    restorePagination();
    restoreResultCount();
    undockSummary();
    // Hand the rows back to the bar so nothing is orphaned when switched off.
    for (const row of restoreSidebar()) bar.element.appendChild(row);
    bar.reclaimSummary();
  }
}

/**
 * Fold what this pass read into the benchmark.
 *
 * Once per pass rather than per listing, and never awaited by render: learning
 * the distribution is bookkeeping, and it must not make the page wait. The
 * reading shown is therefore one pass behind, which for a distribution of
 * hundreds is a difference nobody can see.
 */
/**
 * Note that these roles were on the page today.
 *
 * Not awaited, for the same reason the benchmark is not: it is bookkeeping, and
 * the reading it produces is one pass behind, which for a span measured in
 * weeks is a difference nobody can see.
 */
async function rememberSightings() {
  const records = filter.records;
  if (!records || records.length === 0) return;

  history = await recordPage(records);
}

async function learnFromThisPass() {
  const samples = lastResult?.samples;
  if (!samples || samples.length === 0) return;

  // Through the store rather than from our snapshot: this page may have been
  // open for an hour, and another tab's samples are not ours to discard.
  stats = await recordSamples(samples);
}

/** Nodes we inserted ourselves, which must not trigger a rescan loop. */
function isOurs(node) {
  if (node.id === 'ojrf-bar') return true;
  const className = typeof node.className === 'string' ? node.className : '';
  if (className.startsWith('ojrf-')) return true;
  // Not everything of ours carries a class: the pager is a bare <nav> known
  // only by its id. Missing that made render() re-insert a node this test read
  // as the site's, which scheduled another rescan, which rendered again - a
  // 300ms loop that rebuilt the skill cloud about three times a second, so
  // chips flickered under the cursor and clicks landed on a replaced node.
  if (typeof node.id === 'string' && node.id.startsWith('ojrf-')) return true;
  return typeof node.closest === 'function' && node.closest('[id^="ojrf-"]') !== null;
}

function watchForNewResults() {
  const observer = new MutationObserver((mutations) => {
    const sawForeignNodes = mutations.some((mutation) =>
      Array.from(mutation.addedNodes).some(
        (node) => node.nodeType === Node.ELEMENT_NODE && !isOurs(node),
      ),
    );
    if (!sawForeignNodes) return;

    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(() => {
      filter.scan(document, settings.customRules, settings.vocabulary);
      render();
    }, RESCAN_DEBOUNCE_MS);
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * Pull in following pages and merge them, once per page load.
 *
 * Runs after the first render so the page is usable immediately rather than
 * waiting on ten requests.
 */
async function mergeFurtherPages() {
  const count = settings.prefetchPages;
  // Keyword searches supersede plain paging - they fetch their own pages.
  if (!count || count < 1 || settings.searchKeywords.length > 0) return;

  bar.setStatus(`loading ${count} more page${count === 1 ? '' : 's'}…`, true);
  const container = filter.resultsContainer();
  showSkeletons(container);

  try {
    const cards = await fetchAdditionalPages({ count });
    hideSkeletons();
    const added = mergeCards(cards, container);

    filter.scan(document, settings.customRules, settings.vocabulary);
    render();
    learnFromThisPass();
    bar.setStatus(added > 0 ? `+${added} listings merged` : 'no further pages');
  } catch (error) {
    hideSkeletons();
    bar.setStatus('could not load more pages');
    console.error('[onlinejobs rate filter] prefetch failed:', error);
  }
}

/**
 * The poll that keeps the top of the list current.
 *
 * Reads the settings per tick rather than capturing them, so turning it off or
 * changing the interval takes effect without a reload. Cards arrive through
 * prependCards, which dedupes against what is already on the page, then the
 * usual scan/render runs so a new card is filtered exactly like the rest -
 * arriving late must not mean arriving unfiltered.
 */
const autoRefresh = createAutoRefresh({
  isEnabled: () => settings?.autoRefresh === true,
  getIntervalMinutes: () => settings?.autoRefreshMinutes ?? 5,
  onVisibilityChange: (type, fn) => document.addEventListener(type, fn),
  checkNow: async () => {
    const container = filter.resultsContainer();
    if (!container) return 0;

    const cards = await fetchLatestCards();
    // Only the newest batch wears the marker; last tick's arrivals have had
    // their moment and are now just part of the list.
    clearFresh();
    // The bar shares this container with the listings and is not first in it,
    // so it is passed as the mark to insert after - "top of the list" has to
    // mean the top of the listings, not the top of the container.
    const added = prependCards(cards, container, document, { after: bar.element });
    if (added === 0) return 0;

    filter.scan(document, settings.customRules, settings.vocabulary);
    render();
    return added;
  },
  onResult: (added) => {
    bar.setStatus(`+${added} new listing${added === 1 ? '' : 's'} on top`);
  },
});

/** The search terms we last fetched for, so a settings change knows if they moved. */
let fetchedTerms = '';

/**
 * Run every listed keyword search and merge the union into the page.
 *
 * Replaces whatever a previous run imported, so removing a term removes its
 * listings rather than leaving them behind.
 */
async function runSearches() {
  const terms = settings.searchKeywords;
  const key = terms.join('|');
  if (key === fetchedTerms) return;
  fetchedTerms = key;

  // Re-scan straight after removing what a previous run imported. Without this
  // the records still point at detached nodes, and resultsContainer() - which
  // walks up from the first record - would return null and merging would no-op.
  removeImported();
  // The marks say "the site returned this for your search". Once the terms
  // change they are last search's answer to a question nobody asked.
  clearSearchHits();
  filter.scan(document, settings.customRules, settings.vocabulary);
  render();

  if (terms.length === 0) {
    bar.setStatus('');
    return;
  }

  bar.setStatus(`searching ${terms.length} term${terms.length === 1 ? '' : 's'}…`, true);
  const container = filter.resultsContainer();
  showSkeletons(container);

  try {
    const { cards, pagesPerTerm, capped } = await fetchSearches({
      keywords: terms,
      pages: settings.prefetchPages || 1,
    });
    hideSkeletons();
    // Marked as the site's own hits, so the search rule does not then hide them
    // for failing to repeat the term on the card - which is what made our box
    // and the site's navbar return different listings for the same word.
    const added = mergeCards(cards, container, document, { searchHit: true });

    filter.scan(document, settings.customRules, settings.vocabulary);
    render();

    // Said out loud rather than silently done: someone who set five pages and
    // got two should know why, and where the number came from.
    const note = capped ? ` · ${pagesPerTerm} page${pagesPerTerm === 1 ? '' : 's'} each` : '';
    const label = terms.length === 1 ? 'search' : 'searches';
    bar.setStatus(`${terms.length} ${label} · +${added} listings${note}`);
  } catch (error) {
    hideSkeletons();
    bar.setStatus('search failed');
    console.error('[onlinejobs rate filter] multi-search failed:', error);
  }
}

/**
 * What the palette can do, gathered fresh each time it opens.
 *
 * Commands first, then jobs. With an empty query you want the actions; the
 * moment you type a word you almost certainly mean a job title, and the ranking
 * sorts that out on its own.
 */
function paletteEntries() {
  const set = (patch) => async () => {
    settings = await saveSettings(patch);
    render();
  };

  const commands = [
    {
      label: settings.onlyNew ? 'Show every listing' : 'Show only new since my last visit',
      hint: 'What changed',
      kind: 'filter',
      run: set({ onlyNew: !settings.onlyNew }),
    },
    ...SORT_MODES.filter((mode) => mode.value !== settings.sortBy).map((mode) => ({
      label: `Sort by ${mode.label.toLowerCase()}`,
      hint: 'Order',
      kind: 'sort',
      run: set({ sortBy: mode.value }),
    })),
    ...JOB_TYPES.map((type) => ({
      label: settings.hiddenJobTypes.includes(type.value)
        ? `Show ${type.label} listings`
        : `Hide ${type.label} listings`,
      hint: 'Job type',
      kind: 'filter',
      run: set({
        hiddenJobTypes: settings.hiddenJobTypes.includes(type.value)
          ? settings.hiddenJobTypes.filter((entry) => entry !== type.value)
          : [...settings.hiddenJobTypes, type.value],
      }),
    })),
    ...[0, 500, 1000, 1500, 2000].map((amount) => ({
      label: `Hide below $${amount.toLocaleString('en-US')}/mo`,
      hint: 'Threshold',
      kind: 'rate',
      run: set({ thresholdUsdPerMonth: amount }),
    })),
    ...EXPERIENCE_FILTERS.filter((option) => option.value !== settings.experienceFilter).map(
      (option) => ({
        label:
          option.value === 'all'
            ? 'Show every experience level'
            : option.value === 'beginner'
              ? 'Show only beginner-friendly jobs'
              : 'Hide experienced-only jobs',
        hint: 'Experience',
        kind: 'filter',
        run: set({ experienceFilter: option.value }),
      }),
    ),
    {
      label: settings.onlyFollowUps
        ? 'Show every listing, not only follow-ups'
        : 'Show only applications due a follow-up',
      hint: 'Applications',
      kind: 'filter',
      run: set({ onlyFollowUps: !settings.onlyFollowUps }),
    },
    {
      label: settings.hideApplied ? 'Show jobs I applied to' : 'Hide jobs I applied to',
      hint: 'Applications',
      kind: 'filter',
      run: set({ hideApplied: !settings.hideApplied }),
    },
    // Applying a whole search is the biggest single change the palette can
    // make, so it is named for what it is rather than for the fields it sets.
    ...searches.map((search) => ({
      label: `Search: ${search.name}`,
      hint: describeSearch(search) || 'saved search',
      kind: 'search',
      run: set(settingsFromSearch(search, DEFAULTS)),
    })),
    ...PRESETS.map((preset) => ({
      label: `Preset: ${preset.name}`,
      hint: preset.hint,
      kind: 'preset',
      run: set(settingsFromSearch(preset, DEFAULTS)),
    })),
    {
      label: 'Save these filters as a search…',
      hint: 'Name the set you are using now',
      kind: 'search',
      run: saveCurrentFilters,
    },
    {
      label: 'Browse presets…',
      hint: 'Cards, grouped, with what each one actually searches for',
      kind: 'preset',
      run: () => presetPicker.open(),
    },
    {
      label: 'Copy every loaded listing',
      hint: 'Spreadsheet rows',
      kind: 'export',
      run: async () => {
        const jobs = filter.visibleForExport();
        if (jobs.length > 0) await writeToClipboard(toTabDelimited(jobs));
      },
    },
    {
      label: 'Keyboard shortcuts',
      hint: describeBindings(),
      kind: 'open',
      run: () => {},
    },
    {
      label: 'Open settings',
      hint: 'All options',
      kind: 'open',
      run: () => chrome.runtime.sendMessage({ type: 'open-options' }),
    },
  ];

  // Only what is on screen: offering to open something the filter just hid
  // would undo the filtering you came here to do.
  const jobs = filter.records
    .filter((record) => !record.element.classList.contains('ojrf-hidden'))
    .map((record) => ({
      label: record.title,
      hint: record.employer ?? '',
      kind: 'job',
      run: () => record.href && modal.open(record.href, { employer: record.employer ?? '' }),
    }));

  return [...commands, ...jobs];
}

const palette = createPalette({ getEntries: paletteEntries });

/** The listings still on screen, in page order, for the keyboard to step through. */
function visibleRecords() {
  return filter.records.filter(
    (record) => record.href && !record.element.classList.contains('ojrf-hidden'),
  );
}

const keys = createKeyboardTriage({
  doc: document,
  visibleRecords,
  // Each of these owns the keyboard while it is up.
  isBlocked: () => !settings?.enabled || palette.isOpen() || modal.isOpen(),
  actions: {
    open: (record) => modal.open(record.href, { employer: record.employer ?? '' }),
    dismiss: async (record) => {
      dismissed.add(record.jobKey);
      render();
      dismissed = await setDismissed(record.jobKey, true);
      render();
    },
    // The same moment the modal records an application: opening the site's own
    // page. The rate is not passed - the card's figure may be assumed, and the
    // modal is where the real one is read.
    apply: async (record) => {
      window.open(new URL(record.href, location.origin).href, '_blank', 'noopener');
      applications = await setApplication(record.jobKey, {
        title: record.title,
        url: record.href,
        employer: record.employer,
      });
      render();
    },
    note: async (record) => {
      if (!record.employer) return;
      const next = window.prompt(`Note on ${record.employer}`, noteFor(book, record.employer));
      if (next === null) return;
      book = await setNote(record.employer, next);
      render();
    },
    block: async (record) => {
      if (!record.employer) return;
      book = await setBlocked(record.employer, !isBlocked(book, record.employer));
      render();
    },
    help: () => palette.open('Keyboard'),
  },
});

async function start() {
  [settings, dismissed, expired, applications, saved, viewed, newSince] = await Promise.all([
    loadSettings(),
    loadDismissed(),
    loadExpired(),
    loadApplications(),
    loadSaved(),
    loadViewed(),
    // Recorded once per load, before the first render, so the cutoff is fixed
    // for the whole visit rather than drifting as pages merge in.
    markVisit(),
  ]);
  // Neither blocks the first render: the benchmark only annotates, and the
  // saved searches are only offered once you open the palette.
  [stats, searches, history, book, jobNotes, jobTags, tagColors] = await Promise.all([
    loadStats(),
    loadSearches(),
    loadHistory(),
    loadBook(),
    loadJobNotes(),
    loadJobTags(),
    loadTagColors(),
  ]);

  filter.scan(document, settings.customRules, settings.vocabulary);
  bar.mount(filter.resultsContainer());
  // Job links open over the page rather than replacing it.
  modal.intercept(filter.resultsContainer());
  // Skills and job types go in the sidebar when there is one; if not, they stay
  // in the bar where they were built.
  // Job type first: four fixed pills you set once, above a long changing list.
  mountSidebar([bar.rows.types, bar.rows.level, bar.rows.skills]);
  render();

  onSettingsChanged((next) => {
    settings = next;
    render();
    runSearches();
    // Re-arm on the new interval, or stand down if it was just switched off.
    autoRefresh.start();
  });

  // Another tab, or the options page clearing the list.
  onDismissedChanged((next) => {
    dismissed = next;
    render();
  });

  onExpiredChanged((next) => {
    expired = next;
    render();
  });

  onApplicationsChanged((next) => {
    applications = next;
    render();
  });

  onSavedChanged((next) => {
    saved = next;
    render();
  });

  onViewedChanged((next) => {
    viewed = next;
    render();
  });

  // No render: a note or tag change does not alter the list, only what the
  // modal shows next time it opens.
  onJobNotesChanged((next) => {
    jobNotes = next;
  });

  onJobTagsChanged((next) => {
    jobTags = next;
  });

  onTagColorsChanged((next) => {
    tagColors = next;
  });

  onBookChanged((next) => {
    book = next;
    render();
  });

  // No render: saved searches change what the palette offers, not what is on
  // screen. Applying one goes through settings, which renders on its own.
  onSearchesChanged((next) => {
    searches = next;
  });

  // Not awaited: the picker reads this when it opens, which is never now.
  loadUserPresets().then((list) => {
    userPresets = list;
  });
  onUserPresetsChanged((list) => {
    userPresets = list;
  });
  loadHiddenPresets().then((list) => {
    hiddenPresets = list;
  });
  onHiddenPresetsChanged((list) => {
    hiddenPresets = list;
  });

  // The tracker is not a filter, so it does not live in the row of filtering
  // controls - it is one icon in the dock, alongside the other mini apps.
  mountDock(widgets);

  watchForNewResults();
  autoRefresh.start();
  learnFromThisPass();
  rememberSightings();

  // Not awaited: the page is already filtered and usable.
  if (settings.searchKeywords.length > 0) runSearches();
  else mergeFurtherPages();

  /*
   * The badge is the worker's to paint, but a day may have passed since it last
   * looked; opening the site is a good moment to have it look again.
   *
   * Last, and defended twice. sendMessage answers with a promise when a worker
   * is listening and `undefined` when one is not, so a bare `.catch` on the
   * result throws - and this line used to sit ABOVE the merge, which meant a
   * missing service worker silently cancelled page merging for the whole visit.
   * A cosmetic number on the toolbar icon must not be able to do that.
   */
  try {
    await Promise.resolve(chrome.runtime.sendMessage({ type: 'refresh-badge' })).catch(() => {});
  } catch {
    // No worker listening. The badge simply keeps whatever it last showed.
  }
}

start().catch((error) => {
  console.error('[onlinejobs rate filter] failed to start:', error);
});
