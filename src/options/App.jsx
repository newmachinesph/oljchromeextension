import { useState, useEffect } from 'react';
import { Alerts } from './Alerts.jsx';
import { BlockedEmployers } from './BlockedEmployers.jsx';
import { Presets } from './Presets.jsx';
import { EXPERIENCE_FILTERS } from '../core/experience-level.js';
import { SHIFT_OPTIONS } from '../core/shift.js';
import { useSettings } from './use-settings.js';
import {
  Tabs,
  Section,
  NumberField,
  ToggleField,
  RadioField,
  CheckboxGroupField,
  KeywordsField,
} from './fields.jsx';
import { JOB_TYPES, GROUP_POSITIONS, REFRESH_INTERVALS } from '../core/settings.js';
import { SORT_MODES } from '../core/sort.js';
import { loadDismissedList, clearDismissed } from '../core/dismissed.js';
import { loadViewedList, clearViewed } from '../core/viewed.js';
import {
  loadApplications,
  clearApplications,
  APPLICATION_STATUSES,
} from '../core/applications.js';
import { loadStats, clearStats, sampleCount, MIN_SAMPLES } from '../core/benchmark.js';
import {
  loadSearches,
  removeSearch,
  saveSearch,
  filtersFromSettings,
  settingsFromSearch,
  describeSearch,
} from '../core/saved-searches.js';
import { loadHistory, clearHistory, STALE_WEEKS } from '../core/history.js';
import { RatePreview } from './RatePreview.jsx';
import { CustomRules } from './CustomRules.jsx';
import { Vocabulary } from './Vocabulary.jsx';
import { About } from './About.jsx';
import { Profiles } from './Profiles.jsx';
import { Backup } from './Backup.jsx';
import { DockSettings } from './DockSettings.jsx';
import { TimeTracker } from './TimeTracker.jsx';
import { Pomodoro } from './Pomodoro.jsx';
import { Clocks } from './Clocks.jsx';
import { SavedJobs } from './SavedJobs.jsx';
import { SalaryCalculator } from './SalaryCalculator.jsx';
import { Snippets } from './Snippets.jsx';
import { Account } from './Account.jsx';

/**
 * The groups, in the order you are likely to want them: what gets hidden, then
 * how rates are read, then the escape hatch for formats we read wrongly, then
 * how much is loaded, then how it all looks.
 */
const TABS = [
  { id: 'filter', label: 'Filter' },
  { id: 'presets', label: 'Presets' },
  { id: 'profile', label: 'Profiles' },
  { id: 'saved', label: 'Saved' },
  { id: 'snippets', label: 'Snippets' },
  { id: 'calculator', label: 'Calculator' },
  { id: 'tools', label: 'Tools' },
  { id: 'rates', label: 'Reading rates' },
  { id: 'rules', label: 'Custom parsers' },
  { id: 'results', label: 'Results' },
  { id: 'display', label: 'Display' },
  { id: 'dock', label: 'Dock' },
  { id: 'backup', label: 'Backup' },
  { id: 'account', label: 'Account' },
];

/**
 * How many jobs you have dismissed, and the way to forget them.
 *
 * Its own component because the list lives in chrome.storage.local rather than
 * in settings - it is a record of what you have done, not a preference.
 */
function DismissedCount() {
  const [count, setCount] = useState(null);

  useEffect(() => {
    loadDismissedList().then((list) => setCount(list.length));
  }, []);

  if (count === null) return null;

  return (
    <div className="field">
      <p className="field-hint">
        {count === 0
          ? 'You have not dismissed any jobs yet.'
          : `${count.toLocaleString('en-US')} job${count === 1 ? '' : 's'} dismissed.`}
      </p>
      {count > 0 && (
        <button
          type="button"
          className="reset"
          onClick={async () => {
            await clearDismissed();
            setCount(0);
          }}
        >
          Forget all dismissed jobs
        </button>
      )}
    </div>
  );
}

/**
 * How many jobs have been recorded as viewed, and the way to forget them.
 *
 * Hide-viewed can quietly bury hundreds of jobs; like the dismissed list, that
 * deserves a visible count and a one-click way to start it over.
 */
function ViewedCount() {
  const [count, setCount] = useState(null);

  useEffect(() => {
    loadViewedList().then((list) => setCount(list.length));
  }, []);

  if (count === null || count === 0) return null;

  return (
    <div className="field">
      <p className="field-hint">
        {count.toLocaleString('en-US')} job{count === 1 ? '' : 's'} recorded as viewed.
      </p>
      <button
        type="button"
        className="reset"
        onClick={async () => {
          await clearViewed();
          setCount(0);
        }}
      >
        Forget all viewed jobs
      </button>
    </div>
  );
}

/**
 * How many applications are on record, and the way to forget them.
 *
 * Its own component for the same reason DismissedCount is: the list lives in
 * chrome.storage.local, not in settings - it is a log of what you did.
 */
function ApplicationCount() {
  const [counts, setCounts] = useState(null);

  useEffect(() => {
    loadApplications().then((applications) => {
      const tally = {};
      for (const record of applications.values()) {
        tally[record.status] = (tally[record.status] ?? 0) + 1;
      }
      setCounts({ total: applications.size, tally });
    });
  }, []);

  if (counts === null) return null;

  const breakdown = APPLICATION_STATUSES.filter((s) => counts.tally[s.value] > 0)
    .map((s) => `${counts.tally[s.value]} ${s.label.toLowerCase()}`)
    .join(' · ');

  return (
    <div className="field">
      <p className="field-hint">
        {counts.total === 0
          ? 'No applications recorded yet. One is saved when you open a job’s apply page from the modal.'
          : `${counts.total.toLocaleString('en-US')} recorded — ${breakdown}.`}
      </p>
      {counts.total > 0 && (
        <button
          type="button"
          className="reset"
          onClick={async () => {
            await clearApplications();
            setCounts({ total: 0, tally: {} });
          }}
        >
          Forget all applications
        </button>
      )}
    </div>
  );
}

/**
 * How much the benchmark has learned, and the way to make it forget.
 *
 * The wording is deliberate about what is stored: people are right to ask what
 * a tool that "learns from your browsing" is keeping, and the honest answer -
 * counts per pay band, no jobs, no titles, no employers - is also the
 * reassuring one, so it is said outright rather than buried in a privacy note.
 */
function BenchmarkStats() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    loadStats().then(setStats);
  }, []);

  if (stats === null) return null;

  const total = sampleCount(stats.all);
  const skills = Object.keys(stats.skills).length;

  return (
    <div className="field">
      <p className="field-hint">
        {total < MIN_SAMPLES
          ? `${total.toLocaleString('en-US')} rates recorded so far — comparisons start once there are ${MIN_SAMPLES}.`
          : `${total.toLocaleString('en-US')} rates recorded across ${skills.toLocaleString('en-US')} skill${skills === 1 ? '' : 's'}. Only counts per pay band are kept — no jobs, titles or employers.`}
      </p>
      {total > 0 && (
        <button
          type="button"
          className="reset"
          onClick={async () => {
            setStats(await clearStats());
          }}
        >
          Forget what it has learned
        </button>
      )}
    </div>
  );
}


/**
 * Named filter sets, and the four shipped ones.
 *
 * The list lives in chrome.storage.local rather than in settings, the same as
 * dismissals and applications: it is a set of records, not a preference.
 *
 * Presets are offered here as much as in the palette, because the hard part is
 * not switching between searches - it is knowing that automation work is
 * advertised as "n8n" and "GHL" before you have ever seen the word on a card.
 */
function SavedSearches({ settings, update }) {
  const [searches, setSearches] = useState(null);
  const [name, setName] = useState('');

  useEffect(() => {
    loadSearches().then(setSearches);
  }, []);

  if (searches === null) return null;

  const apply = (search) => update(settingsFromSearch(search, settings));

  const save = async () => {
    if (!name.trim()) return;
    setSearches(await saveSearch(name, filtersFromSettings(settings), Date.now()));
    setName('');
  };

  return (
    <>
      <div className="field">
        <span className="field-label">Save what you are using now</span>
        <p className="field-hint">
          Captures the threshold, search terms, required skills, excluded keywords, job types and
          age limit — not how the results look, so switching searches never undoes your display
          choices. Saving under a name you already used replaces it.
        </p>
        <div className="search-row">
          <input
            type="text"
            className="text-input"
            value={name}
            placeholder="e.g. Automation work"
            aria-label="Name for this search"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && save()}
          />
          <button type="button" onClick={save} disabled={!name.trim()}>
            Save
          </button>
        </div>
      </div>

      {searches.length > 0 && (
        <div className="field">
          <span className="field-label">Your searches</span>
          <ul className="search-list">
            {searches.map((search) => (
              <li key={search.name} className="search-row">
                <span className="search-main">
                  <strong>{search.name}</strong>
                  {describeSearch(search) && <em> — {describeSearch(search)}</em>}
                </span>
                <button type="button" onClick={() => apply(search)}>
                  Apply
                </button>
                <button
                  type="button"
                  className="reset"
                  onClick={async () => setSearches(await removeSearch(search.name))}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        The shipped presets used to be listed here too. They live in the
        "Start from a preset" panel (and the picker on the results page), and
        two Apply lists that overwrite your filters is one more than anyone
        needs - so this section is now only about searches you saved yourself.
      */}
    </>
  );
}


/**
 * How many roles it has been following, and the way to forget them.
 *
 * Worth stating what is kept, since "we remember what you have seen" invites
 * the question: dates against a signature, never a title or a URL.
 */
function HistoryCount() {
  const [count, setCount] = useState(null);

  useEffect(() => {
    loadHistory().then((history) => setCount(Object.keys(history).length));
  }, []);

  if (count === null) return null;

  return (
    <div className="field">
      <p className="field-hint">
        {count === 0
          ? 'Nothing tracked yet — a role has to appear on two different days before there is anything to say.'
          : `Following ${count.toLocaleString('en-US')} role${count === 1 ? '' : 's'}. Only a first-seen date is kept against each — no titles, employers or links.`}
      </p>
      {count > 0 && (
        <button
          type="button"
          className="reset"
          onClick={async () => {
            await clearHistory();
            setCount(0);
          }}
        >
          Forget how long jobs have been posted
        </button>
      )}
    </div>
  );
}

/**
 * The Conversion section's currency grid, one row per currency. Steps and
 * ceilings differ per currency - yen and won are quoted in the hundreds and
 * thousands - and the pegged pair is marked so nobody wonders why it never
 * needs correcting.
 */
const FX_ROWS = [
  { code: 'PHP', key: 'fxPhpPerUsd', name: 'Philippine peso', min: 1, max: 1000, step: 0.1 },
  { code: 'AUD', key: 'fxAudPerUsd', name: 'Australian dollar', min: 1, max: 100, step: 0.01 },
  { code: 'CAD', key: 'fxCadPerUsd', name: 'Canadian dollar', min: 0.01, max: 100, step: 0.01 },
  { code: 'GBP', key: 'fxGbpPerUsd', name: 'British pound', min: 0.01, max: 100, step: 0.01 },
  { code: 'EUR', key: 'fxEurPerUsd', name: 'Euro', min: 0.01, max: 100, step: 0.01 },
  { code: 'NZD', key: 'fxNzdPerUsd', name: 'New Zealand dollar', min: 0.01, max: 100, step: 0.01 },
  { code: 'AED', key: 'fxAedPerUsd', name: 'UAE dirham', min: 0.01, max: 100, step: 0.01, pegged: true },
  { code: 'SGD', key: 'fxSgdPerUsd', name: 'Singapore dollar', min: 0.01, max: 100, step: 0.01 },
  { code: 'HKD', key: 'fxHkdPerUsd', name: 'Hong Kong dollar', min: 0.01, max: 100, step: 0.01, pegged: true },
  { code: 'NOK', key: 'fxNokPerUsd', name: 'Norwegian krone', min: 0.01, max: 100, step: 0.1 },
  { code: 'THB', key: 'fxThbPerUsd', name: 'Thai baht', min: 0.01, max: 1000, step: 0.5 },
  { code: 'JPY', key: 'fxJpyPerUsd', name: 'Japanese yen', min: 1, max: 100000, step: 1 },
  { code: 'KRW', key: 'fxKrwPerUsd', name: 'South Korean won', min: 1, max: 1000000, step: 10 },
];

export function App() {
  const { settings, update, reset, loading, savedAt } = useSettings();
  const [tab, setTab] = useState(TABS[0].id);
  const [confirmingReset, setConfirmingReset] = useState(false);

  if (loading) {
    return (
      <main className="app">
        <p className="loading">Loading settings...</p>
      </main>
    );
  }

  const on = (id) => (tab === id ? {} : { hidden: true });

  return (
    <main className="app">
      <header className="header">
        <h1>OljExtension</h1>
        <p>
          Power tools for an OnlineJobs.ph job hunt — rate filtering, red-flag
          checks and an application tracker. Everything runs on your machine; an
          account only adds the AI features.
        </p>
      </header>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <div className="panel" {...on('filter')}>
      <Section title="Filter" description="Everything is compared as US dollars per month.">
        <ToggleField
          label="Filter enabled"
          hint="Turning this off restores every listing on the page."
          checked={settings.enabled}
          onChange={(value) => update({ enabled: value })}
        />
        <NumberField
          label="Hide below"
          hint="Listings worth less than this are collapsed to a one-line stub."
          value={settings.thresholdUsdPerMonth}
          min={0}
          max={100000}
          step={25}
          suffix="USD / month"
          onChange={(value) => update({ thresholdUsdPerMonth: value })}
        />
        <NumberField
          label="Hide above"
          hint="Listings worth more than this are collapsed too — for narrowing to a pay band. Leave at 0 for no ceiling."
          value={settings.maxUsdPerMonth}
          min={0}
          max={1000000}
          step={100}
          suffix="USD / month"
          onChange={(value) => update({ maxUsdPerMonth: value })}
        />
        {settings.maxUsdPerMonth > 0 &&
          settings.maxUsdPerMonth <= settings.thresholdUsdPerMonth && (
            <p className="field-warning">
              “Hide above” ({settings.maxUsdPerMonth.toLocaleString('en-US')}) is not above “hide
              below” ({settings.thresholdUsdPerMonth.toLocaleString('en-US')}), so the ceiling is
              ignored — otherwise every priced job would be hidden.
            </p>
          )}
      </Section>

      <Section
        title="Listings without a usable rate"
        description="These are kept visible by default, because hiding what we could not read is how a good job disappears."
      >
        <ToggleField
          label="Hide listings with no rate stated"
          hint={'Covers "TBD", "TBA", "To be discussed", and an empty rate field - the employer has not decided.'}
          checked={settings.hideNoRate}
          onChange={(value) => update({ hideNoRate: value })}
        />
        <ToggleField
          label="Hide listings whose rate is negotiable"
          hint={'"Negotiable", "DOE", "Based on Experience", "Commensurate with experience". Kept separate from the setting above because these are the unpriced listings where the figure could still land high - it depends on what you bring, not on the employer having decided.'}
          checked={settings.hideNegotiable}
          onChange={(value) => update({ hideNegotiable: value })}
        />
        <ToggleField
          label="Hide listings whose rate we could not read"
          hint={'A figure is given but not convertible - a bare "800" with no currency, or "$6-$12" with no period.'}
          checked={settings.hideUnclearRate}
          onChange={(value) => update({ hideUnclearRate: value })}
        />
        <ToggleField
          label="Hide per-task and fixed-price work"
          hint={'Piecework rather than salary: "$1-$5 per approved comment", "$10 per 100 images", "$150 fixed price".'}
          checked={settings.hideTaskBased}
          onChange={(value) => update({ hideTaskBased: value })}
        />
        <NumberField
          label="…or keep gigs paying at least"
          hint="Show gigs and fixed-price work, but hide the ones whose fee is below this. Leave at 0 to show them all. Ignored when the toggle above is on (that hides every gig)."
          value={settings.minFixedFeeUsd}
          min={0}
          max={1000000}
          step={25}
          suffix="USD"
          onChange={(value) => update({ minFixedFeeUsd: value })}
        />
      </Section>

      <Section
        title="What changed"
        description="Turning a merged list of hundreds into the handful you have not read."
      >
        <ToggleField
          label="Show only listings posted since my last visit"
          hint="A reload does not count as a visit — the marker only moves once you have been away for half an hour, so the set does not empty out while you are reading it."
          checked={settings.onlyNew}
          onChange={(value) => update({ onlyNew: value })}
        />
        <ToggleField
          label="Mark new listings with a chip"
          hint="A listing with no posting date is never marked new: we cannot tell, and guessing would pad the one list you are trusting to be short."
          checked={settings.showNewChip}
          onChange={(value) => update({ showNewChip: value })}
        />
      </Section>

      <Section
        title="Saved searches"
        description="A search here is a set of filters and, mostly, a vocabulary. Name yours, or start from one of ours."
      >
        <SavedSearches settings={settings} update={update} />
      </Section>

      <Section
        title="Alerts"
        description="New listings for a saved search, counted while you are away. Opt-in, and the one thing here that asks for a permission."
      >
        <Alerts settings={settings} update={update} />
      </Section>

      <Section
        title="Warnings"
        description="Every other rule here asks whether a job is worth your time. These ask whether it will cost you."
      >
        <ToggleField
          label="Warn about terms that cost the applicant"
          hint="Flags placement and registration fees, unpaid trials and training, commission-only work advertised with a salary-sized number, payment in exposure, and being moved to Telegram or WhatsApp before hiring. Matched on specific phrases, never single words — 'commission only' is a flag, 'plus commission' is not, because telling you a real job is a scam is its own kind of harm."
          checked={settings.showRedFlags}
          onChange={(value) => update({ showRedFlags: value })}
        />
        <ToggleField
          label="Hide flagged listings entirely"
          hint="Off by default. A warning you can read and overrule is useful; a listing removed without explanation teaches you nothing, and some of these are worth taking with your eyes open."
          checked={settings.hideRedFlagged}
          onChange={(value) => update({ hideRedFlagged: value })}
        />
      </Section>

      <Section
        title="Employers"
        description="Who is posting, and what they have posted more than once."
      >
        <ToggleField
          label="Collapse a job the page has already shown"
          hint="The same employer posting the same role twice - measured at 12 employers accounting for 33 of 180 listings on one merged page. Matched on employer and title with the pay discounted, since a repost often has the figure nudged. Never on title alone: two employers advertising 'Construction Estimator' are two jobs, and hiding a job that was never a duplicate costs more than showing one that is. The first copy is kept and still faces every other rule."
          checked={settings.hideReposts}
          onChange={(value) => update({ hideReposts: value })}
        />
        <ToggleField
          label="Mark how long a role has been advertised"
          hint={`A job posted again every month is one that everybody who applied turned down or left. Reposts get new links, so this follows the employer and title instead, and says nothing until a role has been around ${STALE_WEEKS} weeks.`}
          checked={settings.showStaleness}
          onChange={(value) => update({ showStaleness: value })}
        />
        <HistoryCount />
        <ToggleField
          label="Collapse every listing from an employer I blocked"
          hint="Block an employer from a job's details. Everything they post collapses, on every visit, until you unblock them here."
          checked={settings.hideBlockedEmployers}
          onChange={(value) => update({ hideBlockedEmployers: value })}
        />
        <BlockedEmployers />
        <ToggleField
          label="Mark listings from an employer posting several jobs"
          hint="Adds a small tally chip, with the employer's name on hover. Counted across everything currently loaded, so merging more pages makes it more informative."
          checked={settings.showEmployerChip}
          onChange={(value) => update({ showEmployerChip: value })}
        />
      </Section>

      <Section
        title="Experience level"
        description="What the listing says about who it is for. Most say nothing, and those get no chip and are never filtered by this."
      >
        <ToggleField
          label="Say when a listing is beginner-friendly, or wants experience"
          hint="Read from the card: 'no experience needed', 'we will train', 'fresh graduates welcome' mark it beginner-friendly; years of experience, a portfolio, 'experienced only' or a senior title mark it experienced. A requirement beats a welcome, since 'two years experience, willing to learn' means the two years. The modal reads the full description and says if it differs."
          checked={settings.showExperienceChip}
          onChange={(value) => update({ showExperienceChip: value })}
        />
        <RadioField
          label="Filter by level"
          hint="'Beginner-friendly' keeps only listings that say so - the ones that say nothing go too, because you asked for the ones that say so. 'Hide experienced-only' removes only listings that state a requirement."
          name="experienceFilter"
          value={settings.experienceFilter}
          options={EXPERIENCE_FILTERS}
          onChange={(value) => update({ experienceFilter: value })}
        />
      </Section>

      <Section title="Job type and freshness">
        <CheckboxGroupField
          label="Hide these job types"
          hint="Tick a type to hide it. Leave all unticked to see everything."
          value={settings.hiddenJobTypes}
          options={JOB_TYPES}
          onChange={(value) => update({ hiddenJobTypes: value })}
        />
        <RadioField
          label="Shift"
          hint="Hide the shift you cannot take, read from the words: 'night shift', 'US hours', 'EST' mark night work; 'day shift', 'PH time', 'Manila time' mark day work. A post that never says which is always kept — guessing would bury good jobs."
          name="shiftFilter"
          value={settings.shiftFilter}
          options={SHIFT_OPTIONS}
          onChange={(value) => update({ shiftFilter: value })}
        />
        <NumberField
          label="Hide older than"
          hint="Counted from the posting date on each listing. 0 turns this off."
          value={settings.maxAgeDays}
          min={0}
          max={3650}
          step={1}
          suffix="days (0 = any age)"
          onChange={(value) => update({ maxAgeDays: value })}
        />
        <KeywordsField
          label="Keep only listings matching"
          hint="Checked against the title and the skill chips on each card, entirely in the page. The site's own skill filter is keyed by numeric skill IDs, so this deliberately does not use it. Leave empty for no restriction."
          placeholder="e.g. real estate, data entry, bookkeeping"
          value={settings.requiredSkills}
          onChange={(value) => update({ requiredSkills: value })}
        />
        <KeywordsField
          label="Hide titles containing"
          hint="Comma-separated, case-insensitive. Matched against the job title only."
          placeholder="e.g. appointment setter, cold call, commission"
          value={settings.excludeKeywords}
          onChange={(value) => update({ excludeKeywords: value })}
        />
      </Section>

      <Section
        title="Dismissed jobs"
        description="Listings you have looked at and decided against, by hand."
      >
        <ToggleField
          label="Collapse jobs I have dismissed"
          hint="Dismiss a listing with the × on its chip row, or from the job page itself. It stays collapsed on every later visit until you restore it."
          checked={settings.hideDismissed}
          onChange={(value) => update({ hideDismissed: value })}
        />
        <ToggleField
          label="Collapse jobs I have already opened"
          hint="Off by default. On, any job you have opened is collapsed on later visits, so a daily scan shows only what is genuinely new. A job you applied to or dismissed keeps that more specific reason instead."
          checked={settings.hideViewed}
          onChange={(value) => update({ hideViewed: value })}
        />
        <ViewedCount />
        <DismissedCount />
      </Section>

      <Section
        title="Applications"
        description="Jobs you applied to, and where each one got to."
      >
        <ToggleField
          label="Collapse jobs I have already applied to"
          hint="Off by default: seeing that you applied is usually the point, and the chip on the card says so without taking the listing away. On, the list becomes what is left to do."
          checked={settings.hideApplied}
          onChange={(value) => update({ hideApplied: value })}
        />
        <NumberField
          label="Remind me to follow up after"
          hint="An application still marked Applied after this many days gets a chip on its card, a count on the toolbar icon, and a line in the popup. Pressing 'Followed up' on the job restarts the clock without changing the status - a nudge is not a reply."
          value={settings.followUpDays}
          min={1}
          max={60}
          suffix="days"
          onChange={(value) => update({ followUpDays: value })}
        />
        <ToggleField
          label="Mark cards whose application is due a follow-up"
          checked={settings.showFollowUpChip}
          onChange={(value) => update({ showFollowUpChip: value })}
        />
        <ApplicationCount />
      </Section>
      </div>

      <div className="panel" {...on('presets')}>
        <Section
          title="Start from a preset"
          description="Starting points you can make your own: copy one, edit a shipped one in place, or write a new one. An edit only shadows the original, so reverting always brings it back."
        >
          <Presets onApply={(preset) => update(settingsFromSearch(preset, settings))} />
        </Section>
      </div>

      <div className="panel" {...on('profile')}>
        <Section
          title="About you"
          description="Shared by every profile. Kept on this machine; only the parts a draft needs are ever sent, and never your email or phone."
        >
          <About />
        </Section>
        <Section
          title="Profiles"
          description="A profile per specialization (VA, data entry, bookkeeping…). Pick one when you draft. Import a résumé from a PDF, Word, or text file — converted here, never uploaded."
        >
          <Profiles />
        </Section>
      </div>

      <div className="panel" {...on('saved')}>
        <Section
          title="Saved jobs"
          description="Jobs you set aside to come back to, with a private note and tags on each. Save one from the job itself; everything here stays on this machine."
        >
          <SavedJobs />
        </Section>
      </div>

      <div className="panel" {...on('snippets')}>
        <Section
          title="Text snippets"
          description="Your own reusable text — an intro, a stock answer to “what’s your internet speed”, the subject line a post demanded. Write it once, copy it when you apply. Everything here stays on this machine."
        >
          <Snippets />
        </Section>
      </div>

      <div className="panel" {...on('calculator')}>
        <Section
          title="Salary calculator"
          description="Convert any pay figure between currencies and pay periods, using the same exchange rates as the badges on the job list."
        >
          <SalaryCalculator />
        </Section>
      </div>

      <div className="panel" {...on('rates')}>
      <Section
        title="Conversion"
        description="How other currencies and pay periods become USD per month."
      >
        {/*
          One compact grid instead of thirteen stacked fields. The currencies
          differ only in code, step and ceiling, and a table is how you read
          rates side by side; each cell still writes its own settings key on
          every edit, exactly as the fields did.
        */}
        <div className="field">
          <span className="field-label">Exchange rates</span>
          <table className="fx-table">
            <thead>
              <tr>
                <th scope="col">Currency</th>
                <th scope="col">Per $1</th>
              </tr>
            </thead>
            <tbody>
              {FX_ROWS.map((fx) => (
                <tr key={fx.key}>
                  <th scope="row">
                    <span className="fx-code">{fx.code}</span>
                    <span className="fx-name">{fx.name}</span>
                    {fx.pegged && <span className="fx-peg">pegged</span>}
                  </th>
                  <td>
                    <input
                      type="number"
                      aria-label={`${fx.code} per 1 USD`}
                      value={settings[fx.key]}
                      min={fx.min}
                      max={fx.max}
                      step={fx.step}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isFinite(next)) update({ [fx.key]: next });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <span className="field-hint">
            Units per 1 USD — the same rates the badges use. Set by hand on purpose: the extension
            never calls out for a rate. The defaults were checked against market rates on
            2026-08-29; “Reset all settings” brings them back.
          </span>
        </div>
        <NumberField
          label="Hours per month"
          hint="Turns an hourly rate into a monthly one. 160 is roughly full time."
          value={settings.hoursPerMonth}
          min={1}
          max={744}
          step={1}
          suffix="hours"
          onChange={(value) => update({ hoursPerMonth: value })}
        />
        <NumberField
          label="Days per month"
          hint="Used only for rates quoted per day."
          value={settings.daysPerMonth}
          min={1}
          max={31}
          step={1}
          suffix="days"
          onChange={(value) => update({ daysPerMonth: value })}
        />
      </Section>

      <Section title="Ranges" description={'How to judge a listing like "$300-$500/month".'}>
        <RadioField
          label="Judge a range by its"
          name="rangeBasis"
          value={settings.rangeBasis}
          hint="High end is the forgiving choice: a job that might clear your bar stays visible."
          options={[
            { value: 'high', label: 'High end (recommended)' },
            { value: 'low', label: 'Low end (stricter)' },
          ]}
          onChange={(value) => update({ rangeBasis: value })}
        />
        <RadioField
          label="Show a range as"
          name="rangeDisplay"
          value={settings.rangeDisplay}
          hint="What the badge prints. Separate from the setting above, which decides the end the filter judges by — wanting to be judged forgivingly on the high end while still reading the whole spread is a reasonable pair of preferences."
          options={[
            { value: 'high', label: 'The high end — $6,700/mo' },
            { value: 'low', label: 'The low end — $5,500/mo' },
            { value: 'range', label: 'The whole range — $5,500–$6,700/mo' },
          ]}
          onChange={(value) => update({ rangeDisplay: value })}
        />
      </Section>

      <Section
        title="Listings with no stated period"
        description={
          'Most listings just say "$600" or "USD 450 - USD 500", with no /month or /hour.'
        }
      >
        <ToggleField
          label="Read an unstated period as monthly"
          hint="Off means these can never be hidden - on this site that is most of the page."
          checked={settings.assumeMonthlyWhenUnstated}
          onChange={(value) => update({ assumeMonthlyWhenUnstated: value })}
        />
        <NumberField
          label="Monthly above / hourly below"
          hint="The split point. $600 an hour would be $96,000 a month, and $5 a month is nobody's salary, so one number separates the two readings."
          value={settings.assumeMonthlyMinUsd}
          min={1}
          max={100000}
          step={10}
          suffix="USD"
          onChange={(value) => update({ assumeMonthlyMinUsd: value })}
        />
        <ToggleField
          label="Read a small amount as an hourly rate"
          hint={'A bare "5" on a full-time listing means $5 an hour, not $5 a month.'}
          checked={settings.assumeHourlyWhenSmall}
          onChange={(value) => update({ assumeHourlyWhenSmall: value })}
        />
        <ToggleField
          label="Fall back to a yearly reading"
          hint={'When a monthly reading lands past the ceiling below, try a year before giving up. "17000 USD" with no period is not a monthly salary here but is an ordinary annual one — off, it resolves to nothing and the listing is invisible to the filter; on, it reads as ~$1,417/month.'}
          checked={settings.assumeYearlyWhenTooLarge}
          onChange={(value) => update({ assumeYearlyWhenTooLarge: value })}
        />
        <NumberField
          label="Highest assumable hourly rate"
          hint={'The platform caps applicants at $30 an hour, so an assumed hourly rate above that is impossible rather than merely unlikely - "60.00" read as hourly claimed $9,600 a month. Above this the amount is left unresolved and the listing stays visible. A rate the employer states outright is always taken at face value.'}
          value={settings.assumeHourlyMaxUsd}
          min={1}
          max={10000}
          step={1}
          suffix="USD / hour"
          onChange={(value) => update({ assumeHourlyMaxUsd: value })}
        />
        <ToggleField
          label="Read an amount with no currency as US dollars"
          hint="This site's convention. Assumed rates are badged with ~ rather than =."
          checked={settings.assumeUsdWhenNoCurrency}
          onChange={(value) => update({ assumeUsdWhenNoCurrency: value })}
        />
        <NumberField
          label="…dollars below, pesos above"
          hint={'The magnitude split for a figure with no currency. A bare "42,000" is a peso salary; nobody advertises $42,000 a month here.'}
          value={settings.assumeUsdMaxAmount}
          min={1}
          max={10000000}
          step={500}
          onChange={(value) => update({ assumeUsdMaxAmount: value })}
        />
        <ToggleField
          label="Read a large amount with no currency as pesos"
          hint="Off leaves those unread and visible instead. This was the single biggest gap found when sweeping 1,752 live listings."
          checked={settings.assumePhpAboveCeiling}
          onChange={(value) => update({ assumePhpAboveCeiling: value })}
        />
        <NumberField
          label="Discard guesses above"
          hint={'A guess landing on an implausible salary was the wrong guess. "$80 USD" read as hourly would be $12,800 a month, so it is dropped and the listing stays visible. Rates the listing states outright are never capped.'}
          value={settings.assumedMaxUsdPerMonth}
          min={100}
          max={1000000}
          step={500}
          suffix="USD / month"
          onChange={(value) => update({ assumedMaxUsdPerMonth: value })}
        />
      </Section>

      </div>

      <div className="panel" {...on('rules')}>
        <Section
          title="Your own rules"
          description="Teach the extension a rate format it does not know."
        >
          <CustomRules
            settings={settings}
            onChange={(value) => update({ customRules: value })}
          />
        </Section>

        <Section
          title="Built-in parser"
          description="Every word the shipped parser recognises, and yours to change."
        >
          <Vocabulary
            vocabulary={settings.vocabulary}
            onChange={(value) => update({ vocabulary: value })}
          />
        </Section>

        <RatePreview settings={settings} />
      </div>

      <div className="panel" {...on('results')}>
      <Section
        title="Merging pages"
        description="The site shows 30 listings at a time. A strict filter can leave two or three, then you page again."
      >
        <KeywordsField
          label="Also search for"
          hint="Comma-separated. Each is a separate site search, fetched together and combined into one deduplicated list — so 'virtual assistant, data entry, admin support' is one pass instead of three. Editable from the bar too."
          placeholder="e.g. virtual assistant, data entry, customer support"
          value={settings.searchKeywords}
          onChange={(value) => update({ searchKeywords: value })}
        />
        <NumberField
          label="Also load the next"
          hint="Merged into one list, so you filter across all of them at once. Pages load strictly one at a time, and every search term above is its own site search — terms × pages is the real request count, which is why the default is one. Five is the max; 0 leaves the page as the site built it."
          value={settings.prefetchPages}
          min={0}
          max={5}
          step={1}
          suffix="pages (0 = off)"
          onChange={(value) => update({ prefetchPages: value })}
        />
      </Section>

      <Section title="Order">
        <RadioField
          label="Order"
          name="sortBy"
          value={settings.sortBy}
          hint="Ranking by rate uses the same converted figure the badges show; listings whose rate could not be read sort last either way. Site order is roughly newest-first, which is what you want when checking back daily."
          options={SORT_MODES}
          onChange={(value) => update({ sortBy: value })}
        />
        <RadioField
          label="Hidden listings"
          name="groupHiddenAt"
          value={settings.groupHiddenAt}
          hint="Gathering them into one block keeps the listings still worth reading contiguous, instead of broken up by stubs. Not shown at all drops them silently — the count stays on the control bar, so you can still see how many were filtered."
          options={GROUP_POSITIONS}
          onChange={(value) => update({ groupHiddenAt: value })}
        />
      </Section>
      </div>

      <div className="panel" {...on('display')}>
      <Section title="Display">
        <ToggleField
          label="Show a converted-rate badge on each listing"
          hint={'Adds a small "= $520/mo" tag so you can check the parser as you browse.'}
          checked={settings.showBadges}
          onChange={(value) => update({ showBadges: value })}
        />
        <ToggleField
          label="Show the extension's strip on a job's own page"
          hint="Under the site's facts card, one row of ours: the rate in USD per month, whether the description reads as beginner-friendly, anything to be careful of, where your application stands, and the dismiss control. Off, the job page is left exactly as the site built it."
          checked={settings.jobPageBar}
          onChange={(value) => update({ jobPageBar: value })}
        />
        <ToggleField
          label="Watch for new listings while the tab is open"
          hint="Re-reads the first page of your search on a timer and puts anything new at the top, marked so you can spot it. One page per check, and nothing at all while the tab is in the background."
          checked={settings.autoRefresh}
          onChange={(value) => update({ autoRefresh: value })}
        />
        {settings.autoRefresh && (
          <RadioField
            label="How often to check"
            name="auto-refresh-minutes"
            value={String(settings.autoRefreshMinutes)}
            options={REFRESH_INTERVALS.map((entry) => ({
              value: String(entry.value),
              label: entry.label,
            }))}
            onChange={(value) => update({ autoRefreshMinutes: Number(value) })}
          />
        )}
        <ToggleField
          label="Lay out markdown in a job description"
          hint="Employers often paste markdown into the description box and the site shows the raw punctuation. On, the modal renders those headings, bullets and bold text as structure. Descriptions with no markdown in them are left exactly as they are."
          checked={settings.formatDescription}
          onChange={(value) => update({ formatDescription: value })}
        />
        <ToggleField
          label="Use the full window width"
          hint="The site caps the results area at a fixed container width, which wastes most of a wide screen. Only the results section is widened; the header and footer keep their own layout."
          checked={settings.wideLayout}
          onChange={(value) => update({ wideLayout: value })}
        />
        <NumberField
          label="Sidebar width"
          hint="The site allots the sidebar 25% of a narrow container. More room means a longer skill list without scrolling."
          value={settings.sidebarWidth}
          min={220}
          max={640}
          step={10}
          suffix="px"
          onChange={(value) => update({ sidebarWidth: value })}
        />
        <ToggleField
          label="Hide the site's own search bar"
          hint="The Search row above holds several terms at once and runs them together, so the site's single-phrase box is a narrower version of it."
          checked={settings.hideSiteSearch}
          onChange={(value) => update({ hideSiteSearch: value })}
        />
        <ToggleField
          label="Hide the site's own rate line"
          hint="The badge already states the rate in one comparable unit, so the original is duplication."
          checked={settings.hideOriginalRate}
          onChange={(value) => update({ hideOriginalRate: value })}
        />
        <ToggleField
          label="Mark your search terms in the description"
          hint="Shows why a listing matched. Painted rather than inserted — the browser's highlight API colours the text without wrapping or splitting anything in the site's own markup, so there is nothing to undo when you switch it off."
          checked={settings.highlightTerms}
          onChange={(value) => update({ highlightTerms: value })}
        />
        <ToggleField
          label="Show each listing's description excerpt"
          hint="Off keeps the results list compact - titles, rates and job types only."
          checked={settings.showDescription}
          onChange={(value) => update({ showDescription: value })}
        />
      </Section>

      <Section
        title="How your rate compares"
        description="$800 a month is neither good nor bad on its own — only next to what the same kind of work is actually paying."
      >
        <ToggleField
          label="Mark rates well above or below the going rate"
          hint="Adds ▲ or ▼ to the badge when a listing is in the top or bottom quarter for its skill, and says so in full on hover. Built only from listings whose rate we read outright — an assumption would be the tool grading its own guesswork."
          checked={settings.showBenchmark}
          onChange={(value) => update({ showBenchmark: value })}
        />
        <BenchmarkStats />
      </Section>
      </div>

      {/*
        The mini apps also live here, not only in the dock.
        The dock is a shortcut, and a shortcut you can switch off must not be
        the only way in - hiding the clock from the dock should tidy the dock,
        not take the clock away. The same components render in both places.
      */}
      <div className="panel" {...on('tools')}>
        <Section
          title="Time tracker"
          description="Start a clock against a client. Local, and never the paid timesheet."
        >
          <TimeTracker />
        </Section>
        <Section
          title="Focus timer"
          description="A pomodoro that survives the page, with a long-break cycle and a day log."
        >
          <Pomodoro />
        </Section>
        <Section
          title="World clocks"
          description="What time it is where your client is, and the hours your days overlap."
        >
          <Clocks />
        </Section>
      </div>

      <div className="panel" {...on('dock')}>
        <Section
          title="The dock"
          description="The bar of mini apps that floats over OnlineJobs.ph."
        >
          <DockSettings />
        </Section>
      </div>

      <div className="panel" {...on('backup')}>
        <Section
          title="Backup and restore"
          description="Everything lives on this machine, so a copy is the only way it survives one."
        >
          <Backup />
        </Section>
      </div>

      <div className="panel" {...on('account')}>
        <Section
          title="Account"
          description="The optional server side: verification, referrals and deleting your account. Signing in itself lives in the popup."
        >
          <Account />
        </Section>
      </div>

      <footer className="footer">
        {confirmingReset ? (
          <span className="footer-confirm" role="alertdialog" aria-label="Confirm reset">
            <span className="footer-confirm-q">Reset every setting to its default? This can’t be undone.</span>
            <button type="button" className="reset reset-danger" onClick={() => { reset(); setConfirmingReset(false); }}>
              Yes, reset all
            </button>
            <button type="button" className="reset" onClick={() => setConfirmingReset(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" className="reset" onClick={() => setConfirmingReset(true)}>
            Reset to defaults…
          </button>
        )}
        <span className="saved" aria-live="polite">
          {savedAt ? 'Saved' : 'Changes save automatically'}
        </span>
      </footer>
    </main>
  );
}
