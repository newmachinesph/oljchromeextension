import { describe, it, expect, beforeEach } from 'vitest';
import {
  DRAFT_LIMITS,
  MAX_DRAFTS,
  draftRequest,
  describeDraftError,
  sanitizeDrafts,
  loadDrafts,
  saveDraft,
  removeDraft,
} from '../src/core/drafts.js';

const STORAGE_KEY = 'ojRateFilterDrafts';

function installStorage(initial) {
  const store = initial === undefined ? {} : { [STORAGE_KEY]: initial };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => (store[key] === undefined ? {} : { [key]: store[key] }),
        set: async (patch) => Object.assign(store, patch),
      },
    },
  };
  return store;
}

beforeEach(() => {
  delete globalThis.chrome;
});

const job = {
  jobKey: '1712742',
  url: '/jobseekers/job/Virtual-Assistant-1712742',
  title: 'Virtual Assistant',
  employer: 'GodSounds, Inc.',
  rateText: '$2/hour',
  description: 'Organise files in Google Drive. Email ari@godsounds.com with the subject line "New VA".',
};

const profile = {
  name: 'Maria',
  email: 'maria@example.com',
  phone: '0917',
  location: 'Cebu',
  headline: 'Admin VA',
  resume: 'Two years of admin work.',
  experience: [{ role: 'VA', company: 'Clinic', period: '2024', summary: 'Admin' }],
  targetRoles: ['virtual assistant'],
};

describe('draftRequest', () => {
  it('sends the job and only the profile fields a draft needs', () => {
    const body = draftRequest({ job, profile, options: { tone: 'warm', subject: 'New VA' }, attempt: 1 });
    expect(body.job.url).toBe('https://www.onlinejobs.ph/jobseekers/job/Virtual-Assistant-1712742');
    expect(body.job.title).toBe('Virtual Assistant');
    expect(body.job.description).toContain('Google Drive');
    expect(body.profile).toEqual({
      name: 'Maria',
      headline: 'Admin VA',
      resume: 'Two years of admin work.',
      location: 'Cebu',
      targetRoles: ['virtual assistant'],
    });
    // Contact details are not the model's business.
    expect(JSON.stringify(body)).not.toContain('maria@example.com');
    expect(JSON.stringify(body)).not.toContain('0917');
    expect(body.options).toEqual({ tone: 'warm', subject: 'New VA' });
    expect(body.idempotencyKey).toBe('1712742:1');
  });

  it('caps what it sends, and leaves out empty profile fields', () => {
    const body = draftRequest({
      job: { ...job, description: 'x'.repeat(50000) },
      profile: { ...profile, resume: 'y'.repeat(50000), headline: '', experience: [] },
      attempt: 2,
    });
    expect(body.job.description).toHaveLength(DRAFT_LIMITS.description);
    expect(body.profile.resume).toHaveLength(DRAFT_LIMITS.resume);
    expect(body.profile.headline).toBeUndefined();
    expect(body.profile.experience).toBeUndefined();
    expect(body.idempotencyKey).toBe('1712742:2');
  });

  it('keeps an absolute job url as it is', () => {
    const body = draftRequest({ job: { ...job, url: 'https://www.onlinejobs.ph/jobseekers/job/x' }, profile, attempt: 1 });
    expect(body.job.url).toBe('https://www.onlinejobs.ph/jobseekers/job/x');
  });
});

describe('describeDraftError', () => {
  it('says something a person can act on for each status', () => {
    expect(describeDraftError(401)).toMatch(/sign in/i);
    expect(describeDraftError(402, { credits: 0 })).toMatch(/credits/i);
    expect(describeDraftError(409)).toMatch(/already/i);
    expect(describeDraftError(429)).toMatch(/today|tomorrow|later/i);
    expect(describeDraftError(502)).toMatch(/not charged|refunded/i);
    expect(describeDraftError(0)).toMatch(/reach the server/i);
    expect(describeDraftError(500)).toMatch(/went wrong/i);
  });

  it('passes the server wording through for a bad request', () => {
    expect(describeDraftError(400, { error: 'The job description is too short to draft from' })).toBe(
      'The job description is too short to draft from',
    );
  });
});

describe('the draft store', () => {
  it('sanitises and caps', () => {
    const raw = {};
    for (let i = 0; i < MAX_DRAFTS + 3; i += 1) {
      raw[`k${i}`] = { text: `draft ${i}`, subject: null, createdAt: i, attempt: 1, model: 'm' };
    }
    raw.junk = 'nope';
    raw.empty = { text: '   ' };
    const drafts = sanitizeDrafts(raw);
    expect(drafts.size).toBe(MAX_DRAFTS);
    expect(drafts.has('k0')).toBe(false);
    expect(drafts.has(`k${MAX_DRAFTS + 2}`)).toBe(true);
    expect(drafts.has('junk')).toBe(false);
  });

  it('saves, reloads, and forgets', async () => {
    installStorage();
    let drafts = await saveDraft('1712742', { text: 'Hello', subject: 'New VA', attempt: 1, model: 'fake' });
    expect(drafts.get('1712742')).toMatchObject({ text: 'Hello', subject: 'New VA', attempt: 1, model: 'fake' });
    expect(Number.isFinite(drafts.get('1712742').createdAt)).toBe(true);

    drafts = await loadDrafts();
    expect(drafts.get('1712742').text).toBe('Hello');

    drafts = await removeDraft('1712742');
    expect(drafts.has('1712742')).toBe(false);
  });

  it('is empty without storage', async () => {
    expect((await loadDrafts()).size).toBe(0);
  });
});
