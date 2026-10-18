/**
 * Content script entry point for an individual job page.
 *
 * Deliberately much smaller than the search page's: there is one listing, no
 * filtering to do and nothing to collapse. Everything the extension knows about
 * the job goes into one strip of ours under the site's facts card - the rate in
 * the unit the list uses, whether it reads as beginner-friendly, what to be
 * careful of, where your application stands - and the site's own card is left
 * exactly as it was drawn. One setting takes the strip away and gives the page
 * back untouched.
 */

import { loadSettings, saveSettings, onSettingsChanged } from '../core/settings.js';
import { jobKey, loadDismissed, setDismissed, onDismissedChanged } from '../core/dismissed.js';
import {
  APPLICATION_STATUSES,
  loadApplications,
  setApplication,
  markFollowedUp,
  onApplicationsChanged,
} from '../core/applications.js';
import { readRate } from '../core/custom-rules.js';
import { decide, formatUsd, formatRate } from '../core/normalize.js';
import { readRateIntent, RATE_INTENTS } from '../core/rate-intent.js';
import {
  readJobPage,
  readEmployerName,
  readEmployerId,
  readContacts,
  renderBar,
  renderNotes,
  clearJobPage,
} from './job-page.js';
import {
  loadBook,
  setBlocked,
  setNote,
  rememberSignals,
  isBlocked,
  noteFor,
  jobsOpened,
  canIdentify,
  onBookChanged,
} from '../core/employer-book.js';
import { readEmployerSignals } from '../core/employer-signals.js';
import { findRedFlags } from '../core/red-flags.js';
import { gatherConcerns, describeConcerns, explainConcerns } from '../core/concerns.js';
import { matchSkills } from '../core/skill-match.js';
import { judgeExperience, describeLevel, LEVELS } from '../core/experience-level.js';
import { isDue, dueFollowUps } from '../core/follow-ups.js';
import { toTabDelimited } from '../core/job-export.js';
import { writeToClipboard } from './job-modal.js';
import { createDraftPanel } from './draft-panel.js';
import { createAnalysisPanel } from './analysis-panel.js';
import { draftDeps } from './draft-deps.js';
import { iconMarkup } from './meta-row.js';
import { createWidgetShell } from './widget-shell.js';
import { mountDock } from './dock.js';

let settings = null;
let dismissed = new Set();
let applications = new Map();
let book = new Map();
let job = null;
/**
 * The employer as this page knows them: the name above the title when signed
 * in, and the site's numeric id from the report script. Either is enough to
 * remember them by; "Not Given" with an id is still somebody.
 */
let employer = { name: null, id: null };
/** What to call them in a button's wording. */
const employerLabel = () => (canIdentify({ name: employer.name }) ? employer.name : 'this employer');

const key = jobKey(window.location.pathname);

/** How the rate chip should read, and in which tone. Mirrors the search page. */
function rateChip(verdict, intent, settings) {
  // A gig quoting one figure is quoting the fee for the work.
  if (verdict.reason === 'fixed-fee') {
    return {
      text:
        verdict.fixedFeeUsd !== null ? `${formatUsd(verdict.fixedFeeUsd)} fixed` : 'paid per task',
      tone: 'task',
    };
  }
  if (verdict.reason === 'task-based') return { text: 'paid per task', tone: 'task' };
  if (verdict.usdPerMonth !== null) {
    return {
      text: `${verdict.assumed ? '~' : ''}${formatRate(verdict, settings)}`,
      tone: verdict.assumed ? 'assumed' : 'ok',
    };
  }
  // Open rather than absent - the figure is still in play.
  if (intent === RATE_INTENTS.NEGOTIABLE) {
    return { text: 'negotiable', tone: 'open', icon: 'swing' };
  }
  if (intent === RATE_INTENTS.UNSTATED) return { text: 'not stated', tone: 'unknown' };

  return { text: 'rate unclear', tone: 'unknown' };
}

/** The description's text, for the level and the flags. */
function descriptionText() {
  return document.querySelector('#job-description, .job-description')?.textContent ?? '';
}

/** Where the monthly figure came from, for the chip's tooltip. */
function rateTitle(verdict) {
  const listed = job.rateText ? `Listed as: ${job.rateText}` : 'No rate given';
  if (!verdict.hoursPerWeek) return listed;
  const perHour = Number.isFinite(verdict.usdPerHour)
    ? ` — about $${verdict.usdPerHour.toFixed(2)}/hour`
    : '';
  return `${listed}\nConverted at ${verdict.hoursPerWeek} hrs/week${perHour}`;
}

/** Copy, and say so on the chip itself for a moment. */
async function copyInto(node, text) {
  const label = node.querySelector('span:last-child');
  const before = label?.textContent;
  const ok = await writeToClipboard(text);
  if (!label) return;
  label.textContent = ok ? 'Copied' : 'Could not copy';
  setTimeout(() => {
    label.textContent = before;
  }, 1400);
}

/** The status control: a select once you applied, a button before. */
function statusControl() {
  if (!key) return null;
  const application = applications.get(key);

  if (!application) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ojrf-job-dismiss';
    button.className = 'ojrf-job-dismiss ojrf-job-icon';
    button.dataset.kind = 'mark-applied';
    button.innerHTML = iconMarkup('check');
    button.setAttribute('aria-label', 'Mark as applied');
    button.title = 'Mark as applied — record that you applied, so the results list says so';
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      applications = await setApplication(key, {
        title: job.title,
        employer: employer.name ?? '',
        url: window.location.pathname,
        usdPerMonth: job.usdPerMonth,
      });
      render();
    });
    return button;
  }

  const wrap = document.createElement('span');
  wrap.className = 'ojrf-job-status';

  const select = document.createElement('select');
  select.className = 'ojrf-modal-status';
  select.setAttribute('aria-label', 'Application status');
  for (const status of APPLICATION_STATUSES) {
    const option = document.createElement('option');
    option.value = status.value;
    option.textContent = status.label;
    if (status.value === application.status) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', async () => {
    applications = await setApplication(key, { status: select.value });
    render();
  });
  wrap.appendChild(select);

  // A nudge is not a reply, so it is a button rather than a status.
  if (application.status === 'applied') {
    const followed = document.createElement('button');
    followed.type = 'button';
    followed.className = 'ojrf-job-dismiss ojrf-job-icon';
    followed.dataset.kind = 'followed-up';
    followed.innerHTML = iconMarkup('bell');
    followed.setAttribute('aria-label', 'Followed up');
    followed.title = 'Followed up — note that you nudged them; the reminder starts again from now';
    followed.addEventListener('click', async (event) => {
      event.preventDefault();
      applications = await markFollowedUp(key);
      render();
    });
    wrap.appendChild(followed);
  }

  return wrap;
}

function render() {
  if (!job?.found) return;

  // "Original": nothing of ours on the page at all.
  if (!settings.enabled || !settings.showBadges || !settings.jobPageBar) {
    clearJobPage();
    return;
  }

  let parsed = null;
  try {
    parsed = readRate(job.rateText, settings.customRules, settings.vocabulary);
  } catch {
    parsed = null; // A parser crash must not break the page.
  }

  // The job type goes in: on a gig, a bare "60.00" is a $60 fee for the work,
  // not $60 an hour. Hours are stated on this page even when the card omitted them.
  const verdict = decide(parsed, settings, {
    jobType: job.jobType,
    hoursPerWeek: job.hoursPerWeek,
  });
  job.usdPerMonth = verdict.usdPerMonth;

  const text = descriptionText();
  const chips = [];

  chips.push({
    kind: 'rate',
    ...rateChip(verdict, readRateIntent(job.rateText), settings),
    title: rateTitle(verdict),
  });

  // How many of your own skills this post mentions - a free, local preview of
  // fit, drawn from the skills you filter by. Only shown once you have listed some.
  if (Array.isArray(settings.requiredSkills) && settings.requiredSkills.length > 0) {
    const skills = matchSkills(`${job.title}\n${text}`, settings.requiredSkills);
    if (skills.total > 0) {
      chips.push({
        kind: 'skill',
        icon: 'star',
        text: `Skills ${skills.matched.length}/${skills.total}`,
        title:
          `Your skills in this post — matched: ${skills.matched.join(', ') || 'none'}` +
          (skills.missing.length ? ` · not found: ${skills.missing.join(', ')}` : ''),
      });
    }
  }

  // Read from the full description, which is the whole point of being here.
  if (settings.showExperienceChip) {
    const level = judgeExperience(job.title, text);
    if (level.level !== LEVELS.UNCLEAR) {
      chips.push({
        kind: 'level',
        text: describeLevel(level.level),
        tone: level.level,
        icon: level.level === LEVELS.BEGINNER ? 'seed' : 'star',
        title: `${describeLevel(level.level)}: ${level.why}`,
      });
    }
  }

  // How they want to be reached, when the post says. Click to copy: an address
  // in a paragraph is the thing you would otherwise select by hand.
  const contacts = readContacts(document);
  for (const email of contacts.emails) {
    chips.push({
      kind: 'email',
      text: email,
      title: 'Click to copy this address',
      onClick: (node) => copyInto(node, email),
    });
  }
  if (contacts.subject) {
    chips.push({
      kind: 'subject',
      text: `Subject: ${contacts.subject}`,
      title: 'The employer asks for this subject line. Click to copy it.',
      onClick: (node) => copyInto(node, contacts.subject),
    });
  }

  // Read from the page you are already on - no request, no crawling.
  const signals = readEmployerSignals(document);

  // A note you wrote on this employer, in its own colour - yours, not a warning.
  const note = noteFor(book, employer);
  if (note) {
    chips.push({ kind: 'note', icon: 'note', text: note.length > 60 ? `${note.slice(0, 59)}…` : note, title: `Your note: ${note}` });
  }

  // The third job you have opened from these people is worth knowing as such,
  // especially when they did not give a name. Counted from pages you opened.
  const opened = jobsOpened(book, employer);
  if (opened > 1) {
    chips.push({
      kind: 'employer',
      icon: 'people',
      text: `${opened} of their jobs opened`,
      title: `You have opened ${opened} jobs from this employer${employer.id ? ` (site id ${employer.id})` : ''}`,
    });
  }

  const concerns = gatherConcerns({
    flags: settings.showRedFlags ? findRedFlags(text) : [],
    employerMemory: { newAccount: Boolean(signals.newAccount), censored: signals.censored },
  });
  if (concerns.length > 0) {
    chips.push({
      kind: 'flag',
      icon: 'warn',
      text: describeConcerns(concerns),
      title: explainConcerns(concerns),
    });
  }

  const application = key ? applications.get(key) : null;
  if (application) {
    const label =
      APPLICATION_STATUSES.find((s) => s.value === application.status)?.label ?? 'Applied';
    chips.push({
      kind: 'applied',
      className: 'ojrf-chip ojrf-chip-applied',
      icon: 'check',
      text: label,
      title: `Applied ${new Date(application.appliedAt).toLocaleDateString()}`,
    });
    if (settings.showFollowUpChip && isDue(application, Date.now(), settings.followUpDays)) {
      const [due] = dueFollowUps(new Map([[key, application]]), Date.now(), settings.followUpDays);
      chips.push({
        kind: 'followup',
        icon: 'bell',
        text: `follow up · ${due.daysWaiting}d`,
        title: 'No reply yet. Worth a follow-up.',
      });
    }
  }

  const actions = [];
  if (key) {
    const off = dismissed.has(key);
    actions.push({
      kind: 'dismiss',
      icon: 'cross',
      iconOnly: true,
      label: off ? 'Dismissed - restore' : 'Dismiss this job',
      title: off
        ? 'Show this job in your search results again'
        : 'Keep this job collapsed in your search results',
      pressed: off,
      onClick: async () => {
        // Optimistic, then confirmed - same as the search page.
        if (!off) dismissed.add(key);
        else dismissed.delete(key);
        render();
        dismissed = await setDismissed(key, !off);
        render();
      },
    });
  }
  // Block and note are about the employer, so they need the page to identify
  // one - by name, or by the id the page carries even when the name is withheld.
  if (canIdentify(employer)) {
    const blocked = isBlocked(book, employer);
    actions.push({
      kind: 'block',
      icon: 'ban',
      iconOnly: true,
      label: blocked ? 'Unblock employer' : 'Block employer',
      title: blocked
        ? `Show listings from ${employerLabel()} again`
        : `Collapse every listing from ${employerLabel()}`,
      pressed: blocked,
      onClick: async () => {
        book = await setBlocked(employer, !blocked);
        render();
      },
    });
    actions.push({
      kind: 'note',
      icon: 'note',
      iconOnly: true,
      label: note ? 'Edit note' : 'Note…',
      title: note ? `Your note: ${note}` : `Keep a note on ${employerLabel()}`,
      onClick: async () => {
        const next = window.prompt(`Note on ${employerLabel()}`, note);
        if (next === null) return;
        book = await setNote(employer, next);
        render();
      },
    });
  }
  actions.push({
    kind: 'copy',
    icon: 'copy',
    iconOnly: true,
    label: 'Copy row',
    title: 'Copy this job as a spreadsheet row',
    onClick: async (event) => {
      const row = toTabDelimited({
        title: job.title,
        employer: '',
        rateText: job.rateText,
        usdPerMonth: verdict.usdPerMonth,
        jobType: job.jobTypeLabel,
        hoursPerWeek: job.hoursPerWeek ?? '',
        postedAt: Date.now(),
        status: application?.status ?? '',
        url: window.location.href,
      });
      const ok = await writeToClipboard(row);
      const button = event.currentTarget;
      if (!button) return;
      // Say so with the icon itself, then put the copy glyph back.
      button.innerHTML = iconMarkup(ok ? 'check' : 'cross');
      button.title = ok ? 'Copied' : 'Could not copy';
      setTimeout(() => {
        button.innerHTML = iconMarkup('copy');
        button.title = 'Copy row — copy this job as a spreadsheet row';
      }, 1400);
    },
  });

  const bar = renderBar(job, { chips, actions, status: statusControl() });

  // Drafting. Built once and kept: unlike the modal, the job page's render runs
  // in place, so re-rendering must not wipe a draft you are editing. The button
  // lives on the strip; its panel sits just under it.
  mountDraft(bar);

  // The same caveats the modal shows, above the description where you read.
  renderNotes([...signals.notes]);
}

/** The draft panel for this page, created lazily and only once. */
let draftPanel = null;
function mountDraft(bar) {
  if (!bar || draftPanel || !key) return;
  const host = document.createElement('div');
  host.className = 'ojrf-job-draft';
  bar.insertAdjacentElement('afterend', host);

  draftPanel = createDraftPanel(
    draftDeps({
      getSettings: () => settings,
      saveSettings: async (patch) => {
        settings = await saveSettings(patch);
      },
      onCredits: () => {},
      openOptions: () => chrome.runtime.sendMessage({ type: 'open-options' }),
    }),
  );
  const jobForPanel = {
    jobKey: key,
    url: window.location.pathname,
    title: job.title,
    employer: employer.name ?? '',
    rateText: job.rateText ?? '',
    description: descriptionText(),
    subject: readContacts(document).subject ?? '',
  };
  draftPanel.mount({
    actionsHost: bar.querySelector('.ojrf-job-bar-actions') ?? bar,
    panelHost: host,
    job: jobForPanel,
  });

  // AI insights sit under the draft panel, on the same job and profile.
  const aiHost = document.createElement('div');
  aiHost.className = 'ojrf-ai-host';
  host.appendChild(aiHost);
  createAnalysisPanel({
    openOptions: () => chrome.runtime.sendMessage({ type: 'open-options' }),
  }).mount({ panelHost: aiHost, job: jobForPanel });
}

async function start() {
  [settings, dismissed, applications, book] = await Promise.all([
    loadSettings(),
    loadDismissed(),
    loadApplications(),
    loadBook(),
  ]);

  job = readJobPage();
  if (!job.found) return;
  employer = { name: readEmployerName(), id: readEmployerId() };

  render();

  // The dock belongs on this page too: an individual job is where you reach for
  // a snippet to answer it, or start the clock on the test task it asked for.
  mountDock(createWidgetShell());

  // What this page says about the employer, and that you opened this job of
  // theirs, remembered so their next card can say so. This is the page you
  // opened; nothing is fetched.
  if (canIdentify(employer) && settings.enabled) {
    const signals = readEmployerSignals(document);
    book = await rememberSignals(employer, {
      newAccount: Boolean(signals.newAccount),
      censored: Boolean(signals.censored),
      jobKey: key,
    });
  }

  onSettingsChanged((next) => {
    settings = next;
    render();
  });

  onDismissedChanged((next) => {
    dismissed = next;
    render();
  });

  onApplicationsChanged((next) => {
    applications = next;
    render();
  });

  onBookChanged((next) => {
    book = next;
    render();
  });
}

start().catch((error) => {
  console.error('[onlinejobs rate filter] job page failed to start:', error);
});
