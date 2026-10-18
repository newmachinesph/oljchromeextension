/**
 * The injected control strip.
 *
 * Deliberately vanilla and small: this renders inside the site's own page, so it
 * should not drag a framework in with it. The React options page owns the full
 * configuration surface; this bar owns what you adjust while browsing.
 *
 * Laid out as two explicit rows rather than one wrapping row - controls above,
 * job-type pills below - so it never collapses into a ragged shape.
 */

import { JOB_TYPES, REFRESH_INTERVALS } from '../core/settings.js';
import { EXPERIENCE_FILTERS } from '../core/experience-level.js';
import { SORT_MODES } from '../core/sort.js';

const BAR_ID = 'ojrf-bar';
const DEBOUNCE_MS = 150;

/** Short wording for the hidden-count breakdown, in display order. */
const REASON_WORDING = [
  ['below-threshold', 'low rate'],
  ['dismissed', 'dismissed'],
  ['expired', 'no longer posted'],
  ['applied', 'applied'],
  ['not-new', 'seen before'],
  ['repost', 'reposted'],
  ['red-flag', 'flagged'],
  ['negotiable', 'negotiable'],
  ['no-rate', 'not stated'],
  ['unclear-rate', 'rate unclear'],
  ['task-based', 'per-task'],
  ['not-in-search', 'not in search'],
  ['no-skill-match', 'no skill match'],
  ['job-type', 'job type'],
  ['too-old', 'too old'],
  ['keyword', 'keyword'],
];

/** Every reason with a count, biggest first. */
function reasonParts(byReason) {
  if (!byReason) return [];
  return REASON_WORDING.filter(([reason]) => byReason[reason] > 0)
    .map(([reason, wording]) => ({ n: byReason[reason], text: `${byReason[reason]} ${wording}` }))
    .sort((a, b) => b.n - a.n)
    .map((entry) => entry.text);
}



export function createControlBar({
  onChange,
  onOpenOptions,
  onOpenBoard,
  onCopyAll,
  onOpenPalette,
  onOpenPresets,
  onSaveSearch,
}) {
  const bar = document.createElement('div');
  bar.id = BAR_ID;
  // Shared scope for component styling, so chips and pills keep their look when
  // their rows are relocated into the sidebar.
  bar.className = 'ojrf-ui';

  bar.innerHTML = `
    <div class="ojrf-row">
      <span class="ojrf-row-label">Rate</span>

      <div class="ojrf-field" title="Hide listings worth less than this">
        <span class="ojrf-affix">min $</span>
        <input type="number" class="ojrf-amount" min="0" max="100000" step="25" />
        <span class="ojrf-affix">/mo</span>
      </div>

      <label class="ojrf-field ojrf-sort" title="Order the results">
        <span class="ojrf-affix">sort</span>
        <select class="ojrf-sort-select" aria-label="Sort listings">
          ${SORT_MODES.map(
            (mode) => `<option value="${mode.value}">${mode.label}</option>`,
          ).join('')}
        </select>
      </label>

      <div class="ojrf-stats">
        <span class="ojrf-count"></span>
        <!--
          The tick sits with the controls rather than on the summary line.
          It was tried there first - the line that says how many loaded and how
          many hidden is the right sentence for "and it is still growing" - but
          the site's count paragraph is 730px inside a 1065px column, so a
          right-aligned control floated three hundred pixels short of the cog it
          should have lined up with. Widening the site's own paragraph to fix
          our own control is the wrong trade. Here the row is full width, and a
          toggle belongs beside the other toggles anyway.
        -->
        <label class="ojrf-auto" title="Re-read the first page on a timer and put anything new at the top. Nothing is fetched while this tab is in the background.">
          <input type="checkbox" class="ojrf-auto-on" />
          <span class="ojrf-auto-text">Auto-refresh</span>
          <select class="ojrf-auto-every" aria-label="How often to check for new listings"></select>
        </label>
      </div>

    </div>

    <!--
      The breakdown runs from nothing to "+150 listings merged · 141 of 180
      hidden · 140 low rate · 1 no longer posted · 77 assumed monthly". Left in
      the row above it dragged the controls around as it grew, so it lives on
      its own line - and once the page is up it is docked beside the site's
      "Showing 158 of 180" instead, which is the line it explains. It carries
      the ojrf-ui scope so it looks the same wherever it ends up.
    -->
    <div class="ojrf-summary ojrf-ui" hidden>
      <span class="ojrf-status" hidden></span>
      <span class="ojrf-detail"></span>
    </div>

    <div class="ojrf-row ojrf-row-search">
      <span class="ojrf-row-label">Search</span>
      <div class="ojrf-terms"></div>
      <!-- Deliberately ordinary roles rather than senior developer ones: the
           placeholder is the first thing read, and naming only high-tier tech
           jobs makes the tool look like it is not for everyone else. -->
      <input type="text" class="ojrf-term-input"
             placeholder="virtual assistant, data entry, customer support…"
             aria-label="Extra searches to merge, comma separated" />
      <!--
        Saving lived only in settings, two clicks and a tab away from the place
        you actually decide a search is worth keeping. The name field stays
        hidden until asked for, so the row does not grow a second input for
        everyone who never saves anything.
      -->
      <button type="button" class="ojrf-save-search" title="Keep this search, and watch it for new listings">
        Save search
      </button>
      <span class="ojrf-save-box" hidden>
        <input type="text" class="ojrf-save-name" placeholder="Name it…"
               aria-label="Name for this saved search" maxlength="60" />
        <button type="button" class="ojrf-save-confirm">Keep</button>
        <button type="button" class="ojrf-save-cancel" aria-label="Cancel">×</button>
      </span>
    </div>

    <div class="ojrf-row ojrf-row-skills" hidden>
      <span class="ojrf-row-label">Skills</span>
      <div class="ojrf-cloud"></div>
    </div>

    <div class="ojrf-row ojrf-row-pills">
      <span class="ojrf-row-label">Show</span>
      <div class="ojrf-pills"></div>
    </div>

    <div class="ojrf-row ojrf-row-level">
      <span class="ojrf-row-label">Level</span>
      <div class="ojrf-pills ojrf-level-pills" role="radiogroup" aria-label="Experience level"></div>
    </div>`;

  // The cog belongs to the bar's first row: the pills row moves to the sidebar,
  // and settings must stay reachable wherever the rows end up.
  // Mac keyboards say Command; everything else says Ctrl. Showing the wrong one
  // is worse than showing none, since the whole point is that you can try it.
  const isMac = /mac|iphone|ipad/i.test(
    navigator.userAgentData?.platform ?? navigator.platform ?? '',
  );
  const shortcut = isMac ? '⌘K' : 'Ctrl K';

  const cogHtml = `
    <div class="ojrf-bar-tools">
      <button type="button" class="ojrf-presets-open"
              title="Start from a preset - a vocabulary and a rate floor for one kind of work"
              aria-label="Start from a preset">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
             stroke-width="1.9" stroke-linejoin="round" aria-hidden="true">
          <!-- Four panes: this opens a grid of cards, not another list. -->
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/>
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/>
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/>
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>
        </svg>
      </button>
      <button type="button" class="ojrf-palette-open"
              title="Search jobs and run commands (${shortcut}, or press /)"
              aria-label="Search jobs and run commands">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
             stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/>
        </svg>
        <kbd>${shortcut}</kbd>
      </button>
      <button type="button" class="ojrf-copy-all"
              title="Copy every loaded listing as spreadsheet rows"
              aria-label="Copy every loaded listing as spreadsheet rows">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2"/>
          <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>
        </svg>
      </button>
      <!-- The tracker moved out of this row and into the dock; see dock.js. It
           is not a filter, and among six filtering controls it read like one. -->
      <button type="button" class="ojrf-settings" title="All settings" aria-label="All settings">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
             aria-hidden="true">
          <!-- Teeth are short and thick and sit on the rim: thin detached rays
               would read as a sun rather than a cog. -->
          <g stroke-width="3.3">
            <path d="M12 6.4V3.5M12 17.6v2.9M6.4 12H3.5M17.6 12h2.9"></path>
            <path d="M8.05 8.05 6 6M15.95 15.95 18 18M8.05 15.95 6 18M15.95 8.05 18 6"></path>
          </g>
          <circle cx="12" cy="12" r="5.2" stroke-width="2.1"></circle>
          <circle cx="12" cy="12" r="1.9" stroke-width="1.7"></circle>
        </svg>
      </button>
    </div>`;

  bar.querySelector('.ojrf-row').insertAdjacentHTML('beforeend', cogHtml);

  const warningRow = document.createElement('div');
  warningRow.className = 'ojrf-warning';
  warningRow.hidden = true;
  bar.appendChild(warningRow);

  const amountInput = bar.querySelector('.ojrf-amount');
  const sortSelect = bar.querySelector('.ojrf-sort-select');
  const count = bar.querySelector('.ojrf-count');
  const detail = bar.querySelector('.ojrf-detail');
  const summary = bar.querySelector('.ojrf-summary');
  // Held as references, not looked up again on each use: the summary and its
  // two halves get docked beside the site's result count, and a query rooted at
  // the bar stops finding them the moment they leave it.
  const status = summary.querySelector('.ojrf-status');
  // Rooted at the bar, not the summary: the summary gets docked out to the
  // site's count line, and these stay behind in the control row.
  const autoWrap = bar.querySelector('.ojrf-auto');
  const autoOn = bar.querySelector('.ojrf-auto-on');
  const autoEvery = bar.querySelector('.ojrf-auto-every');

  for (const option of REFRESH_INTERVALS) {
    const node = document.createElement('option');
    node.value = String(option.value);
    // "Every 5 minutes" is right in a settings list and far too wide on a line
    // that already carries five facts; on this row it is just "5m".
    node.textContent = `${option.value}m`;
    node.title = option.label;
    autoEvery.appendChild(node);
  }

  autoOn.addEventListener('change', () => {
    autoWrap.classList.toggle('is-on', autoOn.checked);
    autoEvery.disabled = !autoOn.checked;
    emit({ autoRefresh: autoOn.checked }, true);
  });

  autoEvery.addEventListener('change', () => {
    emit({ autoRefreshMinutes: Number(autoEvery.value) }, true);
  });

  /**
   * The summary earns its space only when it has something to say.
   *
   * The tick does not count as something to say: on a page with no filtering
   * and nothing merged, a lone checkbox floating under the results would be
   * the loudest thing there. It rides along with the facts or not at all.
   */
  function refreshSummary() {
    summary.hidden = status.hidden && detail.textContent.trim().length === 0;
  }
  const warning = bar.querySelector('.ojrf-warning');
  const pillHost = bar.querySelector('.ojrf-pills');

  let debounceTimer = null;
  /** Guard so programmatic value updates do not echo back as user edits. */
  let applyingExternalUpdate = false;
  /** Last known hidden-type list, so a pill click can produce the next one. */
  let hiddenTypes = [];

  function emit(partial, immediate) {
    if (applyingExternalUpdate) return;
    clearTimeout(debounceTimer);
    if (immediate) onChange(partial);
    else debounceTimer = setTimeout(() => onChange(partial), DEBOUNCE_MS);
  }

  // Pills mirror the site's own job-type chips, and toggling one is a discrete
  // click rather than a drag, so it applies immediately.
  const pills = new Map();
  for (const type of JOB_TYPES) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'ojrf-pill';
    pill.dataset.type = type.value;
    pill.textContent = type.label;
    pill.title = type.hint
      ? `${type.label} - ${type.hint}. Click to hide these.`
      : `Click to hide ${type.label} listings`;
    pill.addEventListener('click', () => {
      const next = hiddenTypes.includes(type.value)
        ? hiddenTypes.filter((entry) => entry !== type.value)
        : [...hiddenTypes, type.value];
      emit({ hiddenJobTypes: next }, true);
    });
    pills.set(type.value, pill);
    pillHost.appendChild(pill);
  }

  // A view rather than a type: on, the list is only what is waiting on you.
  // Sits with the job-type pills because it is the same gesture - one click,
  // applied immediately - and lives in the same sidebar row.
  const followUpPill = document.createElement('button');
  followUpPill.type = 'button';
  followUpPill.className = 'ojrf-pill ojrf-pill-view';
  followUpPill.textContent = 'Needs follow-up';
  followUpPill.title = 'Only applications that have waited long enough for a nudge';
  followUpPill.addEventListener('click', () => emit({ onlyFollowUps: !followUpsOn }, true));
  pillHost.appendChild(followUpPill);
  let followUpsOn = false;

  // One of three, like a radio group: the current choice reads as "on" and the
  // other two as available, never struck through - none of them is hidden.
  const levelHost = bar.querySelector('.ojrf-level-pills');
  const levelPills = new Map();
  for (const option of EXPERIENCE_FILTERS) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'ojrf-pill ojrf-pill-choice';
    pill.dataset.level = option.value;
    pill.setAttribute('role', 'radio');
    pill.textContent = option.label;
    pill.title =
      option.value === 'all'
        ? 'Show every listing, whatever it says about experience'
        : option.value === 'beginner'
          ? 'Only listings that say they welcome beginners or will train'
          : 'Hide listings that state years of experience, a portfolio or a senior title';
    pill.addEventListener('click', () => emit({ experienceFilter: option.value }, true));
    levelPills.set(option.value, pill);
    levelHost.appendChild(pill);
  }

  // Search terms: typing a comma (or Enter) commits the text as a pill, which is
  // the quickest way to build "engineer, full stack, developer, fullstack".
  const termHost = bar.querySelector('.ojrf-terms');
  const termInput = bar.querySelector('.ojrf-term-input');
  let searchTerms = [];

  function commitTerms(raw) {
    const next = [...searchTerms, ...raw.split(',')]
      .map((term) => term.trim())
      .filter(Boolean);
    termInput.value = '';
    emit({ searchKeywords: [...new Set(next)] }, true);
  }

  termInput.addEventListener('input', () => {
    if (termInput.value.includes(',')) commitTerms(termInput.value);
  });

  termInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && termInput.value.trim()) {
      event.preventDefault();
      commitTerms(termInput.value);
    } else if (event.key === 'Backspace' && !termInput.value && searchTerms.length) {
      // Backspace on an empty box removes the last pill, as tag inputs do.
      emit({ searchKeywords: searchTerms.slice(0, -1) }, true);
    }
  });

  termInput.addEventListener('blur', () => {
    if (termInput.value.trim()) commitTerms(termInput.value);
  });

  // A search from the site's navbar lands here as ?jobkeyword=developer. Prefill
  // our box with it so the bar reflects what you just searched. Left as text, not
  // a committed pill: it is not saved to your keywords, and the page already
  // shows the site's results for it, so our filter is already working on them -
  // press Enter to also merge more pages of it.
  try {
    const fromNav = new URLSearchParams(location.search).get('jobkeyword');
    if (fromNav && fromNav.trim() && !termInput.value) termInput.value = fromNav.trim();
  } catch {
    // No location (as in tests); nothing to seed.
  }

  function renderTerms() {
    termHost.textContent = '';
    for (const term of searchTerms) {
      const tag = document.createElement('span');
      tag.className = 'ojrf-term';
      tag.append(term);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ojrf-term-remove';
      remove.textContent = '×';
      remove.title = `Remove "${term}"`;
      remove.addEventListener('click', () => {
        emit({ searchKeywords: searchTerms.filter((entry) => entry !== term) }, true);
      });

      tag.appendChild(remove);
      termHost.appendChild(tag);
    }
  }

  // Skill cloud: every skill on the loaded listings, commonest first, with how
  // many carry it. Clicking one narrows to it - matched in the page, so it never
  // needs the site's numeric skill IDs.
  const cloudRow = bar.querySelector('.ojrf-row-skills');
  const cloudHost = bar.querySelector('.ojrf-cloud');
  const CLOUD_LIMIT = 28;
  let activeSkills = [];
  /** Whether the tail below CLOUD_LIMIT is on show. Survives repaints. */
  let cloudExpanded = false;

  /** The skills the chips on screen were built from, so a repeat pass is free. */
  let cloudKey = null;

  /** Paint the selection onto the chips already there, without replacing them. */
  function paintCloudSelection() {
    for (const chip of cloudHost.children) {
      // The expand button lives among the chips and is not one.
      if (!chip.classList.contains('ojrf-cloud-chip')) continue;
      const name = chip.dataset.skill ?? '';
      const active = activeSkills.some((entry) => entry.toLowerCase() === name.toLowerCase());
      chip.classList.toggle('ojrf-cloud-chip-on', active);
      chip.setAttribute('aria-pressed', String(active));
      chip.title = active ? `Stop narrowing to "${name}"` : `Narrow to "${name}"`;
    }
  }

  /** The last list painted, so the expand button can repaint without a pass. */
  let lastSkills = [];

  function renderCloud(skills) {
    lastSkills = skills ?? [];
    cloudRow.hidden = !skills || skills.length === 0;
    if (cloudRow.hidden) {
      cloudHost.textContent = '';
      cloudRow.querySelector('.ojrf-cloud-more')?.remove();
      cloudKey = null;
      return;
    }

    /*
     * The cut, and the way back from it.
     *
     * A live page names far more skills than a column can hold - 86 across 78
     * listings, measured - and the first 28 covered every skill two listings
     * shared, so everything a new arrival brought in sat below the line with no
     * way to reach it. The tail is now one press away, and the button says how
     * many there are so the cut is visible rather than silent.
     */
    const shown = cloudExpanded ? skills : skills.slice(0, CLOUD_LIMIT);
    const hasMore = skills.length > CLOUD_LIMIT;
    // The total is in the key as well as the chips: while collapsed the tail can
    // grow without touching the first 28, and the button has to say the number
    // it will actually show.
    const key = [
      cloudExpanded,
      skills.length,
      ...shown.map(({ name, count }) => `${name}:${count}`),
    ].join('|');

    // render() runs on every pass over the listings, and most passes leave the
    // skills exactly as they were. Rebuilding regardless threw away the chip
    // under the cursor - and its hover, its focus, and any half-finished click
    // with it. Same skills, so repaint the selection and keep the nodes.
    if (key === cloudKey) {
      paintCloudSelection();
      return;
    }
    cloudKey = key;
    cloudHost.textContent = '';

    for (const { name, count } of shown) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'ojrf-cloud-chip';
      chip.dataset.skill = name;
      chip.append(name);

      const tally = document.createElement('span');
      tally.className = 'ojrf-cloud-count';
      tally.textContent = String(count);
      chip.appendChild(tally);

      // Read the selection at click time, not at build time: a chip now outlives
      // many passes, so a flag captured here would go stale and toggle the wrong
      // way - selecting something already selected, or refusing to clear it.
      chip.addEventListener('click', () => {
        const on = activeSkills.some((entry) => entry.toLowerCase() === name.toLowerCase());
        const next = on
          ? activeSkills.filter((entry) => entry.toLowerCase() !== name.toLowerCase())
          : [...activeSkills, name];
        emit({ requiredSkills: next }, true);
      });

      cloudHost.appendChild(chip);
    }

    // Outside the chip area, which scrolls: a button that scrolls away with the
    // tail it opened is a button you cannot use to close it again.
    cloudRow.querySelector('.ojrf-cloud-more')?.remove();
    if (hasMore) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'ojrf-cloud-more';
      more.textContent = cloudExpanded ? 'Show fewer' : `Show all ${skills.length}`;
      more.title = cloudExpanded
        ? `Show only the ${CLOUD_LIMIT} commonest skills`
        : `Show all ${skills.length} skills on the loaded listings`;
      more.setAttribute('aria-expanded', String(cloudExpanded));
      more.addEventListener('click', () => {
        cloudExpanded = !cloudExpanded;
        // Straight to the repaint rather than through a settings round trip:
        // this is how much of one list you are looking at, not a filter.
        renderCloud(lastSkills);
      });
      cloudRow.appendChild(more);
    }

    paintCloudSelection();
  }

  amountInput.addEventListener('input', () => {
    const value = Number(amountInput.value);
    if (Number.isFinite(value)) emit({ thresholdUsdPerMonth: value });
  });

  // A discrete choice, so it applies at once rather than after the debounce.
  sortSelect.addEventListener('change', () => emit({ sortBy: sortSelect.value }, true));

  /*
   * Saving a search, from the place you decide it is worth saving.
   *
   * The name box only appears once asked for. Naming is not optional: a list of
   * searches called "Search 1" is a list nobody reads, and the name is the only
   * thing distinguishing them in the alerts list later.
   */
  const saveButton = bar.querySelector('.ojrf-save-search');
  const saveBox = bar.querySelector('.ojrf-save-box');
  const saveName = bar.querySelector('.ojrf-save-name');

  function closeSaveBox() {
    saveBox.hidden = true;
    saveButton.hidden = false;
    saveName.value = '';
  }

  saveButton.addEventListener('click', () => {
    saveButton.hidden = true;
    saveBox.hidden = false;
    saveName.focus();
  });

  bar.querySelector('.ojrf-save-cancel').addEventListener('click', closeSaveBox);

  saveName.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSaveBox();
    if (event.key === 'Enter') bar.querySelector('.ojrf-save-confirm').click();
  });

  bar.querySelector('.ojrf-save-confirm').addEventListener('click', async () => {
    const name = saveName.value.trim();
    if (name.length === 0) {
      saveName.focus();
      return;
    }
    closeSaveBox();
    // The caller owns storage and settings; the bar only asks and reports.
    const said = await onSaveSearch?.(name);
    if (said) setStatus(said);
  });

  bar.querySelector('.ojrf-settings').addEventListener('click', onOpenOptions);
  bar.querySelector('.ojrf-palette-open').addEventListener('click', () => onOpenPalette?.());
  bar.querySelector('.ojrf-presets-open').addEventListener('click', () => onOpenPresets?.());

  // Copying the whole list is a one-shot action with no state to keep, so the
  // button reports its own outcome and returns to itself.
  const copyAll = bar.querySelector('.ojrf-copy-all');
  copyAll.addEventListener('click', async () => {
    if (!onCopyAll) return;
    const count = await onCopyAll();
    copyAll.title =
      count > 0 ? `Copied ${count} listings` : 'Nothing to copy';
    copyAll.classList.add('ojrf-copied');
    setTimeout(() => {
      copyAll.classList.remove('ojrf-copied');
      copyAll.title = 'Copy every loaded listing as spreadsheet rows';
    }, 1600);
  });

  /** Reflect current settings and the latest pass over the listings. */
  function update(settings, result) {
    applyingExternalUpdate = true;
    amountInput.value = String(settings.thresholdUsdPerMonth);
    sortSelect.value = settings.sortBy;
    applyingExternalUpdate = false;

    searchTerms = settings.searchKeywords;
    renderTerms();

    activeSkills = settings.requiredSkills;
    renderCloud(result?.skills);

    hiddenTypes = settings.hiddenJobTypes;
    for (const [value, pill] of pills) {
      const shown = !hiddenTypes.includes(value);
      pill.classList.toggle('ojrf-pill-off', !shown);
      pill.setAttribute('aria-pressed', String(shown));
    }

    followUpsOn = Boolean(settings.onlyFollowUps);
    followUpPill.classList.toggle('ojrf-pill-choice-on', followUpsOn);
    followUpPill.classList.toggle('ojrf-pill-choice', !followUpsOn);
    followUpPill.setAttribute('aria-pressed', String(followUpsOn));

    for (const [value, pill] of levelPills) {
      const on = value === (settings.experienceFilter ?? 'all');
      pill.classList.toggle('ojrf-pill-choice-on', on);
      pill.setAttribute('aria-checked', String(on));
    }

    bar.classList.toggle('ojrf-off', !settings.enabled);

    if (!result) {
      count.textContent = '';
      detail.textContent = '';
    } else if (!settings.enabled) {
      count.textContent = `${result.total} listings`;
      detail.textContent = 'filter off';
    } else {
      count.textContent = `${result.hidden} of ${result.total} hidden`;
      // Every reason, in full. The line used to cap at three and fold the rest
      // into "+1 more", which hid the one tally people asked about - "61
      // assumed monthly" - behind a hover. Docked beside the site's own count
      // the line has the width, so it says everything.
      const everything = reasonParts(result.byReason);
      if (result.assumed > 0) everything.push(`${result.assumed} assumed monthly`);

      detail.textContent = everything.join(' · ');
      detail.title = everything.join(' · ');
    }
    refreshSummary();

    const messages = [];
    if (result?.warning) messages.push(result.warning);
    if (result?.source === 'structure') {
      messages.push('Using fallback detection - site markup may have changed.');
    }

    warning.textContent = messages.join(' ');
    warning.hidden = messages.length === 0;
  }

  /**
   * Mount inside the results container rather than before it.
   *
   * The container carries the page's own gutter (pr-md-3), so a bar placed
   * outside it ends up wider than every listing card - visibly flush against the
   * right edge while the cards are inset. Inside, alignment is inherited.
   */
  function mount(container) {
    if (document.getElementById(BAR_ID)) return;
    if (container) {
      container.insertBefore(bar, container.firstChild);
    } else {
      bar.classList.add('ojrf-floating');
      document.body.appendChild(bar);
    }
  }

  /**
   * Transient note about fetching, shown beside the counts.
   * `loading` adds a spinner, so a slow search reads as working rather than stuck.
   */
  function setStatus(text, loading = false) {
    status.textContent = '';
    status.hidden = !text;
    if (!text) return;

    if (loading) {
      const spinner = document.createElement('span');
      spinner.className = 'ojrf-spinner';
      status.appendChild(spinner);
    }
    status.append(text);
    status.classList.toggle('ojrf-status-loading', loading);
    refreshSummary();
  }

  /**
   * Paint the tick from settings.
   *
   * Called on every update, including ones this control did not cause - the
   * setting can be flipped from the options page or another tab, and the row
   * has to agree with what is actually running.
   */
  function setAutoRefresh({ enabled, minutes }) {
    autoOn.checked = Boolean(enabled);
    autoWrap.classList.toggle('is-on', Boolean(enabled));
    autoEvery.disabled = !enabled;

    const wanted = String(minutes);
    // An interval that is no longer on the list (an older build, a hand-edited
    // store) would otherwise leave the select blank and read as "never".
    autoEvery.value = REFRESH_INTERVALS.some((entry) => String(entry.value) === wanted)
      ? wanted
      : '5';
  }

  /** Take the summary back from wherever it was docked, into its own place. */
  function reclaimSummary() {
    if (summary.parentElement === bar) return;
    bar.querySelector('.ojrf-row').after(summary);
  }

  return {
    mount,
    update,
    setStatus,
    setAutoRefresh,
    reclaimSummary,
    element: bar,
    // Exposed so they can be relocated: the two long rows suit the page's
    // sidebar better than a scrolling strip in the bar, and the summary belongs
    // beside the count line it explains.
    rows: {
      skills: bar.querySelector('.ojrf-row-skills'),
      types: bar.querySelector('.ojrf-row-pills'),
      level: bar.querySelector('.ojrf-row-level'),
      summary,
    },
  };
}
