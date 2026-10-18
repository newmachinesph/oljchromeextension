import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  APPLICATION_STATUSES,
  loadApplications,
  setApplication,
  removeApplication,
  markFollowedUp,
  setNextAction,
  statusLabel,
  isCustomStatus,
  onApplicationsChanged,
  setPrep,
  MAX_PREP,
} from '../core/applications.js';
import { toIcsEvent, icsFilename } from '../core/ics.js';
import { loadSaved, setSaved, removeSaved, onSavedChanged } from '../core/saved.js';
import {
  loadJobTags,
  addJobTag,
  removeJobTag,
  onJobTagsChanged,
  allTags,
  tagCounts,
  renameTagEverywhere,
  deleteTagEverywhere,
} from '../core/job-tags.js';
import {
  loadJobColors,
  setJobColor,
  onJobColorsChanged,
} from '../core/job-colors.js';
import {
  loadTagColors,
  setTagColor,
  renameTagColor,
  removeTagColor,
  onTagColorsChanged,
} from '../core/tag-colors.js';
import { DEFAULT_TAGS, tagColor, tagChipStyle } from '../core/tags-catalog.js';
import { loadJobNotes, setJobNote, onJobNotesChanged } from '../core/job-notes.js';
import {
  loadBoardConfig,
  setStageLabel,
  setStageHidden,
  setStageOrder,
  addCustomColumn,
  removeCustomColumn,
  addPaletteColor,
  removePaletteColor,
  resetBoardConfig,
  columnsFor,
  onBoardConfigChanged,
  setCardOrder,
} from '../core/board-config.js';
import { summarize, byWeek, byRateBand, velocity, DEFAULT_STALE_DAYS } from '../core/funnel.js';
import { toTabDelimited, toCsv } from '../core/job-export.js';
import { parseChecklist, toggleChecklistItem, checklistProgress } from '../core/checklist.js';
import { dueFollowUps, describeWaiting } from '../core/follow-ups.js';
import { loadSettings } from '../core/settings.js';
import { Icon } from './Icon.jsx';

const SITE = 'https://www.onlinejobs.ph';

/** The board's first lane is the saved store, not an application status. */
const SAVED_COLUMN = { value: 'saved', label: 'Saved' };
const BASE_COLUMNS = [SAVED_COLUMN, ...APPLICATION_STATUSES];

/** A colour per stage, so a full board reads at a glance like the mockups. */
const LANE_COLORS = {
  saved: '#2563eb',
  preparing: '#64748b',
  applied: '#d97706',
  replied: '#0d9488',
  interviewing: '#9333ea',
  offer: '#16a34a',
  hired: '#059669',
  rejected: '#dc2626',
};

/** The starter swatches the card colour picker always offers. */
const DEFAULT_PALETTE = ['#dc2626', '#d97706', '#16a34a', '#2563eb', '#9333ea', '#0d9488', '#64748b', '#111827'];

/** A small glyph per stage for the lane header, drawn white on the colour. */
/**
 * Which icon marks each lane.
 *
 * The shapes come from core/icons.js - the same set the dock and the job cards
 * draw from - so a bookmark on a saved job and a bookmark on the Saved lane are
 * the same bookmark. These were eight hand-drawn paths, at a stroke width that
 * matched nothing else on the page.
 */
const LANE_ICONS = {
  saved: 'lane-saved',
  preparing: 'lane-preparing',
  applied: 'lane-applied',
  replied: 'lane-replied',
  interviewing: 'lane-interviewing',
  offer: 'lane-offer',
  hired: 'lane-hired',
  rejected: 'lane-rejected',
};

/** A neutral glyph for lanes the user added, which have no built-in icon. */
const CUSTOM_LANE_ICON = 'lane-custom';

function LaneIcon({ value }) {
  const name = LANE_ICONS[value] || (value.startsWith('custom-') ? CUSTOM_LANE_ICON : null);
  if (!name) return null;
  return <Icon name={name} size={15} stroke={1.7} className="kanban-lane-icon" />;
}

/** How the board and list can be ordered. */
const SORTS = [
  { value: 'manual', label: 'My order (drag)' },
  { value: 'recent', label: 'Recently updated' },
  { value: 'pay', label: 'Pay (high to low)' },
  { value: 'title', label: 'Title (A–Z)' },
  { value: 'employer', label: 'Employer (A–Z)' },
];

/** An application moved recently; a saved job has only its saved time. */
const recencyOf = (record) =>
  Number.isFinite(record.updatedAt) ? record.updatedAt : (record.savedAt ?? 0);

const ENTRY_SORTS = {
  recent: (a, b) => recencyOf(b[1]) - recencyOf(a[1]),
  pay: (a, b) => (b[1].usdPerMonth ?? -Infinity) - (a[1].usdPerMonth ?? -Infinity),
  title: (a, b) => String(a[1].title || '').localeCompare(String(b[1].title || '')),
  employer: (a, b) => String(a[1].employer || '').localeCompare(String(b[1].employer || '')),
};

/** Sort [key, record] entries by the chosen order. */
function sortEntries(entries, sort) {
  return [...entries].sort(ENTRY_SORTS[sort] || ENTRY_SORTS.recent);
}

/**
 * A lane in the order you dragged it into.
 *
 * Cards you have never moved have no place in the saved sequence, so they keep
 * the recency order and sit after the ones you have arranged - which is what
 * "my order" should mean for a card that arrived since you last touched it.
 * Falls back to recency entirely when there is no saved order for this lane.
 */
function orderEntries(entries, keys) {
  if (!Array.isArray(keys) || keys.length === 0) return sortEntries(entries, 'recent');

  const rank = new Map(keys.map((key, index) => [key, index]));
  return [...entries].sort(([aKey, aRec], [bKey, bRec]) => {
    const a = rank.has(aKey) ? rank.get(aKey) : Infinity;
    const b = rank.has(bKey) ? rank.get(bKey) : Infinity;
    if (a !== b) return a - b;
    return ENTRY_SORTS.recent([aKey, aRec], [bKey, bRec]);
  });
}

const ROW_SORTS = {
  recent: (a, b) => b.at - a.at,
  pay: (a, b) => (b.usdPerMonth ?? -Infinity) - (a.usdPerMonth ?? -Infinity),
  title: (a, b) => String(a.title || '').localeCompare(String(b.title || '')),
  employer: (a, b) => String(a.employer || '').localeCompare(String(b.employer || '')),
};

function percent(rate) {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

function isoDate(epochMs) {
  return Number.isFinite(epochMs) ? new Date(epochMs).toISOString().slice(0, 10) : '';
}

/** A compact "Aug 20" for a card corner; the title carries the full date. */
function shortDate(epochMs) {
  return Number.isFinite(epochMs)
    ? new Date(epochMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';
}

function rateLabel(usdPerMonth) {
  return Number.isFinite(usdPerMonth)
    ? ` · $${Math.round(usdPerMonth).toLocaleString('en-US')}/mo`
    : '';
}

function jobHref(url) {
  if (!url) return '#';
  return /^https?:\/\//i.test(url) ? url : new URL(url, SITE).href;
}

/** The full https link for a job, resolving an OLJ-relative path against the
   site. Empty stays empty (so an editor field shows blank, not "#"). */
function absoluteJobUrl(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  try {
    return /^https?:\/\//i.test(raw) ? raw : new URL(raw, SITE).href;
  } catch {
    return '';
  }
}

/** An epoch as the value a datetime-local input wants (local wall-clock). */
function toLocalInput(epochMs) {
  if (!Number.isFinite(epochMs)) return '';
  const local = new Date(epochMs - new Date(epochMs).getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

/** A datetime-local value back to an epoch, or null when blank/unparseable. */
function fromLocalInput(str) {
  const t = Date.parse(str);
  return Number.isFinite(t) ? t : null;
}

/** Hand the browser a text file to save, without the downloads permission. */
function downloadText(text, name, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The whole board as a spreadsheet: every saved job and application, one row each. */
/**
 * Every card on the board as a spreadsheet.
 *
 * Two formats because they are not interchangeable in practice: .tsv pastes
 * straight into a sheet without an import dialog, while .csv is what everything
 * else on earth will open. Same rows either way - only the encoding differs.
 */
function exportBoard(applications, saved, format = 'tsv') {
  const rows = [
    ...[...applications.entries()].map(([, r]) => ({
      title: r.title,
      employer: r.employer,
      usdPerMonth: r.usdPerMonth,
      postedAt: r.appliedAt,
      status: statusLabel(r.status) || r.status,
      url: absoluteJobUrl(r.url),
    })),
    ...[...saved.entries()]
      .filter(([key]) => !applications.has(key))
      .map(([, r]) => ({
        title: r.title,
        employer: r.employer,
        usdPerMonth: r.usdPerMonth,
        postedAt: r.savedAt,
        status: 'Saved',
        url: absoluteJobUrl(r.url),
      })),
  ];
  const stamp = isoDate(Date.now());
  if (format === 'csv') {
    downloadText(toCsv(rows), `onlinejobs-tracker-${stamp}.csv`, 'text/csv;charset=utf-8');
    return;
  }

  downloadText(
    toTabDelimited(rows),
    `onlinejobs-tracker-${stamp}.tsv`,
    'text/tab-separated-values',
  );
}

function manualKey() {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : `${Date.now()}`;
  return `manual-${id}`;
}

function matches(query, ...fields) {
  if (!query) return true;
  const q = query.toLowerCase();
  return fields.some((f) => String(f ?? '').toLowerCase().includes(q));
}

/**
 * The application tracker: a board of what you have saved and applied to.
 *
 * The board is the point, so it leads. A search narrows every lane at once, a
 * view switch swaps it for a flat list, and "Add a job" lets you track work
 * found anywhere, not only on this site. The numbers - response rate, by week,
 * by pay - are a panel you open when you want them, not a wall you scroll past.
 */
export function Applications() {
  const [applications, setApplications] = useState(null);
  const [saved, setSavedMap] = useState(new Map());
  const [config, setConfig] = useState({ labels: {}, hidden: [], order: [], columns: [], palette: [], cardOrder: {} });
  const [tags, setTags] = useState(new Map());
  const [colors, setColors] = useState(new Map());
  const [tagColors, setTagColors] = useState(new Map());
  const [notes, setNotes] = useState(new Map());
  const [followUpDays, setFollowUpDays] = useState(7);
  const [view, setView] = useState('board');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [showStats, setShowStats] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [adding, setAdding] = useState(null); // null | { status, label } — which lane to add into

  useEffect(() => {
    loadApplications().then(setApplications);
    loadSaved().then(setSavedMap);
    loadBoardConfig().then(setConfig);
    loadJobTags().then(setTags);
    loadJobColors().then(setColors);
    loadTagColors().then(setTagColors);
    loadJobNotes().then(setNotes);
    loadSettings().then((settings) => setFollowUpDays(settings.followUpDays));
    const off = [
      onApplicationsChanged(setApplications),
      onSavedChanged(setSavedMap),
      onBoardConfigChanged(setConfig),
      onJobTagsChanged(setTags),
      onJobColorsChanged(setColors),
      onTagColorsChanged(setTagColors),
      onJobNotesChanged(setNotes),
    ];
    return () => off.forEach((fn) => fn());
  }, []);

  const now = Date.now();
  const funnel = useMemo(() => (applications ? summarize(applications) : null), [applications]);
  const due = useMemo(
    () =>
      applications
        ? new Map(dueFollowUps(applications, now, followUpDays).map((e) => [e.key, e]))
        : new Map(),
    [applications, now, followUpDays],
  );

  if (applications === null) return <p className="loading">Loading...</p>;

  const empty = applications.size === 0 && saved.size === 0;

  return (
    <div className="tracker">
      <div className="tracker-toolbar">
        <input
          type="search"
          className="text-input tracker-search"
          placeholder="Search title or employer…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="tracker-views" role="group" aria-label="View">
          <button
            type="button"
            className={`tracker-view${view === 'board' ? ' tracker-view-on' : ''}`}
            aria-pressed={view === 'board'}
            title="Board view"
            onClick={() => setView('board')}
          >
            ▦ Board
          </button>
          <button
            type="button"
            className={`tracker-view${view === 'list' ? ' tracker-view-on' : ''}`}
            aria-pressed={view === 'list'}
            title="List view"
            onClick={() => setView('list')}
          >
            ☰ List
          </button>
        </div>
        <label className="tracker-sort">
          <span className="tracker-sort-label">Sort</span>
          <select value={sort} aria-label="Sort jobs" onChange={(event) => setSort(event.target.value)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`reset tracker-stats-toggle${showStats ? ' tracker-stats-on' : ''}`}
          aria-pressed={showStats}
          onClick={() => setShowStats((s) => !s)}
        >
          Stats
        </button>
        <button
          type="button"
          className="reset tracker-settings-btn"
          aria-haspopup="dialog"
          title="Board settings"
          onClick={() => setShowSettings(true)}
        >
          ⚙ Board
        </button>
        <button
          type="button"
          className="reset tracker-export-btn"
          title="Export every saved job and application as a spreadsheet (.tsv) - pastes straight into a sheet"
          disabled={applications.size === 0 && saved.size === 0}
          onClick={() => exportBoard(applications, saved, 'tsv')}
        >
          ⤓ TSV
        </button>
        <button
          type="button"
          className="reset tracker-export-btn"
          title="Export every saved job and application as CSV - opens anywhere, including Excel and Sheets"
          disabled={applications.size === 0 && saved.size === 0}
          onClick={() => exportBoard(applications, saved, 'csv')}
        >
          ⤓ CSV
        </button>
        <button type="button" className="tracker-add" onClick={() => setAdding({ status: 'saved', label: 'Saved' })}>
          + Add a job
        </button>
      </div>

      {adding && <AddJob status={adding.status} label={adding.label} onDone={() => setAdding(null)} />}

      {showSettings && (
        <BoardSettings config={config} tags={tags} tagColors={tagColors} applications={applications} onClose={() => setShowSettings(false)} />
      )}

      {showStats && funnel && applications.size > 0 && (
        <Stats applications={applications} funnel={funnel} now={now} />
      )}
      {showStats && applications.size === 0 && (
        <p className="field-hint">No applications yet, so there is nothing to chart.</p>
      )}

      {empty ? (
        <p className="field-hint tracker-empty">
          Nothing here yet. Save a job from the list or its details, or use{' '}
          <strong>Add a job</strong> to track one from anywhere. Everything stays on this machine.
        </p>
      ) : view === 'board' ? (
        <Board applications={applications} saved={saved} config={config} setConfig={setConfig} onSortChange={setSort} tags={tags} colors={colors} tagColors={tagColors} notes={notes} due={due} query={query} sort={sort} onAddToLane={(status, label) => setAdding({ status, label })} />
      ) : (
        <ListView applications={applications} saved={saved} due={due} query={query} sort={sort} />
      )}
    </div>
  );
}

/** The add-a-job form: a manual entry that lands in the Saved lane. */
function AddJob({ status = 'saved', label, onDone }) {
  const [title, setTitle] = useState('');
  const [employer, setEmployer] = useState('');
  const [url, setUrl] = useState('');
  const [pay, setPay] = useState('');

  const save = async () => {
    if (!title.trim()) return;
    const snapshot = {
      title: title.trim(),
      employer: employer.trim(),
      url: url.trim(),
      usdPerMonth: Number.isFinite(Number(pay)) && pay !== '' ? Number(pay) : undefined,
    };
    // A specific lane means a tracked application at that stage; Saved (or the
    // top button) drops it in the Saved lane.
    if (status && status !== 'saved') await setApplication(manualKey(), { status, ...snapshot });
    else await setSaved(manualKey(), snapshot);
    onDone();
  };

  const where = status && status !== 'saved' ? (label || statusLabel(status) || 'this lane') : 'Saved';

  return (
    <div className="tracker-add-form">
      <span className="tracker-add-into">Add to {where}:</span>
      <input className="text-input" placeholder="Job title (required)" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <input className="text-input" placeholder="Employer" value={employer} onChange={(e) => setEmployer(e.target.value)} />
      <input className="text-input" placeholder="Link (optional)" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck="false" />
      <input className="text-input tracker-add-pay" type="number" min="0" placeholder="USD/mo" value={pay} onChange={(e) => setPay(e.target.value)} />
      <button type="button" className="tracker-add" onClick={save}>Add</button>
      <button type="button" className="reset" onClick={onDone}>Cancel</button>
    </div>
  );
}

/** The numbers, revealed only when asked for. */
function Stats({ applications, funnel, now }) {
  const weeks = byWeek(applications, now, 12);
  const bands = byRateBand(applications);
  const pace = velocity(applications, now);
  const roundDays = (d) => (d === null ? '—' : `${Math.round(d)}d`);
  return (
    <div className="tracker-stats">
      <div className="funnel-tiles">
        <Tile label="Submitted" value={funnel.submitted} hint="Applied or further; preparing not counted" />
        {APPLICATION_STATUSES.map((s) => (
          <Tile key={s.value} label={s.label} value={funnel.byStatus[s.value]} />
        ))}
        <Tile label="Got a reply" value={percent(funnel.responseRate)} hint="Share of submitted applications that got any answer" />
      </div>

      <div className="funnel-tiles">
        <Tile label="Avg reply time" value={roundDays(pace.avgDaysToReply)} hint="Average days from applying to the first reply, across replied applications" />
        <Tile label="Median reply time" value={roundDays(pace.medianDaysToReply)} hint="Half of replies came faster than this" />
        <Tile label="Gone quiet" value={pace.stale.length} hint={`Applied but no reply for ${DEFAULT_STALE_DAYS}+ days`} />
      </div>

      {pace.stale.length > 0 && (
        <>
          <h3 className="funnel-heading">Waiting on a reply ({DEFAULT_STALE_DAYS}+ days)</h3>
          <table className="data-table funnel-table">
            <thead>
              <tr><th>Job</th><th>Employer</th><th className="num">Waiting</th></tr>
            </thead>
            <tbody>
              {pace.stale.slice(0, 10).map((s) => (
                <tr key={s.key}>
                  <td>{s.title}</td>
                  <td>{s.employer || '—'}</td>
                  <td className="num">{s.days}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3 className="funnel-heading">By week</h3>
      <table className="data-table funnel-table">
        <thead>
          <tr><th>Week of</th><th className="num">Applied</th><th className="num">Replies</th></tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.weekStart} className={week.applied + week.replies === 0 ? 'muted' : ''}>
              <td>{week.weekStart}</td>
              <td className="num">{week.applied}</td>
              <td className="num">{week.replies}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {bands.length > 0 && (
        <>
          <h3 className="funnel-heading">By pay</h3>
          <table className="data-table funnel-table">
            <thead>
              <tr><th>USD / month</th><th className="num">Applied</th><th className="num">Replies</th><th className="num">Rate</th></tr>
            </thead>
            <tbody>
              {bands.map((band) => (
                <tr key={band.label}>
                  <td>{band.label}</td>
                  <td className="num">{band.total}</td>
                  <td className="num">{band.replies}</td>
                  <td className="num">{percent(band.responseRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/** Lanes fed by two stores and shaped by the board config, filtered by search. */
function Board({ applications, saved, config, setConfig, tags, colors, tagColors, notes, due, query, sort, onSortChange, onAddToLane }) {
  const [drag, setDrag] = useState(null);
  const [overValue, setOverValue] = useState(null);
  const [editing, setEditing] = useState(null);
  const [laneDrag, setLaneDrag] = useState(null);
  const [editingCard, setEditingCard] = useState(null); // jobKey being edited
  /*
   * Bulk selection.
   *
   * Fourteen cards in a lane is where dragging them one at a time stops being
   * a gesture and starts being a chore - and a rejection round is exactly that
   * shape: eight cards that all became the same thing on the same day. A Set of
   * job keys, held here rather than per card, so the action bar can act on the
   * lot without asking each lane what it holds.
   */
  const [selected, setSelected] = useState(() => new Set());
  /** Where a dragged card would land: which card, and which side of it. */
  const [dropAt, setDropAt] = useState(null);

  /**
   * Place the dragged card in front of `beforeKey`, inside that card's lane.
   *
   * Only ever a reorder: a card dropped on a card in ANOTHER lane still has to
   * change status first, so that case is left to the lane's own handler and
   * this refuses it. The whole resulting sequence is written at once, which is
   * what the store wants and what a reorder actually is.
   *
   * Switching the sort to manual is deliberate. Without it the board would
   * accept the drag, save the order, and then redraw by "Recently updated" -
   * the card visibly springing back to where it was, which reads as a bug.
   */
  const reorderCard = async (anchorKey, edge, laneValue, laneCards) => {
    const dragged = drag?.key;
    setDropAt(null);
    if (!dragged || dragged === anchorKey) return;

    const keys = laneCards.map(([key]) => key);

    /*
     * A card from another lane dropped onto a card lands AT that spot.
     *
     * This used to refuse anything not already in the lane, and because the
     * card stops the event from reaching the lane behind it, the drop did
     * nothing at all - you could move a card between lanes only by aiming at
     * empty space. Changing the status first and then placing it means one
     * gesture does what it looks like it does.
     */
    if (!keys.includes(dragged)) {
      drop(laneValue);
      keys.push(dragged);
    }

    const without = keys.filter((key) => key !== dragged);
    const anchor = without.indexOf(anchorKey);
    if (anchor < 0) return;

    // Above the midpoint puts it in front of the anchor, below puts it after -
    // which is the only way to reach the very bottom of a lane.
    const at = edge === 'bottom' ? anchor + 1 : anchor;
    const next = [...without.slice(0, at), dragged, ...without.slice(at)];
    setConfig(await setCardOrder(laneValue, next));
    if (sort !== 'manual') onSortChange?.('manual');
  };

  const cardsFor = (value) => {
    const list =
      value === 'saved'
        ? [...saved.entries()].filter(([key]) => !applications.has(key))
        : [...applications.entries()].filter(([, r]) => r.status === value);
    const ordered =
      sort === 'manual'
        ? orderEntries(list, config.cardOrder?.[value])
        : sortEntries(list, sort);
    return ordered.filter(([, r]) => matches(query, r.title, r.employer));
  };

  const columns = columnsFor(config, BASE_COLUMNS).map((lane) => ({ ...lane, cards: cardsFor(lane.value) }));
  const visible = columns.filter((c) => !c.hidden);
  const hidden = columns.filter((c) => c.hidden);
  const orderValues = columns.map((c) => c.value);

  // The palette a card's colour picker offers: the built-in swatches first, then
  // any the user saved that aren't already there.
  const palette = [...DEFAULT_PALETTE, ...config.palette.filter((c) => !DEFAULT_PALETTE.includes(c))];

  // The tags offered for one-click selection: the defaults plus every tag
  // already in use, deduped case-insensitively.
  const usedTags = allTags(tags);
  const seenTag = new Set(usedTags.map((t) => t.toLowerCase()));
  const tagSuggestions = [...usedTags, ...DEFAULT_TAGS.map((d) => d.label).filter((d) => !seenTag.has(d.toLowerCase()))];

  // Every lane a card can be moved into (not Saved, which is the source lane).
  const moveTargets = columns.filter((c) => c.value !== 'saved').map((c) => ({ value: c.value, label: c.label }));

  // The record and lane behind the card currently being edited, if any.
  const editRecord = editingCard
    ? (saved.has(editingCard) && !applications.has(editingCard)
        ? { record: saved.get(editingCard), saved: true }
        : applications.has(editingCard)
          ? { record: applications.get(editingCard), saved: false }
          : null)
    : null;

  const laneColorFor = (column) => LANE_COLORS[column.value] || (column.custom ? '#334155' : '#64748b');

  // Releasing a card outside any lane leaves the last column highlighted; a
  // drag-end reset clears it whether the drop landed or not.
  const clearIndicator = () => setDropAt(null);
  const clearDrag = () => {
    setDrag(null);
    setOverValue(null);
  };

  /**
   * Move one card into a lane, whichever store it lives in now.
   *
   * Saved jobs and applications are two stores, so crossing between them is a
   * write to both - and getting that half right is how a card ends up in two
   * lanes at once. One function, used by the drag and by the bulk bar alike,
   * so there is only ever one version of that rule to get wrong.
   */
  const moveOne = (key, from, target) => {
    if (target === 'saved') {
      if (from === 'app') {
        const r = applications.get(key);
        removeApplication(key);
        setSaved(key, { title: r?.title, url: r?.url, employer: r?.employer, usdPerMonth: r?.usdPerMonth ?? undefined });
      }
      return;
    }
    if (from === 'saved') {
      const job = saved.get(key);
      setApplication(key, {
        status: target,
        title: job?.title,
        url: job?.url,
        employer: job?.employer,
        usdPerMonth: job?.usdPerMonth ?? undefined,
      });
      removeSaved(key);
      return;
    }
    setApplication(key, { status: target });
  };

  /** Which store a key lives in. An application wins, the way the editor reads it. */
  const laneOf = (key) => (applications.has(key) ? 'app' : 'saved');

  const drop = (target) => {
    const moving = drag;
    setDrag(null);
    setOverValue(null);
    if (!moving) return;
    moveOne(moving.key, moving.from, target);
  };

  const toggleSelected = (key) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const selectAllShown = () =>
    setSelected(new Set(visible.flatMap((column) => column.cards.map(([key]) => key))));

  const moveSelected = (target) => {
    for (const key of selected) moveOne(key, laneOf(key), target);
    setSelected(new Set());
  };

  /*
   * Removing takes the card off the board and nothing else: the job is not
   * dismissed from the listings and nothing is written to the employer book.
   * A board is a record of what you did, and clearing a stale row from it
   * should not quietly change what you see next time you search.
   */
  const removeSelected = () => {
    for (const key of selected) {
      if (applications.has(key)) removeApplication(key);
      else removeSaved(key);
    }
    setSelected(new Set());
  };

  const commitRename = (value, text) => {
    setStageLabel(value, text);
    setEditing(null);
  };

  // Reorder lanes by moving the dragged lane to the dropped lane's slot.
  const reorderLane = (targetValue) => {
    const from = orderValues.indexOf(laneDrag);
    const to = orderValues.indexOf(targetValue);
    setLaneDrag(null);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...orderValues];
    next.splice(from, 1);
    next.splice(to, 0, laneDrag);
    setStageOrder(next);
  };

  // Nudge a lane one place left or right, for keyboard/menu users.
  const moveLane = (value, delta) => {
    const i = orderValues.indexOf(value);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= orderValues.length) return;
    const next = [...orderValues];
    [next[i], next[j]] = [next[j], next[i]];
    setStageOrder(next);
  };

  // Deleting a custom lane returns its cards to Applied so no work is lost.
  const deleteLane = (value) => {
    for (const [key, record] of applications) {
      if (record.status === value) setApplication(key, { status: 'applied' });
    }
    removeCustomColumn(value);
  };

  const shownCount = visible.reduce((sum, column) => sum + column.cards.length, 0);

  return (
    <>
      {selected.size > 0 && (
        <div className="kanban-bulk" role="region" aria-label="Selected cards">
          <strong className="kanban-bulk-count">
            {selected.size} selected
          </strong>
          <label className="kanban-bulk-move">
            <span>Move to</span>
            <select
              className="text-input"
              value=""
              aria-label="Move the selected cards to a lane"
              onChange={(event) => {
                if (event.target.value) moveSelected(event.target.value);
              }}
            >
              <option value="">Choose a lane…</option>
              {columns.map((column) => (
                <option key={column.value} value={column.value}>
                  {column.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="kanban-bulk-btn" onClick={selectAllShown}>
            Select all {shownCount}
          </button>
          <button
            type="button"
            className="kanban-bulk-btn kanban-bulk-remove"
            onClick={removeSelected}
          >
            Remove from board
          </button>
          <button
            type="button"
            className="kanban-bulk-btn"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      <div className={`kanban${selected.size > 0 ? ' is-selecting' : ''}`}>
        {visible.map((column) => {
          const color = laneColorFor(column);
          return (
            <div
              key={column.value}
              className={`kanban-col${column.value === 'saved' ? ' kanban-col-saved' : ''}${overValue === column.value ? ' kanban-col-over' : ''}${laneDrag === column.value ? ' kanban-col-dragging' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                setOverValue(column.value);
              }}
              onDragLeave={() => setOverValue((v) => (v === column.value ? null : v))}
              onDrop={() => (laneDrag ? reorderLane(column.value) : drop(column.value))}
            >
              <div
                className="kanban-head kanban-head-color"
                style={{ background: color }}
                draggable={editing !== column.value}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  setLaneDrag(column.value);
                }}
                onDragEnd={() => setLaneDrag(null)}
              >
                {editing === column.value ? (
                  <input
                    className="kanban-rename"
                    defaultValue={column.label}
                    autoFocus
                    onFocus={(event) => event.target.select()}
                    aria-label={`Rename ${column.defaultLabel} lane`}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitRename(column.value, event.target.value);
                      if (event.key === 'Escape') setEditing(null);
                    }}
                    onBlur={(event) => commitRename(column.value, event.target.value)}
                  />
                ) : (
                  <>
                    <LaneIcon value={column.value} />
                    <button type="button" className="kanban-title kanban-title-btn" title="Click to rename (or drag the header to reorder)" onClick={() => setEditing(column.value)}>
                      {column.label}
                    </button>
                    <span className="kanban-count">{column.cards.length}</span>
                    <LaneMenu
                      label={column.label}
                      custom={column.custom}
                      onRename={() => setEditing(column.value)}
                      onHide={() => setStageHidden(column.value, true)}
                      onMoveLeft={() => moveLane(column.value, -1)}
                      onMoveRight={() => moveLane(column.value, 1)}
                      onDelete={() => deleteLane(column.value)}
                    />
                  </>
                )}
              </div>
              <div className="kanban-cards">
                {column.cards.map(([key, record]) => {
                  const shared = {
                    jobKey: key,
                    record,
                    color: colors.get(key) || color,
                    jobColor: colors.get(key),
                    palette,
                    moveTargets,
                    tags: tags?.get(key) ?? [],
                    tagColors,
                    tagSuggestions,
                    onEdit: () => setEditingCard(key),
                    selected: selected.has(key),
                    onSelect: () => toggleSelected(key),
                    dropEdge: dropAt?.key === key ? dropAt.edge : null,
                    dragging: drag?.key === key,
                    onDragging: (on) => {
                      if (!on) setDropAt(null);
                    },
                    onDropBefore: (target, phase, edge) => {
                      if (phase === 'leave') {
                        setDropAt((v) => (v?.key === target ? null : v));
                        return;
                      }
                      if (phase === 'over') {
                        setDropAt((v) =>
                          v?.key === target && v.edge === edge ? v : { key: target, edge },
                        );
                        return;
                      }
                      reorderCard(target, edge, column.value, column.cards);
                    },
                  };
                  return column.value === 'saved' ? (
                    <SavedCard key={key} {...shared} onStart={() => setDrag({ key, from: 'saved' })} onEnd={clearDrag} />
                  ) : (
                    <Card key={key} {...shared} due={due.get(key)} onStart={() => setDrag({ key, from: 'app' })} onEnd={clearDrag} />
                  );
                })}
                <button type="button" className="kanban-add" onClick={() => onAddToLane(column.value, column.label)}>
                  + Add job
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {hidden.length > 0 && (
        <div className="kanban-hidden">
          <span className="kanban-hidden-label">Hidden lanes:</span>
          {hidden.map((column) => (
            <button key={column.value} type="button" className="kanban-restore" title={`Show the ${column.label} lane again`} onClick={() => setStageHidden(column.value, false)}>
              {column.label}{column.cards.length > 0 ? ` (${column.cards.length})` : ''} ↩
            </button>
          ))}
        </div>
      )}

      {editRecord && (
        <CardEditor
          jobKey={editingCard}
          record={editRecord.record}
          saved={editRecord.saved}
          note={notes.get(editingCard) ?? ''}
          onClose={() => setEditingCard(null)}
        />
      )}
    </>
  );
}

/**
 * Edit a card's details in place: title, employer, link, rate and a private
 * description. Saves back to whichever store the card lives in; the description
 * is the same per-job note the modal and Saved tab use.
 */
/** Renders the `- [ ]` lines of a note as tickable checkboxes; ticking rewrites
   the note text so the raw note stays the single source of truth. */
function NoteChecklist({ text, onToggle }) {
  const items = parseChecklist(text);
  if (items.length === 0) return null;
  const { done, total } = checklistProgress(text);
  return (
    <div className="note-checklist">
      <div className="note-checklist-head">Checklist · {done}/{total}</div>
      <ul>
        {items.map((item) => (
          <li key={item.index}>
            <label>
              <input type="checkbox" checked={item.checked} onChange={() => onToggle(toggleChecklistItem(text, item.index))} />
              <span className={item.checked ? 'note-checklist-done' : ''}>{item.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/*
 * A starting point for interview prep.
 *
 * A blank box labelled "interview prep" is intimidating and mostly stays blank.
 * These are the four things that actually decide how an OnlineJobs.ph interview
 * goes - what you ask them, what you have rehearsed, what you know about them,
 * and the number you will not go below. Checkbox lines, so the existing
 * checklist parser renders them tickable with no new machinery.
 */
const PREP_TEMPLATE = [
  'Ask them',
  '- [ ] What does a good first 90 days look like?',
  '- [ ] Who would I report to, and how do you prefer to communicate?',
  '- [ ] Is the rate hourly or monthly, and when is payday?',
  '',
  'Have ready',
  '- [ ] Why me, in two sentences',
  '- [ ] A time I fixed something under pressure',
  '- [ ] Why I left the last client',
  '',
  'About them',
  '- Website:',
  '- What they sell:',
  '- Their timezone and our overlap:',
  '',
  'Before the call',
  '- [ ] Rate I will not go below:',
  '- [ ] Camera, mic and the meeting link tested',
].join('\n');

function CardEditor({ jobKey, record, saved, note, onClose }) {
  const [title, setTitle] = useState(record.title ?? '');
  const [employer, setEmployer] = useState(record.employer ?? '');
  const [url, setUrl] = useState(absoluteJobUrl(record.url));
  const [pay, setPay] = useState(Number.isFinite(record.usdPerMonth) ? String(record.usdPerMonth) : '');
  const [description, setDescription] = useState(note);
  const [nextAt, setNextAt] = useState(toLocalInput(record.nextActionAt));
  const [nextLabel, setNextLabel] = useState(record.nextActionLabel ?? '');
  const [prep, setPrepText] = useState(record.prep ?? '');

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const save = () => {
    const patch = {
      title: title.trim(),
      employer: employer.trim(),
      // Store the complete https link, resolving a relative OLJ path.
      url: absoluteJobUrl(url),
      usdPerMonth: pay.trim() !== '' && Number.isFinite(Number(pay)) ? Number(pay) : undefined,
    };
    // Carry the current stage through, or setApplication would default it back
    // to "applied" and, worse, log a bogus stage move.
    if (saved) setSaved(jobKey, patch);
    else setApplication(jobKey, { ...patch, status: record.status });
    setJobNote(jobKey, description);
    // Next action is only tracked on real applications, not saved jobs.
    if (!saved) setNextAction(jobKey, { at: fromLocalInput(nextAt), label: nextLabel.trim() });
    // Prep has its own writer so it does not stamp updatedAt - writing notes is
    // not progress on the application.
    if (!saved && prep !== (record.prep ?? '')) setPrep(jobKey, prep);
    onClose();
  };

  const addToCalendar = () => {
    const at = fromLocalInput(nextAt);
    if (at === null) return;
    const ics = toIcsEvent({
      title: `${nextLabel.trim() || 'Follow up'} — ${title.trim() || 'job'}`,
      at,
      url: absoluteJobUrl(url),
      description: description || '',
    });
    if (ics) downloadText(ics, icsFilename(title || 'job'), 'text/calendar');
  };

  const history = !saved && Array.isArray(record.history) ? record.history : [];

  return (
    <div className="kanban-settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="kanban-settings kanban-card-editor" role="dialog" aria-label="Edit card" aria-modal="true">
        <div className="kanban-settings-head">
          <h3>Edit card</h3>
          <button type="button" className="kanban-settings-close" aria-label="Close editor" onClick={onClose}>×</button>
        </div>
        {/* Everything between the head and the actions scrolls; the shell is
            capped to the viewport so Save is always on screen, however long
            the prep grows. */}
        <div className="kanban-edit-body">
        <label className="kanban-edit-field">
          <span>Title</span>
          <input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        <label className="kanban-edit-field">
          <span>Employer</span>
          <input className="text-input" value={employer} onChange={(e) => setEmployer(e.target.value)} />
        </label>
        <label className="kanban-edit-field">
          <span>Link</span>
          <input className="text-input" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck="false" placeholder="https://…" />
        </label>
        <label className="kanban-edit-field">
          <span>Rate (USD/mo)</span>
          <input className="text-input" type="number" min="0" value={pay} onChange={(e) => setPay(e.target.value)} placeholder="e.g. 1200" />
        </label>
        <label className="kanban-edit-field">
          <span>Description</span>
          <textarea className="text-input" rows={3} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} placeholder={'A private note about this job…\nTip: "- [ ] task" lines become checkboxes.'} />
        </label>
        <NoteChecklist text={description} onToggle={setDescription} />
        {!saved && (
          <div className="kanban-edit-field">
            <span>Next action</span>
            <div className="kanban-edit-next">
              <input className="text-input" value={nextLabel} maxLength={80} placeholder="e.g. Interview call" onChange={(e) => setNextLabel(e.target.value)} />
              <input className="text-input" type="datetime-local" value={nextAt} onChange={(e) => setNextAt(e.target.value)} />
              <button type="button" className="reset" disabled={fromLocalInput(nextAt) === null} onClick={addToCalendar} title="Download a calendar event (.ics)">📅 Calendar</button>
            </div>
          </div>
        )}
        {!saved && (
          <div className="kanban-edit-field">
            <span>Interview prep</span>
            <span className="field-hint">
              What you want ready before you talk to them. Yours only, never sent anywhere —
              and `- [ ]` lines become the checklist below.
            </span>
            <textarea
              className="text-input kanban-prep"
              rows={6}
              value={prep}
              maxLength={MAX_PREP}
              placeholder="Questions to ask, answers to rehearse, what you found out about them…"
              onChange={(event) => setPrepText(event.target.value)}
            />
            {prep.trim() === '' && (
              <button type="button" className="reset" onClick={() => setPrepText(PREP_TEMPLATE)}>
                Start from a template
              </button>
            )}
            <NoteChecklist text={prep} onToggle={setPrepText} />
          </div>
        )}
        {history.length > 0 && (
          <div className="kanban-edit-field">
            <span>Stage history</span>
            <ol className="kanban-history">
              {history.map((h, i) => (
                <li key={`${h.status}-${h.at}-${i}`}>
                  <span className="kanban-history-stage">{statusLabel(h.status) || h.status}</span>
                  <span className="kanban-history-date">{isoDate(h.at)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        </div>
        <div className="kanban-edit-actions">
          <button type="button" className="tracker-add" onClick={save} disabled={!title.trim()}>Save</button>
          <button type="button" className="reset" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/**
 * The board's settings dialog off the top toolbar: add a lane, manage tags,
 * manage saved colours, and reset the board. Kept out of the lanes themselves so
 * the board stays about the cards.
 */
function BoardSettings({ config, tags, tagColors, applications, onClose }) {
  const [newColumn, setNewColumn] = useState('');

  useEffect(() => {
    // Capture phase + stopPropagation so Escape closes only this dialog, not the
    // board overlay behind it (which also listens for Escape to close itself).
    const onKey = (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const counts = tagCounts(tags);
  const palette = config.palette;
  const custom = config.columns;
  const dirty =
    custom.length > 0 ||
    palette.length > 0 ||
    config.hidden.length > 0 ||
    config.order.length > 0 ||
    Object.keys(config.labels).length > 0;

  const addColumn = () => {
    const value = newColumn.trim();
    if (!value) return;
    addCustomColumn(value);
    setNewColumn('');
  };

  // Returning custom-lane cards to Applied first means a reset never orphans an
  // application into a lane that no longer exists.
  const resetAll = () => {
    for (const [key, record] of applications) {
      if (isCustomStatus(record.status)) setApplication(key, { status: 'applied' });
    }
    resetBoardConfig();
  };

  return (
    <div className="kanban-settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="kanban-settings" role="dialog" aria-label="Board settings" aria-modal="true">
        <div className="kanban-settings-head">
          <h3>Board settings</h3>
          <button type="button" className="kanban-settings-close" aria-label="Close settings" onClick={onClose}>×</button>
        </div>

        <section className="kanban-settings-sec">
          <h4>Add a column</h4>
          <div className="kanban-settings-row">
            <input
              className="text-input"
              placeholder="New lane name"
              value={newColumn}
              maxLength={40}
              onChange={(event) => setNewColumn(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') addColumn(); }}
            />
            <button type="button" className="tracker-add" onClick={addColumn} disabled={!newColumn.trim()}>Add lane</button>
          </div>
          <p className="field-hint">
            {custom.length > 0
              ? `${custom.length} custom lane${custom.length === 1 ? '' : 's'}. Delete one from its lane menu — its cards move back to Applied.`
              : 'A lane of your own, alongside the built-in stages.'}
          </p>
        </section>

        <section className="kanban-settings-sec">
          <h4>Tags</h4>
          {counts.length === 0 ? (
            <p className="field-hint">No tags yet. Add them from a card’s menu.</p>
          ) : (
            <ul className="kanban-tag-admin">
              {counts.map(({ tag, count }) => (
                <TagRow key={tag} tag={tag} count={count} tagColors={tagColors} />
              ))}
            </ul>
          )}
        </section>

        <section className="kanban-settings-sec">
          <h4>Saved colours</h4>
          <div className="kanban-swatches">
            {palette.length === 0 && <span className="field-hint">Pick a colour on a card to save it here.</span>}
            {palette.map((hex) => (
              <span key={hex} className="kanban-swatch-manage">
                <span className="kanban-swatch" style={{ background: hex }} />
                <button type="button" className="kanban-swatch-remove" aria-label={`Remove colour ${hex}`} onClick={() => removePaletteColor(hex)}>×</button>
              </span>
            ))}
            <label className="kanban-swatch kanban-swatch-add" title="Add a colour">
              <span aria-hidden="true">＋</span>
              <input type="color" aria-label="Add a colour to the palette" onChange={(event) => addPaletteColor(event.target.value)} />
            </label>
          </div>
        </section>

        <section className="kanban-settings-sec">
          <button type="button" className="reset" onClick={resetAll} disabled={!dirty}>Reset lanes to defaults</button>
          <p className="field-hint">Clears renames, hidden lanes, order, custom lanes and saved colours. Your saved jobs, applications and tags stay.</p>
        </section>
      </div>
    </div>
  );
}

/** One row of the tag manager: recolour, rename in place (Enter or blur), or delete. */
function TagRow({ tag, count, tagColors }) {
  const [value, setValue] = useState(tag);
  const color = tagColor(tag, tagColors);
  const commit = () => {
    const next = value.trim();
    if (next && next.toLowerCase() !== tag.toLowerCase()) {
      // Carry the colour to the new name, then rename on every job.
      renameTagColor(tag, next);
      renameTagEverywhere(tag, next);
    }
  };
  const remove = () => {
    deleteTagEverywhere(tag);
    removeTagColor(tag);
  };
  return (
    <li className="kanban-tag-row">
      <label className="kanban-tag-swatch" title="Tag colour" style={{ background: color }}>
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#94a3b8'} aria-label={`Colour for tag ${tag}`} onChange={(event) => setTagColor(tag, event.target.value)} />
      </label>
      <input
        className="text-input kanban-tag-name"
        value={value}
        maxLength={40}
        aria-label={`Rename tag ${tag}`}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') { commit(); event.target.blur(); } }}
        onBlur={commit}
      />
      <span className="kanban-tag-count" title={`${count} job${count === 1 ? '' : 's'}`}>{count}</span>
      <button type="button" className="kanban-tag-del" aria-label={`Delete tag ${tag} from every job`} onClick={remove}>Delete</button>
    </li>
  );
}

function dragStart(event, jobKey, onStart) {
  event.dataTransfer.setData('text/plain', jobKey);
  event.dataTransfer.effectAllowed = 'move';
  onStart();
}

/** Promote a saved job into a tracked application at the chosen stage. */
function promoteSaved(jobKey, record, status) {
  setApplication(jobKey, {
    status,
    title: record.title,
    url: record.url,
    employer: record.employer,
    usdPerMonth: record.usdPerMonth ?? undefined,
  });
  removeSaved(jobKey);
}

/** Open/close a small menu, closing on an outside click or Escape. */
function useMenu() {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  // Once the menu is in the DOM, decide up vs down from where the kebab sits in
  // the viewport, so a card near the bottom opens upward instead of off-screen.
  // useLayoutEffect runs before paint, so the choice never flickers.
  useLayoutEffect(() => {
    if (!open) { setDropUp(false); return; }
    const wrap = ref.current;
    const menu = wrap?.querySelector('.kanban-menu');
    if (!wrap || !menu) return;
    const wrapRect = wrap.getBoundingClientRect();
    const needed = menu.getBoundingClientRect().height + 8;
    const spaceBelow = window.innerHeight - wrapRect.bottom;
    setDropUp(spaceBelow < needed && wrapRect.top > spaceBelow);
  }, [open]);
  return { open, setOpen, ref, dropUp };
}

/** The kebab on a lane header: rename, reorder, hide, and (for custom lanes) delete. */
function LaneMenu({ label, custom, onRename, onHide, onMoveLeft, onMoveRight, onDelete }) {
  const { open, setOpen, ref, dropUp } = useMenu();
  return (
    <div className="kanban-kebab-wrap" ref={ref}>
      <button type="button" className="kanban-kebab" aria-label={`${label} lane menu`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>⋮</button>
      {open && (
        <div className={`kanban-menu${dropUp ? ' kanban-menu-up' : ''}`} role="menu">
          <button type="button" className="kanban-menu-item" role="menuitem" onClick={() => { onRename(); setOpen(false); }}>Rename lane</button>
          <button type="button" className="kanban-menu-item" role="menuitem" onClick={() => { onMoveLeft(); setOpen(false); }}>Move left</button>
          <button type="button" className="kanban-menu-item" role="menuitem" onClick={() => { onMoveRight(); setOpen(false); }}>Move right</button>
          <button type="button" className="kanban-menu-item" role="menuitem" onClick={() => { onHide(); setOpen(false); }}>Hide lane</button>
          {custom && (
            <button type="button" className="kanban-menu-item kanban-menu-danger" role="menuitem" onClick={() => { onDelete(); setOpen(false); }}>Delete lane</button>
          )}
        </div>
      )}
    </div>
  );
}

/** The kebab on a card: move it, colour it, tag it, or remove it. */
function CardMenu({ jobKey, saved, status, record, jobColor, palette = DEFAULT_PALETTE, moveTargets, cardTags = [], tagColors, tagSuggestions = [], onEdit }) {
  const { open, setOpen, ref, dropUp } = useMenu();
  const targets = moveTargets && moveTargets.length ? moveTargets : APPLICATION_STATUSES;
  const move = (value) => {
    if (!value) return;
    if (saved) promoteSaved(jobKey, record, value);
    else setApplication(jobKey, { status: value });
    setOpen(false);
  };
  const onCard = new Set(cardTags.map((t) => t.toLowerCase()));
  const suggestions = tagSuggestions.filter((t) => !onCard.has(t.toLowerCase())).slice(0, 10);
  return (
    <div className="kanban-kebab-wrap kanban-card-kebab" ref={ref}>
      <button type="button" className="kanban-kebab" aria-label="Card actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>⋮</button>
      {open && (
        <div className={`kanban-menu${dropUp ? ' kanban-menu-up' : ''}`} role="menu">
          {onEdit && (
            <button type="button" className="kanban-menu-item" onClick={() => { onEdit(); setOpen(false); }}>Edit details…</button>
          )}
          <div className="kanban-menu-label">Move to</div>
          <select className="kanban-menu-select" value={saved ? '' : status} aria-label="Move to stage" onChange={(e) => move(e.target.value)}>
            {saved && <option value="">Choose stage…</option>}
            {targets.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
          </select>

          <div className="kanban-menu-label">Tags</div>
          {cardTags.length > 0 && (
            <div className="kanban-menu-tags">
              {cardTags.map((t) => (
                <span key={t} className="kanban-menu-tagchip" style={tagChipStyle(tagColor(t, tagColors))}>
                  {t}
                  <button type="button" className="kanban-menu-tagchip-x" aria-label={`Remove tag ${t}`} onClick={() => removeJobTag(jobKey, t)}>×</button>
                </span>
              ))}
            </div>
          )}
          {suggestions.length > 0 && (
            <div className="kanban-menu-tagsuggest">
              {suggestions.map((t) => (
                <button key={t} type="button" className="kanban-menu-tagadd" style={tagChipStyle(tagColor(t, tagColors))} onClick={() => addJobTag(jobKey, t)}>+ {t}</button>
              ))}
            </div>
          )}
          <input
            className="kanban-menu-tag text-input"
            placeholder="New tag…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.target.value.trim()) { addJobTag(jobKey, e.target.value); e.target.value = ''; }
            }}
          />

          <div className="kanban-menu-label">Colour</div>
          <div className="kanban-swatches">
            {palette.map((hex) => (
              <button
                key={hex}
                type="button"
                className={`kanban-swatch${jobColor === hex ? ' kanban-swatch-on' : ''}`}
                style={{ background: hex }}
                aria-label={`Colour ${hex}`}
                aria-pressed={jobColor === hex}
                onClick={() => { setJobColor(jobKey, hex); setOpen(false); }}
              />
            ))}
            <label className="kanban-swatch kanban-swatch-add" title="Add a colour">
              <span aria-hidden="true">＋</span>
              <input
                type="color"
                aria-label="Add a custom colour"
                onChange={(e) => { addPaletteColor(e.target.value); setJobColor(jobKey, e.target.value); }}
              />
            </label>
            {jobColor && (
              <button type="button" className="kanban-swatch kanban-swatch-clear" title="Clear colour" aria-label="Clear colour" onClick={() => { setJobColor(jobKey, ''); setOpen(false); }}>×</button>
            )}
          </div>

          {!saved && status === 'applied' && (
            <button type="button" className="kanban-menu-item" onClick={() => { markFollowedUp(jobKey); setOpen(false); }}>Mark followed up</button>
          )}
          <button type="button" className="kanban-menu-item kanban-menu-danger" onClick={() => { (saved ? removeSaved : removeApplication)(jobKey); setOpen(false); }}>
            {saved ? 'Remove from saved' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  );
}

/** Tag chips on a card, coloured by tag, capped so a heavily-tagged job does not sprawl. */
function CardTags({ tags, tagColors }) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className="kanban-card-tags">
      {tags.slice(0, 6).map((t) => (
        <span key={t} className="kanban-card-tag" style={tagChipStyle(tagColor(t, tagColors))}>{t}</span>
      ))}
      {tags.length > 6 && <span className="kanban-card-tag kanban-card-tag-more">+{tags.length - 6}</span>}
    </div>
  );
}

/** One job card, shared by the Saved lane and every application stage so the two
   never drift apart. `saved` picks the Saved-vs-stage behaviour in the menu. */
function JobCard({ jobKey, record, color, jobColor, palette, moveTargets, tags, tagColors, tagSuggestions, due, saved = false, selected = false, onSelect, onEdit, onStart, onEnd, onDropBefore, dropEdge, dragging, onDragging }) {
  /*
   * Which half of the card the pointer is over.
   *
   * Dropping only ever "before" a card left no way to reach the bottom of a
   * lane: the last position has no card after it to aim at, so the drop fell
   * through to the lane and changed status instead of reordering. Splitting
   * each card at its midpoint gives every slot a target, including the last.
   */
  const edgeFor = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientY < box.top + box.height / 2 ? 'top' : 'bottom';
  };

  return (
    <div
      className={`kanban-card${dropEdge ? ` kanban-card-drop kanban-card-drop-${dropEdge}` : ''}${dragging ? ' kanban-card-dragging' : ''}${selected ? ' kanban-card-selected' : ''}`}
      draggable
      style={{ borderLeftColor: color }}
      onDragStart={(e) => {
        dragStart(e, jobKey, onStart);
        onDragging?.(true);
      }}
      onDragEnd={(e) => {
        onDragging?.(false);
        onEnd?.(e);
      }}
      /*
       * Dropping onto a card places the dragged one before it. The lane behind
       * still handles a drop on empty space, so the two gestures coexist:
       * onto a card reorders, onto the lane appends or changes status.
       */
      onDragOver={(event) => {
        if (!onDropBefore) return;
        event.preventDefault();
        event.stopPropagation();
        onDropBefore(jobKey, 'over', edgeFor(event));
      }}
      onDragLeave={() => onDropBefore?.(jobKey, 'leave')}
      onDrop={(event) => {
        if (!onDropBefore) return;
        event.preventDefault();
        event.stopPropagation();
        onDropBefore(jobKey, 'drop', edgeFor(event));
      }}
    >
      <span className="kanban-card-grip" aria-hidden="true" title="Drag to move">⠿</span>
      {/*
        Hidden until you hover the card or start selecting - a checkbox on every
        card at rest turns a board into a form. `draggable={false}` because a
        drag begun on the box would otherwise pick up the card instead of
        ticking it.
      */}
      <input
        type="checkbox"
        className="kanban-card-pick"
        checked={selected}
        draggable={false}
        aria-label={`Select ${record.title || 'this job'}`}
        onChange={() => onSelect?.(jobKey)}
        onClick={(event) => event.stopPropagation()}
        onDragStart={(event) => event.preventDefault()}
      />
      <a className="kanban-card-title" href={jobHref(record.url)} target="_blank" rel="noopener noreferrer">{record.title || 'Untitled job'}</a>
      {record.employer && <span className="kanban-card-employer">{record.employer}</span>}
      {Number.isFinite(record.usdPerMonth) && <span className="kanban-card-rate">{rateLabel(record.usdPerMonth).replace(/^ · /, '')}</span>}
      <CardTags tags={tags} tagColors={tagColors} />
      {!saved && Number.isFinite(record.nextActionAt) && (
        <span
          className={`kanban-card-next${record.nextActionAt < Date.now() ? ' kanban-card-next-overdue' : ''}`}
          title={`Next action: ${record.nextActionLabel || 'follow up'} — ${isoDate(record.nextActionAt)}`}
        >
          📅 {record.nextActionLabel || 'Next'} · {shortDate(record.nextActionAt)}
        </span>
      )}
      {!saved && due && <span className="kanban-card-due">{describeWaiting(due)}</span>}
      {(() => {
        const ts = saved ? record.savedAt : record.updatedAt;
        return Number.isFinite(ts) ? (
          <span className="kanban-card-date" title={`${saved ? 'Saved' : 'Updated'} ${isoDate(ts)}`}>{saved ? 'Saved' : 'Updated'} {shortDate(ts)}</span>
        ) : null;
      })()}
      <CardMenu
        jobKey={jobKey}
        saved={saved}
        status={saved ? undefined : record.status}
        record={record}
        jobColor={jobColor}
        palette={palette}
        moveTargets={moveTargets}
        cardTags={tags}
        tagColors={tagColors}
        tagSuggestions={tagSuggestions}
        onEdit={onEdit}
      />
    </div>
  );
}

function SavedCard(props) {
  return <JobCard {...props} saved />;
}

function Card(props) {
  return <JobCard {...props} />;
}

/** A flat, scannable table across every lane, filtered by the same search. */
function ListView({ applications, saved, due, query, sort }) {
  const rows = [
    ...[...saved.entries()]
      .filter(([key]) => !applications.has(key))
      .map(([key, r]) => ({ key, from: 'saved', title: r.title, employer: r.employer, url: r.url, usdPerMonth: r.usdPerMonth, stage: 'Saved', at: r.savedAt })),
    ...[...applications.entries()].map(([key, r]) => ({ key, from: 'app', title: r.title, employer: r.employer ?? '', url: r.url, usdPerMonth: r.usdPerMonth, stage: statusLabel(r.status), status: r.status, at: r.updatedAt, due: due.get(key) })),
  ]
    .filter((row) => matches(query, row.title, row.employer))
    .sort(ROW_SORTS[sort] || ROW_SORTS.recent);

  if (rows.length === 0) return <p className="field-hint">No jobs match “{query}”.</p>;

  return (
    <table className="data-table tracker-list">
      <thead>
        <tr><th>Job</th><th>Employer</th><th>Stage</th><th>Pay</th><th>Updated</th></tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td><a href={jobHref(row.url)} target="_blank" rel="noopener noreferrer">{row.title || 'Untitled job'}</a></td>
            <td>{row.employer || '—'}</td>
            <td>
              {row.from === 'app' ? (
                <select className="tracker-list-stage" value={row.status} aria-label="Stage" onChange={(e) => setApplication(row.key, { status: e.target.value })}>
                  {APPLICATION_STATUSES.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
                </select>
              ) : (
                <select
                  className="tracker-list-stage"
                  value=""
                  aria-label="Move this saved job to a stage"
                  onChange={(e) => {
                    if (e.target.value)
                      promoteSaved(
                        row.key,
                        { title: row.title, url: row.url, employer: row.employer, usdPerMonth: row.usdPerMonth },
                        e.target.value,
                      );
                  }}
                >
                  <option value="">Saved — move to…</option>
                  {APPLICATION_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              )}
            </td>
            <td>{Number.isFinite(row.usdPerMonth) ? `$${Math.round(row.usdPerMonth).toLocaleString('en-US')}` : '—'}</td>
            <td>{isoDate(row.at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Tile({ label, value, hint }) {
  return (
    <div className="funnel-tile" title={hint}>
      <span className="funnel-value">{value}</span>
      <span className="funnel-label">{label}</span>
    </div>
  );
}
