// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDraftPanel } from '../src/content/draft-panel.js';

const job = {
  jobKey: '1712742',
  url: '/jobseekers/job/Virtual-Assistant-1712742',
  title: 'Virtual Assistant',
  employer: 'GodSounds, Inc.',
  rateText: '$2/hour',
  description: 'Organise files in Google Drive. Email ari@godsounds.com with the subject line "New VA".',
  subject: 'New VA',
};

const about = { name: 'Maria', email: 'maria@example.com', location: 'Cebu', links: [] };
const profiles = [
  { id: 'p1', label: 'VA', headline: 'Admin VA', targetRoles: ['va'], body: 'Two years.', source: 'typed', isDefault: true },
  { id: 'p2', label: 'Bookkeeper', headline: 'Xero bookkeeper', targetRoles: [], body: 'Numbers.', source: 'typed', isDefault: false },
];

function setup(overrides = {}) {
  document.body.innerHTML = '<div id="actions"></div><div id="panel-host"></div>';
  const deps = {
    doc: document,
    getAuth: async () => ({ token: 't', email: 'a@b.co' }),
    getProfiles: async () => profiles,
    getAbout: async () => about,
    getSettings: () => ({ draftConsent: true, draftTone: 'plain', draftProfileId: '', draftSubjectPattern: 'Application: {jobTitle} — {name}' }),
    saveSettings: vi.fn(async (patch) => patch),
    request: vi.fn(async () => ({ draft: 'Dear Ari, I can start now.', subject: 'New VA', credits: 4, model: 'fake' })),
    loadDrafts: async () => new Map(),
    saveDraft: vi.fn(async () => new Map()),
    onCredits: vi.fn(),
    openOptions: vi.fn(),
    copy: vi.fn(async () => true),
    ...overrides,
  };
  const panel = createDraftPanel(deps);
  panel.mount({
    actionsHost: document.getElementById('actions'),
    panelHost: document.getElementById('panel-host'),
    job,
  });
  return { deps, panel };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const button = () => document.querySelector('.ojrf-draft-button');
const panelEl = () => document.querySelector('.ojrf-draft-panel');
const text = () => panelEl()?.textContent ?? '';

describe('the draft panel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('mounts a button and no panel until pressed', () => {
    setup();
    expect(button()).not.toBeNull();
    expect(button().textContent).toContain('Draft application');
    expect(panelEl()).toBeNull();
  });

  it('asks you to sign in when there is no session, and sends nothing', async () => {
    const { deps } = setup({ getAuth: async () => null });
    button().click();
    await flush();
    // A popup toast, not an inline panel - there is nothing to act on here.
    expect(panelEl()).toBeNull();
    expect(document.querySelector('.ojrf-toast')?.textContent ?? '').toMatch(/sign in/i);
    expect(deps.request).not.toHaveBeenCalled();
  });

  it('asks to create a profile when none is usable, and sends nothing', async () => {
    const { deps } = setup({ getProfiles: async () => [{ id: 'x', label: 'Empty', headline: '', body: '' }] });
    button().click();
    await flush();
    expect(text()).toMatch(/create a profile/i);
    panelEl().querySelector('button[data-kind="open-profile"]').click();
    expect(deps.openOptions).toHaveBeenCalled();
    expect(deps.request).not.toHaveBeenCalled();
  });

  it('shows a profile picker and sends the chosen profile', async () => {
    const { deps } = setup();
    button().click();
    await flush();
    await flush();
    const select = panelEl().querySelector('.ojrf-draft-profile');
    expect(select).not.toBeNull();
    expect([...select.options].map((o) => o.textContent)).toEqual(['VA', 'Bookkeeper']);
    // Default profile (p1) was used.
    const body = deps.request.mock.calls[0][0];
    expect(body.profile.headline).toBe('Admin VA');
    expect(body.profile.resume).toBe('Two years.');
    expect(body.profile.location).toBe('Cebu');
    expect(JSON.stringify(body)).not.toContain('maria@example.com');
    expect(deps.saveDraft).toHaveBeenCalledWith('1712742', expect.objectContaining({ profileId: 'p1' }));
    expect(deps.saveSettings).toHaveBeenCalledWith({ draftProfileId: 'p1' });
  });

  it('defaults the picker to the last-used profile', async () => {
    const { deps } = setup({
      getSettings: () => ({ draftConsent: true, draftTone: 'plain', draftProfileId: 'p2', draftSubjectPattern: '' }),
    });
    button().click();
    await flush();
    await flush();
    const body = deps.request.mock.calls[0][0];
    expect(body.profile.headline).toBe('Xero bookkeeper');
  });

  it('asks once what it will send, and remembers when told to', async () => {
    const { deps } = setup({ getSettings: () => ({ draftConsent: false, draftTone: 'plain' }) });
    button().click();
    await flush();
    expect(text()).toMatch(/sends this job/i);
    expect(text()).toMatch(/1 credit/);
    expect(deps.request).not.toHaveBeenCalled();

    panelEl().querySelector('input[type="checkbox"]').click();
    panelEl().querySelector('button[data-kind="send"]').click();
    await flush();
    await flush();
    expect(deps.saveSettings).toHaveBeenCalledWith({ draftConsent: true });
    expect(deps.request).toHaveBeenCalledTimes(1);
  });

  it('requests a draft with the job, the profile and the subject, and shows it', async () => {
    const { deps } = setup();
    button().click();
    await flush();
    await flush();
    expect(deps.request).toHaveBeenCalledTimes(1);
    const body = deps.request.mock.calls[0][0];
    expect(body.job.title).toBe('Virtual Assistant');
    expect(body.profile.headline).toBe('Admin VA');
    // The job demands "New VA" as the subject, so that wins over the pattern.
    expect(body.options.subject).toBe('New VA');
    expect(body.idempotencyKey).toBe('1712742:1');

    const area = panelEl().querySelector('textarea');
    expect(area.value).toBe('Dear Ari, I can start now.');
    expect(text()).toContain('New VA');
    expect(deps.saveDraft).toHaveBeenCalledWith('1712742', expect.objectContaining({ text: 'Dear Ari, I can start now.', attempt: 1 }));
    expect(deps.onCredits).toHaveBeenCalledWith(4);
    expect(button().textContent).toContain('Show draft');
  });

  it('shows an existing draft without asking the server', async () => {
    const { deps } = setup({
      loadDrafts: async () => new Map([['1712742', { text: 'Old draft', subject: null, attempt: 2, createdAt: 1, model: 'fake', profileId: 'p2' }]]),
    });
    button().click();
    await flush();
    expect(panelEl().querySelector('textarea').value).toBe('Old draft');
    expect(deps.request).not.toHaveBeenCalled();

    // Regenerate is a new attempt, and a new charge.
    panelEl().querySelector('button[data-kind="regenerate"]').click();
    await flush();
    await flush();
    expect(deps.request).toHaveBeenCalledTimes(1);
    expect(deps.request.mock.calls[0][0].idempotencyKey).toBe('1712742:3');
  });

  it('copies the draft, and the subject on its own', async () => {
    const { deps } = setup();
    button().click();
    await flush();
    await flush();
    panelEl().querySelector('button[data-kind="copy"]').click();
    await flush();
    expect(deps.copy).toHaveBeenCalledWith('Dear Ari, I can start now.');
    panelEl().querySelector('button[data-kind="copy-subject"]').click();
    await flush();
    expect(deps.copy).toHaveBeenCalledWith('New VA');
  });

  it('words a failure, says when you were not charged, and offers to try again', async () => {
    const request = vi.fn().mockRejectedValueOnce(Object.assign(new Error('x'), { status: 502, body: {} }));
    const { deps } = setup({ request });
    button().click();
    await flush();
    await flush();
    expect(text()).toMatch(/not charged/i);
    expect(deps.saveDraft).not.toHaveBeenCalled();
    expect(panelEl().querySelector('button[data-kind="retry"]')).not.toBeNull();
  });

  it('never drives the site: no form is filled and nothing is submitted', async () => {
    document.body.innerHTML = '<form id="apply"><textarea name="msg"></textarea></form>';
    const actions = document.createElement('div');
    const host = document.createElement('div');
    document.body.append(actions, host);
    const submit = vi.fn();
    document.getElementById('apply').addEventListener('submit', submit);
    createDraftPanel({
      doc: document,
      getAuth: async () => ({ token: 't' }),
      getProfiles: async () => profiles,
      getAbout: async () => about,
      getSettings: () => ({ draftConsent: true, draftTone: 'plain', draftProfileId: '', draftSubjectPattern: '' }),
      saveSettings: async () => {},
      request: async () => ({ draft: 'Hi', subject: null, credits: 1, model: 'm' }),
      loadDrafts: async () => new Map(),
      saveDraft: async () => new Map(),
      onCredits: () => {},
      openOptions: () => {},
      copy: async () => true,
    }).mount({ actionsHost: actions, panelHost: host, job });
    button().click();
    await flush();
    await flush();
    expect(document.querySelector('textarea[name="msg"]').value).toBe('');
    expect(submit).not.toHaveBeenCalled();
  });
});
