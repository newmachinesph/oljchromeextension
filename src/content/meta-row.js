/**
 * The per-listing meta row: one line of icon chips for the things you actually
 * scan by - when it was posted, what it pays, what kind of work it is.
 *
 * It supersedes the site's "Posted on 2026-08-17 16:07:49" text and its
 * job-type chip, both of which are hidden rather than removed, so switching the
 * extension off restores the card as the site built it.
 */

import { formatRelativeTime, formatExactTime } from '../core/format-time.js';
import { APPLICATION_STATUSES } from '../core/applications.js';
import { iconMarkup as sharedIcon } from '../core/icons.js';

const APPLICATION_LABELS = Object.fromEntries(
  APPLICATION_STATUSES.map((entry) => [entry.value, entry.label]),
);

const ROW_CLASS = 'ojrf-meta';
const HOST_CLASS = 'ojrf-meta-host';
const AVATAR_CLASS = 'ojrf-avatar';
/** The employer logo, present on some listings and not others. */
const SITE_LOGO = '.jobpost-cat-box-logo';
const HAS_AVATAR_CLASS = 'ojrf-has-avatar';
/** Marks a card we have decorated, so the description can be spaced off the chips. */
const HAS_META_CLASS = 'ojrf-has-meta';
const INSET_VAR = '--ojrf-avatar-inset';
/** Matches the real logo: 80px box plus the site's 16px gutter. */
const AVATAR_COLUMN = 96;
const CHIP_CLASS = 'ojrf-chip';
const BADGE_CLASS = 'ojrf-badge';
const PART_HIDDEN = 'ojrf-part-hidden';
const HEADING_CHIP = 'h1 .badge, h2 .badge, h3 .badge, h4 .badge, h5 .badge';

/** element -> meta row, so we can find and remove our own insertion. */
const rows = new WeakMap();

const JOB_TYPE_LABELS = {
  'full-time': 'Full Time',
  'part-time': 'Part Time',
  gig: 'Gig',
  any: 'Any',
};

/**
 * A line icon, sized to sit on a text baseline.
 *
 * The drawings used to live in this file - eighteen of them, hand-drawn, and
 * one (`tag`) defined twice so half of it was dead code nobody could see. They
 * come from core/icons.js now, which is Lucide, so a chip here and a dock icon
 * are the same shape at different weights.
 */
export function iconMarkup(name) {
  return sharedIcon(name, { size: 13, stroke: 1.9, className: 'ojrf-icon' });
}

/** One chip: an icon and a label. Shared with the job page's strip. */
export function chip({ className, iconName, text, title, tone }) {
  const el = document.createElement('span');
  el.className = className;
  if (tone) el.dataset.tone = tone;
  if (title) el.title = title;
  el.innerHTML = iconMarkup(iconName);

  const label = document.createElement('span');
  label.textContent = text;
  el.appendChild(label);

  return el;
}

/**
 * Give logo-less listings a placeholder, so every card's text starts at the
 * same x. Without it the column edge jumps about as you scan down.
 *
 * These cards are built differently from the ones with a logo - no flex row at
 * all, everything inside a single anchor - so rather than restructure the site's
 * DOM, the card gets a left inset and the placeholder is positioned into it.
 * That is a class and one custom property, both trivially removable.
 */
function ensureAvatar(listing) {
  const card = listing.element;
  if (card.querySelector(SITE_LOGO) || card.querySelector(`.${AVATAR_CLASS}`)) return;

  // Read the card's own padding before adding the class that changes it.
  const inset = Number.parseFloat(getComputedStyle(card).paddingLeft) || 16;
  card.style.setProperty(INSET_VAR, `${inset}px`);
  card.style.setProperty('--ojrf-avatar-column', `${AVATAR_COLUMN}px`);
  card.classList.add(HAS_AVATAR_CLASS);

  const avatar = document.createElement('div');
  avatar.className = AVATAR_CLASS;
  avatar.setAttribute('aria-hidden', 'true');
  avatar.innerHTML =
    '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"' +
    ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="7.5" width="18" height="12" rx="2"/>' +
    '<path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3 12h18"/></svg>';

  const wrapper = document.createElement('div');
  wrapper.className = `${AVATAR_CLASS}-wrap`;
  wrapper.appendChild(avatar);

  card.insertBefore(wrapper, card.firstChild);
}

function clearAvatar(listing) {
  const card = listing.element;
  card.querySelector(`.${AVATAR_CLASS}-wrap`)?.remove();
  card.classList.remove(HAS_AVATAR_CLASS);
  card.style.removeProperty(INSET_VAR);
  card.style.removeProperty('--ojrf-avatar-column');
}

function setDuplicatesHidden(listing, hidden) {
  const nodes = [
    listing.badgeHost?.querySelector('em'),
    listing.element.querySelector(HEADING_CHIP),
  ];
  for (const node of nodes) node?.classList.toggle(PART_HIDDEN, hidden);
}

/**
 * The "I have looked at this one" control.
 *
 * Both handlers are cancelled: logo-less cards put the whole card inside one
 * anchor, so without this, dismissing a listing would navigate to it.
 */
/**
 * A bookmark toggle on the card itself, so a job can be set aside without
 * opening it. Optimistic: it flips on click and a later re-render confirms it
 * against the store, so it feels instant on a long list.
 */
function saveButton(listing, onSave, isSaved) {
  const button = document.createElement('button');
  button.type = 'button';
  let on = Boolean(isSaved?.(listing.jobKey));
  const paint = () => {
    button.className = on ? 'ojrf-save ojrf-save-on' : 'ojrf-save';
    button.innerHTML = iconMarkup('bookmark');
    button.title = on ? 'Saved - click to remove' : 'Save for later';
    button.setAttribute('aria-label', on ? `Saved ${listing.title}` : `Save ${listing.title} for later`);
    button.setAttribute('aria-pressed', String(on));
  };
  paint();
  button.addEventListener('click', (event) => {
    // The card is an anchor; without this, saving would navigate to the job.
    event.preventDefault();
    event.stopPropagation();
    on = !on;
    paint();
    onSave(listing);
  });
  return button;
}

function dismissButton(listing, onDismiss) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ojrf-dismiss';
  button.title = 'Dismiss - keep this one collapsed on later visits';
  button.setAttribute('aria-label', `Dismiss ${listing.title}`);
  button.innerHTML = iconMarkup('cross');

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onDismiss(listing);
  });

  return button;
}

/**
 * Build or refresh the row.
 *
 * @param {object} listing a scanned listing record
 * @param {object} parts   {rate, tone, jobType, postedAt, now, onDismiss}
 */
export function renderMeta(
  listing,
  {
    rate,
    tone,
    icon,
    jobType,
    postedAt,
    now,
    onDismiss,
    onSave,
    isSaved,
    application,
    isNew,
    standing,
    standingTone,
    employer,
    hoursPerWeek,
    usdPerHour,
    concerns,
    concernsWhy,
    level,
    levelTone,
    levelWhy,
    note,
    followUp,
  },
) {
  const host = listing.badgeHost ?? listing.element;

  let row = rows.get(listing.element);
  if (!row) {
    row = document.createElement('span');
    row.className = ROW_CLASS;
    host.appendChild(row);
    host.classList.add(HOST_CLASS); // spacing between the chips and the text below
    listing.element.classList.add(HAS_META_CLASS);
    rows.set(listing.element, row);
  }
  row.textContent = '';

  ensureAvatar(listing);

  // First on the row. Everything else answers "is this worth my time"; this
  // answers "will this cost me", which is the question to read first. One chip
  // for every concern - phrases, the employer, staleness, the rate - with the
  // most serious leading and the rest in the tooltip.
  if (concerns) {
    row.appendChild(
      chip({
        className: `${CHIP_CLASS} ${CHIP_CLASS}-flag`,
        iconName: 'warn',
        text: concerns,
        title: concernsWhy || concerns,
      }),
    );
  }

  if (isNew) {
    row.appendChild(
      chip({
        className: `${CHIP_CLASS} ${CHIP_CLASS}-new`,
        iconName: 'spark',
        text: 'New',
        title: 'Posted since you were last here',
      }),
    );
  }

  const relative = formatRelativeTime(postedAt, now);
  if (relative) {
    row.appendChild(
      chip({
        className: `${CHIP_CLASS} ${CHIP_CLASS}-date`,
        iconName: 'clock',
        text: relative,
        title: `Posted ${formatExactTime(postedAt)}`,
      }),
    );
  }

  const listedAs = listing.rateText ? `Listed as: ${listing.rateText}` : 'No rate given';
  // Where the monthly figure came from. Worth saying outright: the same "$5/hr"
  // is $867/month at 40 hours a week and $433 at 20, and a reader has no way to
  // tell which we used.
  const basis = hoursPerWeek
    ? `Converted at ${hoursPerWeek} hrs/week${
        Number.isFinite(usdPerHour) ? ` — about $${usdPerHour.toFixed(2)}/hour` : ''
      }`
    : '';
  const rateEl = chip({
    className: `${BADGE_CLASS} ${BADGE_CLASS}-inline`,
    iconName: icon ?? 'coin',
    text: rate,
    tone,
    title: [listedAs, basis, standing].filter(Boolean).join('\n'),
  });

  // Only the ends are marked. Annotating every listing would be noise; an arrow
  // on the unusually good and the unusually poor is signal.
  if (standingTone) {
    const mark = document.createElement('span');
    mark.className = `ojrf-standing ojrf-standing-${standingTone}`;
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = standingTone === 'high' ? '▲' : '▼';
    rateEl.appendChild(mark);
  }

  row.appendChild(rateEl);

  // Where an application got to. Placed before the job type because "you already
  // applied to this" outranks "it is full time" when scanning a long list.
  if (application) {
    // Named apart from the chip() helper above rather than shadowing it, since
    // that helper is called again a few lines down.
    const statusChip = document.createElement('span');
    statusChip.className = `${CHIP_CLASS} ${CHIP_CLASS}-applied`;
    statusChip.dataset.status = application.status;
    statusChip.title = `Applied ${formatExactTime(application.appliedAt)}`;
    statusChip.innerHTML = iconMarkup('check');

    const label = document.createElement('span');
    label.textContent = APPLICATION_LABELS[application.status] ?? 'Applied';
    statusChip.appendChild(label);

    row.appendChild(statusChip);
  }

  // Right after the status it qualifies: applied, and waiting on you.
  if (followUp) {
    row.appendChild(
      chip({
        className: `${CHIP_CLASS} ${CHIP_CLASS}-followup`,
        iconName: 'bell',
        text: followUp,
        title: 'No reply yet. Worth a follow-up - mark it done from the job details.',
      }),
    );
  }

  // Context rather than a property of the job, so it sits after the facts about
  // the job itself. Present only when the employer posted more than once - on a
  // merged page that was 12 employers out of 105.
  if (employer) {
    const copies = employer.match(/^(\d+)/);
    row.appendChild(
      chip({
        className: `${CHIP_CLASS} ${CHIP_CLASS}-employer`,
        iconName: 'people',
        text: copies ? `${copies[1]} jobs` : employer,
        title: employer,
      }),
    );
  }

  if (JOB_TYPE_LABELS[jobType]) {
    row.appendChild(
      chip({
        className: `${CHIP_CLASS} ${CHIP_CLASS}-type`,
        iconName: 'work',
        text: JOB_TYPE_LABELS[jobType],
      }),
    );
  }

  // Something you wrote about this employer. Yours, so it reads in its own
  // colour rather than as a warning, and it travels to every card of theirs.
  if (note) {
    row.appendChild(
      chip({
        className: `${CHIP_CLASS} ${CHIP_CLASS}-note`,
        iconName: 'note',
        text: note.length > 40 ? `${note.slice(0, 39)}…` : note,
        title: `Your note: ${note}`,
      }),
    );
  }

  // Whether the listing says it is for beginners, or for the experienced.
  // After the job type because both describe who the job is for; absent when
  // the listing says neither, which is most of them.
  if (level) {
    row.appendChild(
      chip({
        className: `${CHIP_CLASS} ${CHIP_CLASS}-level`,
        iconName: levelTone === 'beginner' ? 'seed' : 'star',
        text: level,
        title: levelWhy ? `${level}: ${levelWhy}` : level,
        tone: levelTone,
      }),
    );
  }

  // Last, and pushed to the far end of the row: it is the one destructive thing
  // on the card, so it should never sit under a cursor heading for a chip.
  if (onSave && listing.jobKey) {
    row.appendChild(saveButton(listing, onSave, isSaved));
  }

  if (onDismiss && listing.jobKey) {
    row.appendChild(dismissButton(listing, onDismiss));
  }

  setDuplicatesHidden(listing, true);
}

/** Remove the row and give the site's own text back. */
export function clearMeta(listing) {
  const row = rows.get(listing.element);
  if (row) {
    row.remove();
    rows.delete(listing.element);
  }
  listing.badgeHost?.classList.remove(HOST_CLASS);
  listing.element.classList.remove(HAS_META_CLASS);
  clearAvatar(listing);
  setDuplicatesHidden(listing, false);
}
