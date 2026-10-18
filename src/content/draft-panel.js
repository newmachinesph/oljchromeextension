/**
 * The draft-application panel: a button, and a box under it.
 *
 * Mounted twice - once in the job modal, once on the job's own page - from the
 * same code, so the two read alike. Everything it needs is injected, so it has
 * no opinion about storage, the network, or where the button lives; that keeps
 * it testable and keeps this file about the interaction and nothing else.
 *
 * A picker chooses which profile writes the draft; About plus that profile is
 * what gets sent. It writes text for you to read, edit and copy. It never
 * touches the site's apply form and never submits anything - the application is
 * yours to send.
 */

import { draftRequest, describeDraftError, DRAFT_TONES } from '../core/drafts.js';
import {
  buildDraftProfile,
  defaultProfile,
  profileById,
  isUsable,
  hasUsableProfile,
} from '../core/profiles.js';
import { resolveSubject } from '../core/subject.js';

const PEN_ICON =
  '<svg class="ojrf-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"' +
  ' stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="M13.5 6.5l3 3"/></svg>';

/**
 * @param {object} deps
 * @param {Document} [deps.doc]
 * @param {() => Promise<object|null>} deps.getAuth
 * @param {() => Promise<Array>} deps.getProfiles
 * @param {() => Promise<object>} deps.getAbout
 * @param {() => object} deps.getSettings   settings (draftConsent, draftTone,
 *   draftProfileId, draftSubjectPattern)
 * @param {(patch: object) => Promise<any>} deps.saveSettings
 * @param {(body: object) => Promise<{draft, subject, credits, model}>} deps.request
 * @param {() => Promise<Map>} deps.loadDrafts
 * @param {(jobKey: string, draft: object) => Promise<any>} deps.saveDraft
 * @param {(credits: number) => void} deps.onCredits
 * @param {() => void} deps.openOptions
 * @param {(text: string) => Promise<boolean>} deps.copy
 */
export function createDraftPanel(deps) {
  const doc = deps.doc ?? (typeof document !== 'undefined' ? document : undefined);

  let host = null;
  let button = null;
  let job = null;
  /** The next attempt number; regenerating increments it. */
  let attempt = 1;
  let hasDraft = false;

  let profiles = [];
  let about = {};
  /** The profile chosen for this job's draft. */
  let chosenId = null;

  function setButtonLabel() {
    if (!button) return;
    button.querySelector('span:last-child').textContent = hasDraft
      ? 'Show draft'
      : 'Draft application';
  }

  function mount({ actionsHost, panelHost, job: forJob }) {
    job = forJob;
    host = panelHost;

    button = doc.createElement('button');
    button.type = 'button';
    button.className = 'ojrf-draft-button ojrf-job-dismiss';
    button.dataset.kind = 'draft';
    button.innerHTML = PEN_ICON;
    button.title = 'Write a first message (1 credit, or your key when BYOK is active)';
    const label = doc.createElement('span');
    label.textContent = 'Draft application';
    button.appendChild(label);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      open();
    });
    actionsHost.appendChild(button);

    // Reflect any existing draft in the button label, without opening.
    deps.loadDrafts().then((drafts) => {
      const existing = drafts.get(job.jobKey);
      if (existing) {
        hasDraft = true;
        attempt = existing.attempt + 1;
        setButtonLabel();
      }
    });

    return button;
  }

  function panel() {
    let node = host.querySelector('.ojrf-draft-panel');
    if (!node) {
      node = doc.createElement('div');
      node.className = 'ojrf-draft-panel ojrf-ui';
      host.appendChild(node);
    }
    node.textContent = '';
    return node;
  }

  function close() {
    host?.querySelector('.ojrf-draft-panel')?.remove();
  }

  /**
   * A brief, self-dismissing popup for a notice with nothing to act on here.
   *
   * Signing in happens from the toolbar icon, not this panel, so an inline box
   * would only be a message you then have to close - and, in the modal footer,
   * dead space while it sits there. A toast says it and leaves.
   */
  function notify(body) {
    if (!doc?.body) return;
    const toast = doc.createElement('div');
    toast.className = 'ojrf-toast ojrf-ui';
    toast.setAttribute('role', 'status');
    toast.textContent = body;
    doc.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('ojrf-toast-in'));
    setTimeout(() => {
      toast.classList.remove('ojrf-toast-in');
      setTimeout(() => toast.remove(), 220);
    }, 3600);
  }

  function message(body, actions = []) {
    const node = panel();
    const p = doc.createElement('p');
    p.className = 'ojrf-draft-note';
    p.textContent = body;
    node.appendChild(p);
    node.appendChild(buttonRow(actions));
    return node;
  }

  function buttonRow(actions) {
    const row = doc.createElement('div');
    row.className = 'ojrf-draft-actions';
    for (const action of actions) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = `ojrf-job-dismiss${action.primary ? ' ojrf-draft-primary' : ''}`;
      b.dataset.kind = action.kind;
      b.textContent = action.label;
      if (action.title) b.title = action.title;
      b.addEventListener('click', (event) => {
        event.preventDefault();
        action.run(b);
      });
      row.appendChild(b);
    }
    return row;
  }

  const usableProfiles = () => profiles.filter(isUsable);

  /**
   * Which profile to offer, in order: the one a saved draft used, then the
   * last-used, then the default, then the first usable.
   */
  function pickProfileId(savedId) {
    const usable = usableProfiles();
    const wanted = [savedId, deps.getSettings().draftProfileId, defaultProfile(profiles)?.id].find(
      (id) => usable.some((p) => p.id === id),
    );
    return wanted ?? usable[0]?.id ?? null;
  }

  function chosenProfile() {
    return profileById(profiles, chosenId);
  }

  /** The "which profile" select, present on the consent and draft views. */
  function renderPicker(node) {
    const usable = usableProfiles();
    if (usable.length < 1) return;

    const wrap = doc.createElement('label');
    wrap.className = 'ojrf-draft-picker';
    wrap.append(doc.createTextNode('Profile: '));

    const select = doc.createElement('select');
    select.className = 'ojrf-draft-profile';
    select.setAttribute('aria-label', 'Profile');
    for (const p of usable) {
      const option = doc.createElement('option');
      option.value = p.id;
      option.textContent = p.label || '(untitled)';
      if (p.id === chosenId) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      chosenId = select.value;
      deps.saveSettings({ draftProfileId: chosenId });
    });

    wrap.appendChild(select);
    node.appendChild(wrap);
  }

  async function open() {
    const auth = await deps.getAuth();
    if (!auth) {
      // A notice with nothing to act on here, so a popup rather than an inline
      // box: signing in is a toolbar action, not one this panel can offer.
      close();
      notify('Sign in from the toolbar icon to draft an application.');
      return;
    }

    profiles = await deps.getProfiles();
    about = await deps.getAbout();
    if (!hasUsableProfile(profiles)) {
      message('Create a profile first - the draft is written from it.', [
        { kind: 'open-profile', label: 'Open profile', primary: true, run: () => deps.openOptions() },
        { kind: 'close', label: 'Close', run: close },
      ]);
      return;
    }

    const existing = (await deps.loadDrafts()).get(job.jobKey);
    chosenId = pickProfileId(existing?.profileId);

    if (existing) {
      showDraft(existing.text, existing.subject);
      return;
    }

    if (!deps.getSettings().draftConsent) {
      showConsent();
      return;
    }

    await generate();
  }

  function showConsent() {
    const node = panel();
    renderPicker(node);

    const p = doc.createElement('p');
    p.className = 'ojrf-draft-note';
    p.textContent =
      'This sends this job’s text and your About-you details (except email and phone) ' +
      'plus the chosen profile, to our server to write the draft. It uses 1 credit unless BYOK is active.';
    node.appendChild(p);

    const label = doc.createElement('label');
    label.className = 'ojrf-draft-consent';
    const box = doc.createElement('input');
    box.type = 'checkbox';
    label.append(box, doc.createTextNode(' Don’t ask again'));
    node.appendChild(label);

    node.appendChild(
      buttonRow([
        {
          kind: 'send',
          label: 'Send (credit or BYOK)',
          primary: true,
          run: async () => {
            if (box.checked) await deps.saveSettings({ draftConsent: true });
            await generate();
          },
        },
        { kind: 'cancel', label: 'Cancel', run: close },
      ]),
    );
  }

  async function generate() {
    const profile = chosenProfile();
    if (!profile) {
      message('That profile is gone. Pick another or create one.', [
        { kind: 'open-profile', label: 'Open profile', primary: true, run: () => deps.openOptions() },
        { kind: 'close', label: 'Close', run: close },
      ]);
      return;
    }

    const node = panel();
    renderPicker(node);
    const waiting = doc.createElement('p');
    waiting.className = 'ojrf-draft-note';
    waiting.innerHTML = '<span class="ojrf-spinner"></span> Writing…';
    node.appendChild(waiting);

    const subject = resolveSubject({
      instruction: job.subject,
      pattern: deps.getSettings().draftSubjectPattern,
      values: {
        jobTitle: job.title,
        employer: job.employer,
        name: about.name,
        profileLabel: profile.label,
        profileHeadline: profile.headline,
      },
    });

    const body = draftRequest({
      job,
      profile: buildDraftProfile(about, profile),
      options: { tone: deps.getSettings().draftTone, subject },
      attempt,
    });

    try {
      const result = await deps.request(body);
      await deps.saveDraft(job.jobKey, {
        text: result.draft,
        subject: result.subject || subject,
        attempt,
        model: result.model,
        profileId: profile.id,
      });
      await deps.saveSettings({ draftProfileId: profile.id });
      hasDraft = true;
      attempt += 1;
      setButtonLabel();
      if (Number.isFinite(result.credits)) deps.onCredits(result.credits);
      showDraft(result.draft, result.subject || subject);
    } catch (error) {
      const status = error?.status ?? 500;
      message(describeDraftError(status, error?.body), [
        { kind: 'retry', label: 'Try again', primary: true, run: () => open() },
        { kind: 'close', label: 'Close', run: close },
      ]);
    }
  }

  function showDraft(draft, subject) {
    const node = panel();
    renderPicker(node);

    if (subject) {
      const line = doc.createElement('p');
      line.className = 'ojrf-draft-subject';
      line.append('Subject: ');
      const strong = doc.createElement('strong');
      strong.textContent = subject;
      line.appendChild(strong);
      const copySubject = doc.createElement('button');
      copySubject.type = 'button';
      copySubject.className = 'ojrf-draft-linkbtn';
      copySubject.dataset.kind = 'copy-subject';
      copySubject.textContent = 'Copy';
      copySubject.addEventListener('click', (event) => {
        event.preventDefault();
        deps.copy(subject);
      });
      line.appendChild(copySubject);
      node.appendChild(line);
    }

    const area = doc.createElement('textarea');
    area.className = 'ojrf-draft-text';
    area.rows = 9;
    area.value = draft;
    area.setAttribute('aria-label', 'Draft application message');
    node.appendChild(area);

    const tone = doc.createElement('select');
    tone.className = 'ojrf-draft-tone';
    tone.setAttribute('aria-label', 'Tone');
    for (const option of DRAFT_TONES) {
      const el = doc.createElement('option');
      el.value = option.value;
      el.textContent = option.label;
      if (option.value === deps.getSettings().draftTone) el.selected = true;
      tone.appendChild(el);
    }
    tone.addEventListener('change', () => deps.saveSettings({ draftTone: tone.value }));

    const actions = buttonRow([
      {
        kind: 'copy',
        label: 'Copy',
        primary: true,
        run: async (b) => {
          const ok = await deps.copy(area.value);
          b.textContent = ok ? 'Copied' : 'Could not copy';
          setTimeout(() => {
            b.textContent = 'Copy';
          }, 1400);
        },
      },
      {
        kind: hasDraft ? 'regenerate' : 'retry',
        label: 'Regenerate (credit or BYOK)',
        run: () => generate(),
      },
      { kind: 'close', label: 'Close', run: close },
    ]);
    actions.insertBefore(tone, actions.firstChild);
    node.appendChild(actions);
  }

  return { mount, open, close };
}
