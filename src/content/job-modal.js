/**
 * Opening a job without leaving the results.
 *
 * Reading a job is a decision you make against the list, so losing the list,
 * the filter and your scroll position in order to read one description is the
 * wrong trade. The job is fetched and shown over the page instead, and closing
 * it puts you back exactly where you were.
 *
 * The fetch shares the same throttle gate as page merging, so opening jobs
 * quickly cannot pile requests on top of a merge already running. It is also
 * where we learn a post has been deleted: the site answers 410, and the listing
 * can then be collapsed for good.
 */

import { fetchDocument } from './prefetch.js';
import { readJobPage } from './job-page.js';
import { isGone } from '../core/expired.js';
import { readEmployerSignals } from '../core/employer-signals.js';
import { findEmails } from '../core/contacts.js';
import { iconMarkup } from './meta-row.js';
import { parseBlocks, splitBold, looksLikeMarkdown } from '../core/markdown-lite.js';

/**
 * Build the parsed description into real nodes.
 *
 * Every string goes in through textContent - the parser hands back structure,
 * never markup, precisely so this stays true of a remote document.
 */
function renderBlocks(blocks, holder, doc) {
  const withBold = (parent, text) => {
    for (const run of splitBold(text)) {
      const node = run.bold ? doc.createElement('strong') : doc.createTextNode(run.text);
      if (run.bold) {
        node.textContent = run.text;
        parent.appendChild(node);
      } else {
        parent.appendChild(node);
      }
    }
  };

  for (const block of blocks) {
    if (block.type === 'rule') {
      holder.appendChild(doc.createElement('hr'));
      continue;
    }

    if (block.type === 'heading') {
      // Clamped to h4-h6: the modal already owns the h-levels above it, and a
      // description must not outrank the job title.
      const el = doc.createElement(`h${Math.min(6, block.level + 3)}`);
      el.className = 'ojrf-desc-h';
      el.textContent = block.text;
      holder.appendChild(el);
      continue;
    }

    if (block.type === 'list') {
      const list = doc.createElement(block.ordered ? 'ol' : 'ul');
      list.className = 'ojrf-desc-list';
      for (const item of block.items) {
        const li = doc.createElement('li');
        withBold(li, item);
        list.appendChild(li);
      }
      holder.appendChild(list);
      continue;
    }

    const para = doc.createElement('p');
    para.className = 'ojrf-desc-p';
    withBold(para, block.text);
    holder.appendChild(para);
  }
}
import { readEmployerId } from './job-page.js';
import { canIdentify } from '../core/employer-book.js';
import { judgeExperience, describeLevel, LEVELS } from '../core/experience-level.js';
import { findRedFlags, explainRedFlags } from '../core/red-flags.js';
import { jobKey } from '../core/dismissed.js';
import { MAX_TAGS_PER_JOB } from '../core/job-tags.js';
import { MAX_NOTE_LENGTH } from '../core/job-notes.js';
import { APPLICATION_STATUSES } from '../core/applications.js';
import { toTabDelimited, readSubjectInstruction } from '../core/job-export.js';

const ROOT_ID = 'ojrf-modal';
const OPEN_CLASS = 'ojrf-modal-open';
const JOB_LINK = 'a[href*="/jobseekers/job/"]';
const CARD = '.jobpost-cat-box';

/** The employer named on a results card, if that card names one. */
function employerOf(card) {
  const block = card?.querySelector('[data-temp]');
  if (!block) return '';

  const lead = Array.from(block.childNodes)
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent)
    .join(' ');

  return clean(lead).replace(/[•·|,\s]+$/, '').trim();
}

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/** The fields the job page states under headings, as label/value pairs. */
function readFacts(doc) {
  return Array.from(doc.querySelectorAll('dd'), (dd) => {
    const heading = dd.querySelector('h3, h4, strong');
    const value = dd.querySelector('p');
    if (!heading || !value) return null;
    return { label: clean(heading.textContent), value: clean(value.textContent) };
  }).filter((entry) => entry && entry.value.length > 0);
}

/**
 * Put text on the clipboard, by whichever route works.
 *
 * navigator.clipboard is the right API and refuses in more situations than you
 * would expect - an unfocused document is enough. The old selection-and-copy
 * trick has none of those conditions, so it stands behind as a fallback rather
 * than leaving the button dead.
 */
export async function writeToClipboard(text, doc = document) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall through.
  }

  const holder = doc.createElement('textarea');
  holder.value = text;
  // Off-screen rather than hidden: a display:none element cannot be selected.
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;';
  doc.body.appendChild(holder);
  holder.select();

  let copied = false;
  try {
    copied = doc.execCommand('copy');
  } catch {
    copied = false;
  }

  holder.remove();
  return copied;
}

function build(doc) {
  const root = doc.createElement('div');
  root.id = ROOT_ID;
  root.className = 'ojrf-ui';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Job details');
  root.hidden = true;

  root.innerHTML = `
    <div class="ojrf-modal-backdrop"></div>
    <div class="ojrf-modal-panel">
      <header class="ojrf-modal-head">
        <h2 class="ojrf-modal-title"></h2>
        <div class="ojrf-modal-tools">
          <button type="button" class="ojrf-modal-save ojrf-icon-button" hidden
                  title="Save this job for later" aria-label="Save for later">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M6.5 3.8h11v16.4L12 16l-5.5 4.2Z"/>
            </svg>
          </button>
          <button type="button" class="ojrf-modal-copy ojrf-icon-button"
                  title="Copy as a spreadsheet row" aria-label="Copy as a spreadsheet row">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2"/>
              <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>
            </svg>
          </button>
          <a class="ojrf-modal-open-tab ojrf-icon-button" target="_blank" rel="noopener"
             title="Open this job in a new tab" aria-label="Open this job in a new tab">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M14 4h6v6M20 4l-8.5 8.5"/>
              <path d="M18 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5.5"/>
            </svg>
          </a>
          <button type="button" class="ojrf-modal-close ojrf-icon-button"
                  title="Close" aria-label="Close">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>
            </svg>
          </button>
        </div>
      </header>
      <div class="ojrf-modal-body"></div>
      <!-- Pinned below the scrolling body: the rate is what you are deciding on
           and applying is what you came to do, so neither should scroll away
           part-way down a long description. -->
      <footer class="ojrf-modal-foot">
        <div class="ojrf-modal-rate ojrf-badge"></div>
        <div class="ojrf-modal-actions"></div>
        <div class="ojrf-modal-notes"></div>
        <div class="ojrf-modal-draft"></div>
      </footer>
    </div>`;

  return root;
}

/**
 * @param {object} hooks
 * @param {Function} hooks.describeRate (rateText, jobType) -> {rate, tone}, so
 *   the modal states the rate exactly as the list does
 * @param {Function} hooks.onExpired called with the job key when the post is gone
 * @param {Function} hooks.onDismiss called with (key, dismissed)
 * @param {Function} hooks.isDismissed
 */
export function createJobModal(
  {
    describeRate,
    onExpired,
    onDismiss,
    isDismissed,
    onApply,
    getApplication,
    onMountDraft = null,
    onFollowedUp = null,
    // Read at open time, not at construction: the setting can be flipped in
    // another tab while a modal is on screen.
    shouldFormatDescription = () => true,
    getCardLevel = () => null,
    isEmployerBlocked = () => false,
    onBlockEmployer = null,
    getEmployerNote = () => '',
    onNoteEmployer = null,
    onRememberSignals = null,
    isSaved = () => false,
    onSaveToggle = null,
    onViewed = null,
    getJobNote = () => '',
    onJobNote = null,
    getJobTags = () => [],
    onJobTagToggle = null,
    onJobTagAdd = null,
    onJobTagRemove = null,
    getTagColor = () => null,
    getTagSuggestions = () => [],
  },
  doc = document,
) {
  /** Where focus was before we took it, so closing can hand it back. */
  let lastFocused = null;
  /** Which job is on screen, so a slow fetch cannot overwrite a newer one. */
  let currentKey = null;

  function close() {
    const root = doc.getElementById(ROOT_ID);
    if (!root || root.hidden) return;

    root.hidden = true;
    doc.documentElement.classList.remove(OPEN_CLASS);
    currentKey = null;

    if (lastFocused && doc.contains(lastFocused)) lastFocused.focus();
    lastFocused = null;
  }

  function ensureRoot() {
    let root = doc.getElementById(ROOT_ID);
    if (root) return root;

    root = build(doc);
    doc.body.appendChild(root);
    root.querySelector('.ojrf-modal-backdrop').addEventListener('click', close);
    root.querySelector('.ojrf-modal-close').addEventListener('click', close);

    return root;
  }

  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  function render(root, fetched, href, context = {}) {
    const job = readJobPage(fetched);
    const body = root.querySelector('.ojrf-modal-body');

    root.querySelector('.ojrf-modal-title').textContent = job.title;
    body.textContent = '';
    // Every job opens at its own beginning, never where the last one was left.
    body.scrollTop = 0;

    // Our figure, pinned in the footer rather than scrolled with the text.
    const chip = describeRate(job.rateText, job.jobType, job.hoursPerWeek);
    const badge = root.querySelector('.ojrf-modal-rate');
    badge.dataset.tone = chip.tone;
    badge.textContent = chip.rate;
    badge.title = job.rateText ? `Listed as: ${job.rateText}` : 'No rate given';

    const facts = readFacts(fetched);
    if (facts.length > 0) {
      const list = doc.createElement('dl');
      list.className = 'ojrf-modal-facts';
      for (const fact of facts) {
        const label = doc.createElement('dt');
        label.textContent = fact.label;
        const value = doc.createElement('dd');
        value.textContent = fact.value;
        list.append(label, value);
      }
      body.appendChild(list);
    }

    const description = fetched.querySelector('#job-description, .job-description');
    if (description) {
      const holder = doc.createElement('div');
      holder.className = 'ojrf-modal-desc';
      const raw = description.textContent.replace(/\n{3,}/g, '\n\n').trim();

      // Structure only when the employer actually wrote markdown and the
      // setting is on; otherwise the description stays exactly as the site
      // wrote it. Either way every string lands via textContent - this is a
      // remote document, and none of it is ours to trust or to execute.
      if (shouldFormatDescription() && looksLikeMarkdown(raw)) {
        holder.classList.add('ojrf-modal-desc-rich');
        renderBlocks(parseBlocks(raw), holder, doc);
      } else {
        holder.textContent = raw;
      }

      body.appendChild(holder);
    }

    // An instruction hidden in the description, when there is one. Missing it
    // is a wasted application, so it is stated rather than left to be noticed.
    // Read from the document already fetched to show you this job - never by
    // opening pages on its own, which is the crawling pattern to avoid.
    // From the fetched job document, not the page this modal sits on - the
    // employer block is on the job page. (A DOMParser document has no layout,
    // so the blur check says nothing here, which is the intended failure.)
    const signals = readEmployerSignals(fetched);
    // The employer as this job knows them: the name the card gave, and the id
    // the job page carries even when the name is withheld. Remembered so the
    // next card of theirs can say so, and so "Not Given" can still be noted or
    // blocked as one employer. This is the document you asked for; nothing is
    // fetched to learn it.
    const employer = { name: context.employer ?? '', id: readEmployerId(fetched) };
    if (canIdentify(employer) && onRememberSignals) {
      onRememberSignals(employer, {
        newAccount: Boolean(signals.newAccount),
        censored: Boolean(signals.censored),
        jobKey: jobKey(href),
      });
    }
    const employerName =
      context.employer && canIdentify({ name: context.employer })
        ? context.employer
        : 'this employer';

    // The full description, which the results card only ever showed an excerpt
    // of - so this is where a flag is actually likely to be found.
    const flags = findRedFlags(description?.textContent);
    if (flags.length > 0) signals.notes.push(explainRedFlags(flags));

    for (const note of signals.notes.slice().reverse()) {
      const warning = doc.createElement('p');
      warning.className = 'ojrf-modal-warning';
      warning.textContent = note;
      body.insertBefore(warning, body.firstChild);
    }

    // The card only saw an excerpt. If the full description settles the
    // question differently - or settles one the card could not - say so here,
    // where you are deciding whether to apply.
    const full = judgeExperience(job.title, description?.textContent);
    const cardLevel = getCardLevel(href);
    if (full.level !== LEVELS.UNCLEAR && full.level !== cardLevel) {
      const note = doc.createElement('p');
      note.className = 'ojrf-modal-level';
      note.dataset.level = full.level;
      note.textContent = `Full description reads as ${describeLevel(full.level).toLowerCase()}: ${full.why}`;
      body.insertBefore(note, body.firstChild);
    }

    // Addresses the employer wrote into the post, each a click to copy.
    for (const email of findEmails(description?.textContent).reverse()) {
      const line = doc.createElement('p');
      line.className = 'ojrf-modal-subject';
      line.append('Employer asks you to email: ');
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'ojrf-modal-copy-inline';
      button.textContent = email;
      button.title = 'Click to copy this address';
      button.addEventListener('click', async () => {
        const ok = await writeToClipboard(email);
        button.textContent = ok ? 'Copied' : 'Could not copy';
        setTimeout(() => {
          button.textContent = email;
        }, 1400);
      });
      line.appendChild(button);
      body.insertBefore(line, body.firstChild);
    }

    const subject = readSubjectInstruction(description?.textContent);
    if (subject) {
      const notice = doc.createElement('p');
      notice.className = 'ojrf-modal-subject';
      notice.append('Employer asks for this subject line: ');
      const strong = doc.createElement('strong');
      strong.textContent = subject;
      notice.appendChild(strong);
      body.insertBefore(notice, body.firstChild);
    }

    const factOf = (re) => facts.find((f) => re.test(f.label))?.value ?? '';
    const copy = root.querySelector('.ojrf-modal-copy');
    copy.title = 'Copy as a spreadsheet row';
    copy.onclick = async () => {
      const row = toTabDelimited({
        title: job.title,
        employer: context.employer,
        rateText: job.rateText,
        usdPerMonth: chip.usdPerMonth,
        jobType: job.jobTypeLabel,
        hoursPerWeek: factOf(/hours/i),
        postedAt: Date.parse(factOf(/date/i)),
        status: getApplication?.(jobKey(href))?.status ?? '',
        url: new URL(href, location.origin).href,
      });

      const done = await writeToClipboard(row);
      copy.title = done ? 'Copied' : 'Could not copy';
      copy.classList.toggle('ojrf-copied', done);
      setTimeout(() => {
        copy.classList.remove('ojrf-copied');
        copy.title = 'Copy as a spreadsheet row';
      }, 1600);
    };

    root.querySelector('.ojrf-modal-foot').hidden = false;

    const actions = root.querySelector('.ojrf-modal-actions');
    actions.textContent = '';
    const draftHost = root.querySelector('.ojrf-modal-draft');
    draftHost.textContent = '';

    const key = jobKey(href);

    // A private note and tags for this one job, kept locally. The same two
    // stores the Saved tab edits, reachable here without saving first.
    //
    // Collapsed by default: most jobs get neither, so it stays a single quiet
    // line under the actions and only opens when you ask. The toggle carries a
    // count so a job that already has a note or tags says so without opening.
    const notesHost = root.querySelector('.ojrf-modal-notes');
    notesHost.textContent = '';
    // Built here with the body it controls, but appended into the action row
    // below rather than onto its own line, to save the space.
    let notesToggle = null;
    if (key && (onJobNote || onJobTagToggle)) {
      const bodyEl = doc.createElement('div');
      bodyEl.className = 'ojrf-modal-notes-body';
      bodyEl.id = 'ojrf-modal-notes-body';
      bodyEl.hidden = true;

      // Reassigned once the toggle exists; the handlers below run later, by
      // which point it repaints the count.
      let refreshToggle = () => {};

      if (onJobTagToggle) {
        const tags = doc.createElement('div');
        tags.className = 'ojrf-modal-tags';
        // Tint a chip/suggestion by its tag colour, if one is known.
        const colourChip = (el, tag) => {
          const colour = getTagColor(tag);
          if (!colour) return;
          el.style.backgroundColor = `color-mix(in srgb, ${colour} 16%, #ffffff)`;
          el.style.color = `color-mix(in srgb, ${colour} 72%, #000000)`;
          el.style.borderColor = `color-mix(in srgb, ${colour} 32%, #ffffff)`;
        };
        // `focusAdd` re-focuses the input after an add so several tags can be
        // added in a row - without it the repaint drops focus after the first.
        const paintTags = (focusAdd = false) => {
          tags.textContent = '';
          const current = getJobTags(key);
          for (const tag of current) {
            const chip = doc.createElement('button');
            chip.type = 'button';
            chip.className = 'ojrf-modal-tag';
            chip.textContent = tag;
            colourChip(chip, tag);
            chip.title = `Remove tag "${tag}"`;
            chip.setAttribute('aria-label', `Remove tag ${tag}`);
            chip.addEventListener('click', async () => {
              // Remove-only, so a double-click cannot toggle the tag back on.
              await (onJobTagRemove ?? onJobTagToggle)(key, tag);
              paintTags();
              refreshToggle();
            });
            tags.appendChild(chip);
          }
          if (current.length >= MAX_TAGS_PER_JOB) {
            const hint = doc.createElement('span');
            hint.className = 'ojrf-modal-tag-hint';
            hint.textContent = `Up to ${MAX_TAGS_PER_JOB} tags`;
            tags.appendChild(hint);
            return;
          }
          const add = doc.createElement('input');
          add.type = 'text';
          add.className = 'ojrf-modal-tag-add';
          add.placeholder = '+ tag';
          add.setAttribute('aria-label', 'Add a tag');
          add.addEventListener('keydown', async (event) => {
            if (event.key !== 'Enter' || !add.value.trim()) return;
            event.preventDefault();
            const value = add.value.trim();
            add.value = '';
            // Add-only: re-typing an existing tag must not toggle it off.
            await (onJobTagAdd ?? onJobTagToggle)(key, value);
            paintTags(true);
            refreshToggle();
          });
          tags.appendChild(add);

          // One-click suggestions: defaults plus tags used before, minus the ones
          // already on this job.
          const onJob = new Set(current.map((t) => t.toLowerCase()));
          const suggestions = getTagSuggestions().filter((t) => !onJob.has(t.toLowerCase())).slice(0, 8);
          if (suggestions.length) {
            const row = doc.createElement('div');
            row.className = 'ojrf-modal-tag-suggest';
            for (const tag of suggestions) {
              const pick = doc.createElement('button');
              pick.type = 'button';
              pick.className = 'ojrf-modal-tag-pick';
              pick.textContent = `+ ${tag}`;
              colourChip(pick, tag);
              pick.addEventListener('click', async () => {
                await (onJobTagAdd ?? onJobTagToggle)(key, tag);
                paintTags(true);
                refreshToggle();
              });
              row.appendChild(pick);
            }
            tags.appendChild(row);
          }

          if (focusAdd) add.focus();
        };
        paintTags();
        bodyEl.appendChild(tags);
      }

      if (onJobNote) {
        const note = doc.createElement('textarea');
        note.className = 'ojrf-modal-note';
        note.rows = 2;
        note.maxLength = MAX_NOTE_LENGTH;
        note.placeholder = 'A private note for this job…';
        note.setAttribute('aria-label', 'Note for this job');
        note.value = getJobNote(key);
        note.addEventListener('blur', () => {
          if (note.value !== getJobNote(key)) {
            onJobNote(key, note.value);
            refreshToggle();
          }
        });
        bodyEl.appendChild(note);
      }

      const toggle = doc.createElement('button');
      toggle.type = 'button';
      // Icon-only, and built from the same classes as the other footer icons so
      // it shares their exact height and square shape. The words live in the
      // tooltip and aria-label; the count rides there too.
      toggle.className = 'ojrf-job-dismiss ojrf-modal-icon ojrf-notes-toggle';
      toggle.innerHTML = iconMarkup('tag');
      toggle.setAttribute('aria-controls', 'ojrf-modal-notes-body');
      const count = () =>
        (onJobTagToggle ? getJobTags(key).length : 0) +
        (onJobNote && getJobNote(key).trim().length > 0 ? 1 : 0);
      const paintToggle = () => {
        const open = !bodyEl.hidden;
        const n = count();
        const has = n > 0 ? `note & tags (${n})` : 'note or tags';
        const label = open ? 'Hide note & tags' : n > 0 ? `Show ${has}` : 'Add a note or tags';
        toggle.setAttribute('aria-expanded', String(open));
        toggle.classList.toggle('ojrf-job-dismiss-on', open || n > 0);
        // A dot when there is a hidden note or tag, so a collapsed panel still
        // signals it holds something.
        toggle.classList.toggle('ojrf-has-notes', !open && n > 0);
        toggle.setAttribute('aria-label', label);
        toggle.title = label;
      };
      refreshToggle = paintToggle;
      toggle.addEventListener('click', () => {
        bodyEl.hidden = !bodyEl.hidden;
        paintToggle();
        if (!bodyEl.hidden) {
          const first = bodyEl.querySelector('.ojrf-modal-tag-add, .ojrf-modal-note');
          if (first) first.focus();
        }
      });
      paintToggle();

      notesToggle = toggle;
      notesHost.appendChild(bodyEl);
    }

    // Save: a bookmark, up in the title bar rather than among the actions -
    // setting a job aside is a lighter act than applying, and it reads better
    // next to close than crowding the row you decide in. Not a decision about
    // the job, only that it is worth a second look.
    const saveBtn = root.querySelector('.ojrf-modal-save');
    if (key && onSaveToggle) {
      saveBtn.hidden = false;
      const paintSave = () => {
        const on = isSaved(key);
        saveBtn.classList.toggle('ojrf-modal-save-on', on);
        saveBtn.setAttribute('aria-label', on ? 'Saved — remove' : 'Save for later');
        saveBtn.title = on ? 'Saved — click to remove' : 'Save this job for later';
        saveBtn.setAttribute('aria-pressed', String(on));
      };
      paintSave();
      saveBtn.onclick = async () => {
        await onSaveToggle(key, {
          title: job.title,
          url: href,
          employer: context.employer ?? '',
          usdPerMonth: chip.usdPerMonth,
        });
        paintSave();
      };
    } else {
      saveBtn.hidden = true;
    }

    // Applying is the whole point of reading the description, so it leads.
    //
    // Opening the site's own apply page is also the only honest moment to
    // record that you applied: it is the last thing we can observe before the
    // application leaves for a page we deliberately do not drive.
    const apply = doc.createElement('a');
    apply.className = 'ojrf-modal-apply';
    apply.href = href;
    apply.target = '_blank';
    apply.rel = 'noopener';
    apply.textContent = 'Apply to this job ↗';
    if (key && onApply) {
      apply.addEventListener('click', () =>
        onApply(key, {
          title: job.title,
          employer: context.employer ?? '',
          url: href,
          usdPerMonth: chip.usdPerMonth,
        }),
      );
    }
    actions.appendChild(apply);

    // The note & tags toggle rides in the action row, right after Apply, so it
    // costs no extra line; the panel it opens still appears below.
    if (notesToggle) actions.appendChild(notesToggle);

    // Drafting: same button and panel the job page uses. Given the full text
    // this modal already fetched, so the model sees the whole description.
    if (onMountDraft && description) {
      onMountDraft(actions, draftHost, {
        jobKey: key,
        url: href,
        title: job.title,
        employer: context.employer ?? '',
        rateText: job.rateText ?? '',
        description: description.textContent ?? '',
        subject: readSubjectInstruction(description?.textContent) ?? '',
      });
    }

    // The status of an application already recorded, movable from here.
    const application = key && getApplication ? getApplication(key) : null;
    if (application) {
      const select = doc.createElement('select');
      select.className = 'ojrf-modal-status';
      select.setAttribute('aria-label', 'Application status');
      for (const status of APPLICATION_STATUSES) {
        const option = doc.createElement('option');
        option.value = status.value;
        option.textContent = status.label;
        if (status.value === application.status) option.selected = true;
        select.appendChild(option);
      }
      select.addEventListener('change', () =>
        onApply(key, { status: select.value, title: job.title, employer: context.employer ?? '', url: href }),
      );
      actions.appendChild(select);

      // A nudge is not a reply, so it is a button rather than a status. Only
      // while still waiting: once they answered there is nobody to chase.
      if (application.status === 'applied' && onFollowedUp) {
        const followed = doc.createElement('button');
        followed.type = 'button';
        followed.className = 'ojrf-job-dismiss ojrf-modal-icon';
        followed.innerHTML = iconMarkup('bell');
        followed.setAttribute('aria-label', 'Followed up');
        followed.title = 'Followed up — note that you nudged them; the reminder starts again from now';
        followed.addEventListener('click', async () => {
          await onFollowedUp(key);
          followed.innerHTML = iconMarkup('check');
          followed.title = 'Noted';
          followed.disabled = true;
        });
        actions.appendChild(followed);
      }
    }

    // Block and note are about the employer rather than the job, so both need
    // the employer identified - by the card's name, or by the id the job page
    // carries even when the name is withheld.
    if (canIdentify(employer) && onBlockEmployer) {
      const block = doc.createElement('button');
      block.type = 'button';
      const paintBlock = () => {
        const on = isEmployerBlocked(employer);
        block.className = on
          ? 'ojrf-job-dismiss ojrf-modal-icon ojrf-job-dismiss-on'
          : 'ojrf-job-dismiss ojrf-modal-icon';
        block.innerHTML = iconMarkup('ban');
        const blockLabel = on ? `Unblock ${employerName}` : `Block ${employerName}`;
        block.setAttribute('aria-label', blockLabel);
        block.title = on
          ? `${blockLabel} — show their listings again`
          : `${blockLabel} — collapse every listing from them`;
        block.setAttribute('aria-pressed', String(on));
      };
      paintBlock();
      block.addEventListener('click', async () => {
        await onBlockEmployer(employer, !isEmployerBlocked(employer));
        paintBlock();
      });
      actions.appendChild(block);
    }

    if (canIdentify(employer) && onNoteEmployer) {
      const noteButton = doc.createElement('button');
      noteButton.type = 'button';
      noteButton.className = 'ojrf-job-dismiss ojrf-modal-icon';
      noteButton.innerHTML = iconMarkup('note');
      const paintNote = () => {
        const current = getEmployerNote(employer);
        noteButton.setAttribute('aria-label', current ? 'Edit note' : 'Add note');
        noteButton.title = current ? `Your note: ${current}` : `Keep a note on ${employerName}`;
      };
      paintNote();
      noteButton.addEventListener('click', async () => {
        // The same one-prompt rule as naming a search: a note is one short
        // string, and a form to collect it would be more surface than it earns.
        const next = window.prompt(`Note on ${employerName}`, getEmployerNote(employer));
        if (next === null) return;
        await onNoteEmployer(employer, next);
        paintNote();
      });
      actions.appendChild(noteButton);
    }

    if (!key || !onDismiss) return;

    const button = doc.createElement('button');
    button.type = 'button';
    const paint = () => {
      const off = isDismissed(key);
      button.className = off
        ? 'ojrf-job-dismiss ojrf-modal-icon ojrf-job-dismiss-on'
        : 'ojrf-job-dismiss ojrf-modal-icon';
      button.innerHTML = iconMarkup('cross');
      button.setAttribute('aria-label', off ? 'Dismissed — restore' : 'Not for me');
      button.title = off ? 'Dismissed — click to restore' : 'Not for me — dismiss this job';
      button.setAttribute('aria-pressed', String(off));
    };
    paint();

    button.addEventListener('click', async () => {
      await onDismiss(key, !isDismissed(key));
      paint();
    });

    actions.appendChild(button);
  }

  async function open(href, context = {}) {
    const root = ensureRoot();
    const key = jobKey(href);

    lastFocused = doc.activeElement;
    currentKey = key;

    // Opening a job is the moment you have seen it. Recorded so the list can
    // later hide what you have already read, leaving only the genuinely new.
    if (key && onViewed) onViewed(key);

    root.querySelector('.ojrf-modal-open-tab').href = href;
    root.querySelector('.ojrf-modal-title').textContent = 'Loading…';
    root.querySelector('.ojrf-modal-body').innerHTML =
      '<div class="ojrf-modal-skeleton"></div>'.repeat(4);
    // Nothing to act on until it has loaded, and a deleted job never gets one.
    root.querySelector('.ojrf-modal-foot').hidden = true;

    root.hidden = false;
    doc.documentElement.classList.add(OPEN_CLASS);
    // preventScroll: taking focus otherwise scrolls the body, and the rate -
    // the whole reason for opening this - is the first thing in it.
    root.querySelector('.ojrf-modal-close').focus({ preventScroll: true });

    const { doc: fetched, status } = await fetchDocument(href);

    // Another job was opened, or it was closed, while this was in flight.
    if (currentKey !== key) return;

    if (!fetched) {
      root.querySelector('.ojrf-modal-title').textContent = 'Could not load this job';
      root.querySelector('.ojrf-modal-body').innerHTML =
        '<p class="ojrf-modal-note">The request failed. Try opening it in a tab instead.</p>';
      return;
    }

    if (isGone(fetched, status)) {
      root.querySelector('.ojrf-modal-title').textContent = 'No longer posted';
      root.querySelector('.ojrf-modal-body').innerHTML =
        '<p class="ojrf-modal-note">The employer has deleted this job. ' +
        'It is now collapsed in your results.</p>';
      if (key && onExpired) onExpired(key);
      return;
    }

    render(root, fetched, href, context);
  }

  /**
   * Take over clicks on job links.
   *
   * Delegated from the results container, so it covers cards merged in later
   * without rebinding. Modified and middle clicks are left alone - those mean
   * "open this somewhere else", and overriding them would be rude.
   */
  function intercept(container) {
    if (!container || container.dataset.ojrfModalBound === '1') return;
    container.dataset.ojrfModalBound = '1';

    container.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      // Our own controls sit inside these links and have already handled it.
      if (event.defaultPrevented) return;

      const link = event.target.closest?.(JOB_LINK);
      if (!link || !container.contains(link)) return;

      event.preventDefault();
      // The employer is named on the card and nowhere on the job page, so it
      // has to travel with the click.
      open(link.getAttribute('href'), { employer: employerOf(link.closest(CARD)) });
    });
  }

  function isOpen() {
    const root = doc.getElementById(ROOT_ID);
    return Boolean(root && !root.hidden);
  }

  return { open, close, intercept, isOpen };
}
