/**
 * The individual job page.
 *
 * Click through from a filtered list and the rate goes back to being raw
 * ("PHP 20-25K", "$900-$1000 USD") at exactly the moment you are deciding. The
 * parser already handles those strings, so this is only a matter of finding the
 * field and restating it in the unit the list uses.
 *
 * This page states its fields under headings rather than beside icons, so the
 * lookup differs from the search page. Everything below it is shared.
 */

/** The heading above the rate. Matched loosely: it reads "WAGE / SALARY". */
import { jobTypeSlug } from './find-listings.js';
import { chip } from './meta-row.js';
import { iconMarkup } from './meta-row.js';
import { findEmails } from '../core/contacts.js';
import { readSubjectInstruction } from '../core/job-export.js';

const RATE_HEADING = /\b(wage|salary)\b/i;
const TYPE_HEADING = /type\s*of\s*work/i;
const HOURS_HEADING = /hours\s*per\s*week/i;

const BAR_CLASS = 'ojrf-job-bar';

/** The site's facts card: four columns - type, wage, hours, date. */
const FACTS_CARD = '.card.job-post, .job-post';

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/**
 * The <dd> under a heading matching `pattern`.
 *
 * Keyed on the visible heading rather than on position or class, those being
 * the parts of a Bootstrap page most likely to be reshuffled.
 */
export function findField(doc, pattern) {
  for (const heading of doc.querySelectorAll('dd h3, dd h4, dd strong')) {
    if (pattern.test(clean(heading.textContent))) return heading.closest('dd');
  }
  return null;
}

/** The field's value lives in the paragraph beside its heading. */
function valueNode(field) {
  return field?.querySelector('p') ?? null;
}

/**
 * Read what the page states about this job.
 *
 * `jobType` is the slug the rest of the extension uses, not the page's wording:
 * it decides how a bare rate is read, so the job page and the results list have
 * to agree about it.
 *
 * @returns {{rateText: string|null, rateValue: Element|null, jobType: string|null,
 *   jobTypeLabel: string|null, title: string, found: boolean}}
 */
export function readJobPage(doc = document) {
  const rateValue = valueNode(findField(doc, RATE_HEADING));
  const typeValue = valueNode(findField(doc, TYPE_HEADING));
  const typeLabel = clean(typeValue?.textContent) || null;

  // The job page states this where the results card usually does not - measured
  // at 1 card in 30 - which is why the hours-aware conversion matters far more
  // here than in the list.
  const hoursText = clean(valueNode(findField(doc, HOURS_HEADING))?.textContent) ?? '';
  const hoursMatch = /(\d{1,3})/.exec(hoursText);
  const hours = hoursMatch ? Number(hoursMatch[1]) : NaN;

  return {
    rateText: clean(rateValue?.textContent) || null,
    rateValue,
    jobType: jobTypeSlug(typeLabel),
    jobTypeLabel: typeLabel,
    hoursPerWeek: Number.isFinite(hours) && hours > 0 && hours < 100 ? hours : null,
    title: clean(doc.querySelector('h1')?.textContent) || '(untitled job)',
    found: rateValue !== null,
  };
}

/**
 * The employer's name, as the page shows it above the title.
 *
 * Present only when signed in - the logged-out page drops the header block -
 * and as a heading with a logo class, which is the one stable hook it offers.
 * Absent, or a placeholder like "Not Given", and the employer controls simply
 * do not appear.
 *
 * @returns {string|null}
 */
export function readEmployerName(doc = document) {
  const heading = doc.querySelector('h3.job__logo, .job__logo');
  const name = clean(heading?.textContent);
  return name.length > 0 ? name : null;
}

/**
 * The site's own numeric id for the employer.
 *
 * Not shown anywhere a reader sees; it sits in the page's report-job script
 * as `const employerId = 966063;` - on every job page, signed in or not, and
 * whether or not the employer gave a name. Read from the page you are on
 * (or the document the modal fetched for you); never by opening one for it.
 *
 * @returns {string|null}
 */
export function readEmployerId(doc = document) {
  for (const script of doc.querySelectorAll('script:not([src])')) {
    const match = /\bemployerId\s*=\s*(\d{1,12})\b/.exec(script.textContent ?? '');
    if (match) return match[1];
  }
  return null;
}

/**
 * What the description says about how to apply: addresses written into it,
 * and a subject line it demands. Read from the page you are on.
 *
 * @returns {{emails: string[], subject: string|null}}
 */
export function readContacts(doc = document) {
  const text = doc.querySelector('#job-description, .job-description')?.textContent ?? '';
  return { emails: findEmails(text), subject: readSubjectInstruction(text) };
}

const NOTES_CLASS = 'ojrf-job-notes';

/**
 * Caveats about the employer, above the description.
 *
 * The standalone job page has everything the modal reads and was showing none
 * of it - the signals were wired into the modal only, so opening a job in a new
 * tab lost them. Same data, same wording, no extra request: this *is* the page.
 */
export function renderNotes(notes, doc = document) {
  clearNotes(doc);
  if (!notes || notes.length === 0) return null;

  const anchor = doc.querySelector('h1');
  if (!anchor) return null;

  const box = doc.createElement('div');
  box.className = `${NOTES_CLASS} ojrf-ui`;

  for (const note of notes) {
    const line = doc.createElement('p');
    line.className = 'ojrf-modal-warning';
    line.textContent = note;
    box.appendChild(line);
  }

  anchor.after(box);
  return box;
}

export function clearNotes(doc = document) {
  for (const node of doc.querySelectorAll(`.${NOTES_CLASS}`)) node.remove();
}

/**
 * One strip of ours under the site's facts card.
 *
 * The card keeps its four columns exactly as the site drew them; everything
 * the extension knows about this job - the converted rate, the level,
 * concerns, where your application stands - sits in a row of its own beneath,
 * in the same chips the results page uses so the two read alike.
 *
 * @param {{rateValue: Element|null}} job from readJobPage
 * @param {{chips: Array<{kind: string, text: string, tone?: string, title?: string,
 *   icon?: string, className?: string}>, actions: Array<{label: string, title?: string,
 *   pressed?: boolean, onClick: Function, kind?: string}>, status?: Element|null}} parts
 */
export function renderBar(job, { chips = [], actions = [], status = null } = {}) {
  const anchor = job?.rateValue?.closest(FACTS_CARD) ?? job?.rateValue?.closest('dl')?.parentElement;
  if (!anchor) return null;

  const doc = anchor.ownerDocument;
  let bar = doc.querySelector(`.${BAR_CLASS}`);
  if (!bar) {
    bar = doc.createElement('div');
    bar.className = `${BAR_CLASS} ojrf-ui`;
    anchor.insertAdjacentElement('afterend', bar);
  }
  bar.textContent = '';

  const row = doc.createElement('div');
  row.className = 'ojrf-job-bar-chips';
  for (const part of chips) {
    if (!part?.text) continue;
    const node = chip({
      className:
        part.className ??
        (part.kind === 'rate' ? 'ojrf-badge ojrf-badge-inline' : `ojrf-chip ojrf-chip-${part.kind}`),
      iconName: part.icon ?? ICON_FOR[part.kind] ?? 'work',
      text: part.text,
      title: part.title,
      tone: part.tone,
    });
    // A chip that does something - copy an address - is a button, and says so.
    if (part.onClick) {
      node.classList.add('ojrf-chip-button');
      node.setAttribute('role', 'button');
      node.tabIndex = 0;
      const run = (event) => {
        event.preventDefault();
        part.onClick(node);
      };
      node.addEventListener('click', run);
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') run(event);
      });
    }
    row.appendChild(node);
  }
  bar.appendChild(row);

  const controls = doc.createElement('div');
  controls.className = 'ojrf-job-bar-actions';
  if (status) controls.appendChild(status);
  for (const action of actions) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = action.pressed ? 'ojrf-job-dismiss ojrf-job-dismiss-on' : 'ojrf-job-dismiss';
    if (action.kind) button.dataset.kind = action.kind;
    if (action.icon) button.innerHTML = iconMarkup(action.icon);
    // Icon-only buttons keep their words for the tooltip and the screen reader:
    // a row of six labelled buttons crowded the strip off its single line.
    if (action.iconOnly && action.icon) {
      button.classList.add('ojrf-job-icon');
      button.setAttribute('aria-label', action.label);
      button.title = action.title ? `${action.label} — ${action.title}` : action.label;
    } else {
      button.appendChild(doc.createTextNode(action.label));
      if (action.title) button.title = action.title;
    }
    if (action.pressed !== undefined) button.setAttribute('aria-pressed', String(action.pressed));
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      action.onClick(event);
    });
    controls.appendChild(button);
  }
  bar.appendChild(controls);

  return bar;
}

const ICON_FOR = {
  email: 'mail',
  subject: 'tag',
  rate: 'coin',
  level: 'seed',
  concerns: 'warn',
  applied: 'check',
  followup: 'bell',
  type: 'work',
};

export function clearBar(doc = document) {
  for (const node of doc.querySelectorAll(`.${BAR_CLASS}`)) node.remove();
}

/** Take everything of ours back off the page. */
export function clearJobPage(doc = document) {
  clearNotes(doc);
  clearBar(doc);
}
