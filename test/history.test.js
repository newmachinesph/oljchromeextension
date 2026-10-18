import { describe, it, expect, beforeEach } from 'vitest';
import {
  STALE_WEEKS,
  MAX_ENTRIES,
  FORGET_AFTER_MS,
  signatureOf,
  sanitizeHistory,
  recordSightings,
  weeksAdvertised,
  describeStaleness,
  loadHistory,
  recordPage,
  clearHistory,
} from '../src/core/history.js';

const STORAGE_KEY = 'ojRateFilterHistory';
const NOW = Date.parse('2026-08-18T12:00:00Z');
const WEEK = 7 * 24 * 60 * 60 * 1000;

const job = (employer, title) => ({ employer, title });

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

describe('signatureOf', () => {
  it('follows a role across reposts, which get new urls', () => {
    // The whole reason a job key cannot be used: the repost is a different URL.
    expect(signatureOf(job('Young Publisher', 'Executive Assistant — $900/mo'))).toBe(
      signatureOf(job('young publisher', 'executive assistant - $1,200/mo')),
    );
  });

  it('refuses a listing it cannot identify', () => {
    expect(signatureOf(job(null, 'Virtual Assistant'))).toBeNull();
    expect(signatureOf(job('Someone', ''))).toBeNull();
    expect(signatureOf(null)).toBeNull();
  });
});

describe('recordSightings', () => {
  it('remembers when a role was first advertised', () => {
    const history = recordSightings({}, [job('Acme', 'Video Editor')], NOW);
    const entry = Object.values(history)[0];

    expect(entry.first).toBe(NOW);
    expect(entry.seen).toBe(1);
  });

  it('keeps the first date across later sightings', () => {
    let history = recordSightings({}, [job('Acme', 'Video Editor')], NOW);
    history = recordSightings(history, [job('Acme', 'Video Editor')], NOW + 6 * WEEK);

    const entry = Object.values(history)[0];
    expect(entry.first).toBe(NOW);
    expect(entry.last).toBe(NOW + 6 * WEEK);
    expect(entry.seen).toBe(2);
  });

  it('counts a pass once, however many copies are on the page', () => {
    const history = recordSightings(
      {},
      [job('Acme', 'Video Editor'), job('Acme', 'Video Editor')],
      NOW,
    );

    expect(Object.values(history)[0].seen).toBe(1);
  });

  it('does not mutate what it is given', () => {
    const history = {};
    recordSightings(history, [job('Acme', 'Video Editor')], NOW);
    expect(Object.keys(history)).toHaveLength(0);
  });

  it('skips listings it cannot identify', () => {
    expect(Object.keys(recordSightings({}, [job(null, 'VA')], NOW))).toHaveLength(0);
  });
});

describe('weeksAdvertised', () => {
  it('says how long a role has been going round', () => {
    const history = recordSightings({}, [job('Acme', 'Video Editor')], NOW - 6 * WEEK);
    expect(weeksAdvertised(history, job('Acme', 'Video Editor'), NOW)).toBe(6);
  });

  it('says nothing about a job seen for the first time today', () => {
    const history = recordSightings({}, [job('Acme', 'Video Editor')], NOW);
    expect(weeksAdvertised(history, job('Acme', 'Video Editor'), NOW)).toBeNull();
  });

  it('says nothing about a job it has never seen', () => {
    expect(weeksAdvertised({}, job('Acme', 'Video Editor'), NOW)).toBeNull();
    expect(weeksAdvertised(null, job('Acme', 'Video Editor'), NOW)).toBeNull();
  });
});

describe('describeStaleness', () => {
  it('stays quiet about an ordinary repost', () => {
    expect(describeStaleness(1)).toBe('');
    expect(describeStaleness(STALE_WEEKS - 1)).toBe('');
  });

  it('speaks up once it is a pattern', () => {
    expect(describeStaleness(STALE_WEEKS)).toContain('weeks');
  });

  it('switches to months once weeks stop being useful', () => {
    expect(describeStaleness(26)).toBe('advertised 6 months');
  });

  it('says nothing about nothing', () => {
    expect(describeStaleness(null)).toBe('');
    expect(describeStaleness(NaN)).toBe('');
  });
});

describe('sanitizeHistory', () => {
  it('turns anything at all into a usable record', () => {
    expect(sanitizeHistory(null)).toEqual({});
    expect(sanitizeHistory([1, 2])).toEqual({});
    expect(sanitizeHistory({ bad: 'not an object' })).toEqual({});
  });

  it('forgets a role that stopped appearing months ago', () => {
    const old = { 'acme video editor': { first: NOW - FORGET_AFTER_MS * 2, last: NOW - FORGET_AFTER_MS - 1, seen: 9 } };
    expect(sanitizeHistory(old, NOW)).toEqual({});
  });

  it('will not grow without bound, dropping the least recently seen', () => {
    const many = {};
    for (let i = 0; i < MAX_ENTRIES + 50; i += 1) {
      many[`emp-${i} role`] = { first: NOW - WEEK, last: NOW - i * 1000, seen: 1 };
    }

    const kept = sanitizeHistory(many, NOW);
    expect(Object.keys(kept)).toHaveLength(MAX_ENTRIES);
    expect(kept['emp-0 role']).toBeDefined();
  });
});

describe('the store', () => {
  it('reads nothing without chrome', async () => {
    expect(await loadHistory(NOW)).toEqual({});
  });

  it('round-trips across sessions, which is the whole point', async () => {
    installStorage();
    await recordPage([job('Acme', 'Video Editor')], NOW - 8 * WEEK);

    // A later session, weeks on.
    const history = await loadHistory(NOW);
    expect(weeksAdvertised(history, job('Acme', 'Video Editor'), NOW)).toBe(8);
  });

  it('stores dates and nothing else', async () => {
    // No titles, no urls, no employer names in readable form.
    const store = installStorage();
    await recordPage([job('Acme Corp', 'Senior Video Editor')], NOW);

    const written = JSON.stringify(store[STORAGE_KEY]);
    expect(written).not.toMatch(/http|jobseekers|Senior Video Editor|Acme Corp/);
  });

  it('does not let two overlapping passes clobber each other', async () => {
    installStorage();
    await Promise.all([
      recordPage([job('A', 'One')], NOW),
      recordPage([job('B', 'Two')], NOW),
      recordPage([job('C', 'Three')], NOW),
    ]);

    expect(Object.keys(await loadHistory(NOW))).toHaveLength(3);
  });

  it('forgets everything on request', async () => {
    installStorage();
    await recordPage([job('Acme', 'Video Editor')], NOW);
    expect(await clearHistory()).toEqual({});
  });
});
