import { describe, it, expect, beforeEach } from 'vitest';
import {
  SESSION_GAP_MS,
  nextVisit,
  markVisit,
  readVisit,
  clearVisit,
  isNew,
} from '../src/core/visits.js';
import { evaluateListing } from '../src/core/criteria.js';
import { parseRate } from '../src/core/parse-rate.js';
import { sanitize } from '../src/core/settings.js';

const STORAGE_KEY = 'ojRateFilterVisit';

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

const HOUR = 60 * 60 * 1000;

describe('nextVisit', () => {
  it('marks nothing new on a first visit', () => {
    // Three hundred listings all shouting NEW says nothing at all.
    expect(nextVisit(undefined, 1000)).toEqual({ since: 1000, seenAt: 1000 });
  });

  it('holds the cutoff steady across a reload', () => {
    // Refresh while reading and the set must not empty out under you.
    const first = nextVisit(undefined, 1000);
    const reload = nextVisit(first, 1000 + 60_000);

    expect(reload.since).toBe(first.since);
    expect(reload.seenAt).toBe(1000 + 60_000);
  });

  it('moves the cutoff once you have been away', () => {
    const stored = { since: 1000, seenAt: 2000 };
    const later = nextVisit(stored, 2000 + HOUR);

    // Anything posted since you were last here is new.
    expect(later.since).toBe(2000);
    expect(later.seenAt).toBe(2000 + HOUR);
  });

  it('treats exactly the gap as still away', () => {
    const stored = { since: 0, seenAt: 100 };
    expect(nextVisit(stored, 100 + SESSION_GAP_MS).since).toBe(100);
  });

  it('survives storage holding junk', () => {
    expect(nextVisit('nonsense', 500)).toEqual({ since: 500, seenAt: 500 });
    expect(nextVisit({ since: 'x', seenAt: 'y' }, 500)).toEqual({ since: 500, seenAt: 500 });
  });

  it('recovers a cutoff that went missing mid-session', () => {
    expect(nextVisit({ seenAt: 900 }, 950).since).toBe(950);
  });
});

describe('isNew', () => {
  it('is true only for something posted after the cutoff', () => {
    expect(isNew(2000, 1000)).toBe(true);
    expect(isNew(1000, 1000)).toBe(false);
    expect(isNew(500, 1000)).toBe(false);
  });

  it('never claims an undated listing is new', () => {
    // We cannot tell, and guessing pads the one list trusted to be short.
    expect(isNew(null, 1000)).toBe(false);
    expect(isNew(2000, null)).toBe(false);
  });
});

describe('the store', () => {
  it('returns the moment itself when there is no chrome', async () => {
    expect(await markVisit(1234)).toBe(1234);
  });

  it('records the visit and hands back the cutoff', async () => {
    const store = installStorage();
    expect(await markVisit(1000)).toBe(1000);
    expect(store[STORAGE_KEY]).toEqual({ since: 1000, seenAt: 1000 });

    const cutoff = await markVisit(1000 + HOUR);
    expect(cutoff).toBe(1000);
  });

  it('reads the cutoff without moving it', async () => {
    installStorage({ since: 500, seenAt: 900 });
    expect(await readVisit()).toBe(500);
    expect(await readVisit()).toBe(500);
  });

  it('can treat everything as seen', async () => {
    const store = installStorage({ since: 1, seenAt: 2 });
    expect(await clearVisit(9999)).toBe(9999);
    expect(store[STORAGE_KEY]).toEqual({ since: 9999, seenAt: 9999 });
  });
});

describe('the hide rule', () => {
  const verdict = (settings, postedAt, newSince) =>
    evaluateListing({
      facts: { title: 'Video Editor', jobKey: '1', jobType: 'full-time', postedAt },
      parsed: parseRate('$2,000/month'),
      settings: sanitize(settings),
      now: Date.now(),
      newSince,
    });

  it('shows everything by default', () => {
    expect(sanitize({}).onlyNew).toBe(false);
    expect(verdict({}, 500, 1000).hide).toBe(false);
  });

  it('collapses what you have already seen when asked', () => {
    const result = verdict({ onlyNew: true }, 500, 1000);
    expect(result.hide).toBe(true);
    expect(result.reason).toBe('not-new');
  });

  it('keeps what was posted since', () => {
    expect(verdict({ onlyNew: true }, 2000, 1000).hide).toBe(false);
  });

  it('collapses an undated listing rather than assuming it is new', () => {
    expect(verdict({ onlyNew: true }, null, 1000).hide).toBe(true);
  });

  it('yields to a dismissal, which says more about the listing', () => {
    const result = evaluateListing({
      facts: { title: 'x', jobKey: '1', postedAt: 500 },
      parsed: parseRate('$2,000/month'),
      settings: sanitize({ onlyNew: true }),
      now: Date.now(),
      dismissed: new Set(['1']),
      newSince: 1000,
    });
    expect(result.reason).toBe('dismissed');
  });
});
