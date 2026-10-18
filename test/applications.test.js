import { describe, it, expect, beforeEach } from 'vitest';
import {
  APPLICATION_STATUSES,
  isApplicationStatus,
  isCustomStatus,
  isStorableStatus,
  statusLabel,
  sanitizeApplications,
  loadApplications,
  setApplication,
  setPrep,
  MAX_PREP,
  removeApplication,
  clearApplications,
  markFollowedUp,
  MAX_APPLICATIONS,
} from '../src/core/applications.js';
import { evaluateListing } from '../src/core/criteria.js';
import { parseRate } from '../src/core/parse-rate.js';
import { sanitize } from '../src/core/settings.js';

const STORAGE_KEY = 'ojRateFilterApplications';

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

describe('statuses', () => {
  it('run in the order an application actually progresses', () => {
    expect(APPLICATION_STATUSES.map((s) => s.value)).toEqual([
      'preparing',
      'applied',
      'replied',
      'interviewing',
      'offer',
      'hired',
      'rejected',
    ]);
  });

  it('are recognised, and nothing else is', () => {
    expect(isApplicationStatus('offer')).toBe(true);
    expect(isApplicationStatus('ghosted')).toBe(false);
    expect(isApplicationStatus(undefined)).toBe(false);
  });

  it('recognises custom lane tokens as storable but not built-in', () => {
    expect(isCustomStatus('custom-leads')).toBe(true);
    expect(isCustomStatus('custom-')).toBe(false);
    expect(isCustomStatus('applied')).toBe(false);
    expect(isApplicationStatus('custom-leads')).toBe(false);
    expect(isStorableStatus('custom-leads')).toBe(true);
    expect(isStorableStatus('offer')).toBe(true);
    expect(isStorableStatus('ghosted')).toBe(false);
  });

  it('are named for the chip', () => {
    expect(statusLabel('interviewing')).toBe('Interviewing');
    expect(statusLabel('nonsense')).toBe('');
  });
});

describe('sanitizeApplications', () => {
  it('rejects anything that is not a record map', () => {
    expect(sanitizeApplications(null).size).toBe(0);
    expect(sanitizeApplications([]).size).toBe(0);
    expect(sanitizeApplications('nope').size).toBe(0);
  });

  it('fills a damaged record rather than dropping the job', () => {
    // Losing the fact that you applied is worse than losing its date.
    const map = sanitizeApplications({ 42: {} }, 1000);
    expect(map.get('42')).toMatchObject({ status: 'applied', appliedAt: 1000, updatedAt: 1000 });
  });

  it('replaces a status it does not recognise', () => {
    expect(sanitizeApplications({ 42: { status: 'ghosted' } }).get('42').status).toBe('applied');
  });

  it('drops the oldest applications past the cap', () => {
    // Judged by when you applied, not when the status last moved: a stale
    // application you never heard back about is the one worth forgetting.
    const raw = {
      old: { status: 'applied', appliedAt: 1, updatedAt: 9999 },
      mid: { status: 'applied', appliedAt: 5, updatedAt: 5 },
      fresh: { status: 'applied', appliedAt: 9, updatedAt: 9 },
    };
    const map = sanitizeApplications(raw, 0, 2);

    expect([...map.keys()].sort()).toEqual(['fresh', 'mid']);
  });

  it('remembers plenty by default', () => {
    expect(MAX_APPLICATIONS).toBeGreaterThanOrEqual(500);
  });
});

describe('the store', () => {
  it('reads nothing without chrome', async () => {
    expect((await loadApplications()).size).toBe(0);
  });

  it('records an application', async () => {
    const store = installStorage({});
    const map = await setApplication('1711036', { title: 'Video Editor', url: '/x' });

    expect(map.get('1711036')).toMatchObject({ status: 'applied', title: 'Video Editor' });
    expect(store[STORAGE_KEY]['1711036'].status).toBe('applied');
  });

  it('moves an existing one to a new status', async () => {
    installStorage({});
    await setApplication('1711036', { title: 'Video Editor' });
    const map = await setApplication('1711036', { status: 'interviewing' });

    expect(map.get('1711036').status).toBe('interviewing');
    // The title is not lost by an update that does not mention it.
    expect(map.get('1711036').title).toBe('Video Editor');
  });

  it('logs a history entry on the first record and on each stage move, but not on a field-only edit', async () => {
    installStorage({});
    let map = await setApplication('1711036', { title: 'VA', status: 'applied' });
    expect(map.get('1711036').history.map((h) => h.status)).toEqual(['applied']);

    map = await setApplication('1711036', { status: 'interviewing' });
    expect(map.get('1711036').history.map((h) => h.status)).toEqual(['applied', 'interviewing']);

    // A field-only edit that carries the same status must not grow the trail.
    map = await setApplication('1711036', { title: 'VA (edited)', status: 'interviewing' });
    expect(map.get('1711036').history.map((h) => h.status)).toEqual(['applied', 'interviewing']);
    expect(map.get('1711036').title).toBe('VA (edited)');
  });

  it('keeps a custom lane status instead of coercing it to applied', async () => {
    installStorage({});
    const map = await setApplication('1711036', { title: 'Lead', status: 'custom-leads' });
    expect(map.get('1711036').status).toBe('custom-leads');
    // And a genuinely invalid status still falls back to applied.
    const fallback = await setApplication('other', { title: 'X', status: 'ghosted' });
    expect(fallback.get('other').status).toBe('applied');
  });

  it('sets and clears a next-action date without disturbing the rest', async () => {
    const { setNextAction } = await import('../src/core/applications.js');
    installStorage({});
    await setApplication('1', { title: 'VA', status: 'interviewing' });
    let map = await setNextAction('1', { at: 5_000_000, label: '  Interview call  ' });
    expect(map.get('1').nextActionAt).toBe(5_000_000);
    expect(map.get('1').nextActionLabel).toBe('Interview call');
    expect(map.get('1').status).toBe('interviewing'); // untouched
    // Clearing drops both the time and the label.
    map = await setNextAction('1', { at: null });
    expect(map.get('1').nextActionAt).toBeNull();
    expect(map.get('1').nextActionLabel).toBe('');
  });

  it('keeps the original date when the same job is recorded twice', async () => {
    // Opening the apply page twice must not move the date you applied.
    installStorage({ 1711036: { status: 'applied', appliedAt: 111, updatedAt: 111 } });
    const map = await setApplication('1711036', { status: 'offer' });

    expect(map.get('1711036').appliedAt).toBe(111);
    expect(map.get('1711036').updatedAt).toBeGreaterThan(111);
  });

  it('ignores a job with no key', async () => {
    const store = installStorage({ existing: { status: 'applied' } });
    const map = await setApplication(null, { title: 'nothing' });

    // Nothing added, and nothing already recorded disturbed.
    expect([...map.keys()]).toEqual(['existing']);
    expect(Object.keys(store[STORAGE_KEY])).toEqual(['existing']);
  });

  it('forgets one', async () => {
    installStorage({ a: { status: 'applied' }, b: { status: 'applied' } });
    expect([...(await removeApplication('a')).keys()]).toEqual(['b']);
  });

  it('forgets everything', async () => {
    const store = installStorage({ a: { status: 'applied' } });
    expect((await clearApplications()).size).toBe(0);
    expect(store[STORAGE_KEY]).toEqual({});
  });

  it('survives storage holding junk', async () => {
    installStorage('not a map');
    expect((await loadApplications()).size).toBe(0);
  });
});

describe('the hide rule', () => {
  const facts = { title: 'Video Editor', jobKey: '1711036', jobType: 'full-time' };

  const verdict = (settings, applications) =>
    evaluateListing({
      facts,
      parsed: parseRate('$2,000/month'),
      settings: sanitize(settings),
      now: Date.now(),
      applications,
    });

  const applied = (status = 'applied') =>
    new Map([['1711036', { status, appliedAt: 1, updatedAt: 1 }]]);

  it('leaves applied jobs visible by default', () => {
    // Seeing that you applied is the point; the chip says so without hiding it.
    expect(sanitize({}).hideApplied).toBe(false);
    expect(verdict({}, applied()).hide).toBe(false);
  });

  it('collapses them when asked, and says which status', () => {
    const result = verdict({ hideApplied: true }, applied('interviewing'));

    expect(result.hide).toBe(true);
    expect(result.reason).toBe('applied');
    expect(result.extra.statusLabel).toBe('Interviewing');
  });

  it('leaves jobs you have not applied to alone', () => {
    expect(verdict({ hideApplied: true }, new Map()).hide).toBe(false);
  });

  it('yields to a dismissal, which is the stronger statement', () => {
    const result = evaluateListing({
      facts,
      parsed: parseRate('$2,000/month'),
      settings: sanitize({ hideApplied: true }),
      now: Date.now(),
      dismissed: new Set(['1711036']),
      applications: applied(),
    });
    expect(result.reason).toBe('dismissed');
  });

  it('yields to a deleted post, which no status can change', () => {
    const result = evaluateListing({
      facts,
      parsed: parseRate('$2,000/month'),
      settings: sanitize({ hideApplied: true }),
      now: Date.now(),
      expired: new Set(['1711036']),
      applications: applied(),
    });
    expect(result.reason).toBe('expired');
  });

  it('copes with no map at all', () => {
    expect(
      evaluateListing({
        facts,
        parsed: parseRate('$2,000/month'),
        settings: sanitize({ hideApplied: true }),
        now: Date.now(),
      }).hide,
    ).toBe(false);
  });
});

describe('the rate and the follow-up', () => {
  it('keeps the monthly figure the modal knew, when it knew one', async () => {
    installStorage();
    let map = await setApplication('k', { title: 'VA', url: '/x', usdPerMonth: 850 });
    expect(map.get('k').usdPerMonth).toBe(850);

    // A later status change without the figure must not erase it.
    map = await setApplication('k', { status: 'interviewing' });
    expect(map.get('k').usdPerMonth).toBe(850);

    map = await setApplication('j', { title: 'No rate' });
    expect(map.get('j').usdPerMonth).toBeNull();
  });

  it('stamps a follow-up without moving the status or the applied date', async () => {
    installStorage();
    const before = await setApplication('k', { title: 'VA' });
    const { appliedAt } = before.get('k');

    const map = await markFollowedUp('k');
    const record = map.get('k');
    expect(record.status).toBe('applied');
    expect(record.appliedAt).toBe(appliedAt);
    expect(record.followedUpAt).toBeGreaterThanOrEqual(appliedAt);
  });

  it('ignores a follow-up on something you never applied to', async () => {
    installStorage();
    expect((await markFollowedUp('nope')).size).toBe(0);
  });

  it('sanitizes both fields', () => {
    const map = sanitizeApplications({
      a: { status: 'applied', appliedAt: 5, usdPerMonth: '900', followedUpAt: 'soon' },
      b: { status: 'applied', appliedAt: 5, usdPerMonth: 700.4, followedUpAt: 9 },
    });
    expect(map.get('a').usdPerMonth).toBeNull();
    expect(map.get('a').followedUpAt).toBeNull();
    expect(map.get('b').usdPerMonth).toBe(700.4);
    expect(map.get('b').followedUpAt).toBe(9);
  });
});

describe('serialized writes', () => {
  it('keeps every application from concurrent setApplication calls', async () => {
    installStorage();
    await Promise.all(
      ['1', '2', '3', '4', '5'].map((k) => setApplication(k, { status: 'applied', title: `job ${k}` })),
    );
    expect((await loadApplications()).size).toBe(5);
  });
});

describe('interview prep', () => {
  it('starts empty and takes what you write', async () => {
    installStorage({});
    await setApplication('1711036', { title: 'Video Editor' });
    expect((await loadApplications()).get('1711036').prep).toBe('');

    const map = await setPrep('1711036', 'Ask about the 90 days');
    expect(map.get('1711036').prep).toBe('Ask about the 90 days');
  });

  it('keeps line breaks, unlike every other field on the record', () => {
    // This one is written to be read back before a call, not squeezed onto a
    // card - so the lines you laid out stay laid out.
    const written = `Ask them
- [ ] Payday?`;
    const clean = sanitizeApplications({
      job: { status: 'applied', appliedAt: 1, prep: written },
    });
    expect(clean.get('job').prep).toBe(written);
  });

  it('cuts a document down to notes', () => {
    const clean = sanitizeApplications({
      job: { status: 'applied', appliedAt: 1, prep: 'x'.repeat(MAX_PREP + 500) },
    });
    expect(clean.get('job').prep).toHaveLength(MAX_PREP);
  });

  it('survives the move to interviewing', async () => {
    // The move that would most obviously throw it away is the one right before
    // you need it.
    installStorage({});
    await setApplication('1711036', { title: 'Video Editor' });
    await setPrep('1711036', 'Rate floor: $9/hr');
    const map = await setApplication('1711036', { status: 'interviewing' });

    expect(map.get('1711036').prep).toBe('Rate floor: $9/hr');
    expect(map.get('1711036').status).toBe('interviewing');
  });

  it('does not claim the application moved just because you took notes', async () => {
    // "Updated today" would be a lie about the employer, and the board sorts
    // on it - writing prep must not jump a card to the top of its lane.
    installStorage({});
    await setApplication('1711036', { title: 'Video Editor' });
    const before = (await loadApplications()).get('1711036').updatedAt;

    const map = await setPrep('1711036', 'Some notes');
    expect(map.get('1711036').updatedAt).toBe(before);
  });

  it('ignores a key that is not on the board', async () => {
    installStorage({});
    const map = await setPrep('never-applied', 'notes');
    expect(map.size).toBe(0);
  });

  it('reads an older record, which simply has none', () => {
    const clean = sanitizeApplications({ job: { status: 'applied', appliedAt: 1 } });
    expect(clean.get('job').prep).toBe('');
  });
});
