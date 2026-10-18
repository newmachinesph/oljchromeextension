import { describe, it, expect, beforeEach } from 'vitest';
import {
  jobKey,
  addKey,
  removeKey,
  sanitizeList,
  loadDismissed,
  loadDismissedList,
  setDismissed,
  clearDismissed,
  MAX_DISMISSED,
} from '../src/core/dismissed.js';
import { evaluateListing } from '../src/core/criteria.js';
import { sanitize } from '../src/core/settings.js';

const STORAGE_KEY = 'ojRateFilterDismissed';

/** Just enough chrome.storage.local to exercise the real module. */
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

describe('jobKey', () => {
  it('reduces a job URL to its trailing id', () => {
    expect(jobKey('/jobseekers/job/Amazon-Virtual-Assistant-1583746')).toBe('1583746');
  });

  it('reads an absolute URL the same way', () => {
    expect(jobKey('https://www.onlinejobs.ph/jobseekers/job/Data-Entry-990001')).toBe('990001');
  });

  it('ignores query strings and fragments', () => {
    expect(jobKey('/jobseekers/job/Writer-42?ref=search#top')).toBe('42');
  });

  it('ignores a trailing slash', () => {
    expect(jobKey('/jobseekers/job/Writer-42/')).toBe('42');
  });

  it('keys on the id, not the title - so an edited title cannot resurrect a job', () => {
    expect(jobKey('/jobseekers/job/Old-Title-777')).toBe(jobKey('/jobseekers/job/New-Title-777'));
  });

  it('falls back to the slug when there is no id', () => {
    expect(jobKey('/jobseekers/job/some-role')).toBe('some-role');
  });

  it('refuses anything that is not a job link', () => {
    expect(jobKey('/jobseekers/jobsearch/30')).toBeNull();
    expect(jobKey('')).toBeNull();
    expect(jobKey(null)).toBeNull();
    expect(jobKey(undefined)).toBeNull();
  });
});

describe('addKey', () => {
  it('appends, newest last', () => {
    expect(addKey(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
  });

  it('moves an existing key to the end rather than duplicating it', () => {
    expect(addKey(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a']);
  });

  it('drops the least recently dismissed once full', () => {
    expect(addKey(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
  });

  it('remembers plenty by default', () => {
    expect(MAX_DISMISSED).toBeGreaterThanOrEqual(1000);
  });
});

describe('removeKey', () => {
  it('takes one out and leaves the rest in order', () => {
    expect(removeKey(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('is a no-op for a key that was never there', () => {
    expect(removeKey(['a'], 'z')).toEqual(['a']);
  });
});

describe('sanitizeList', () => {
  it('rejects anything that is not a list', () => {
    expect(sanitizeList(null)).toEqual([]);
    expect(sanitizeList('1583746')).toEqual([]);
    expect(sanitizeList({ 0: 'a' })).toEqual([]);
  });

  it('drops blanks and deduplicates', () => {
    expect(sanitizeList(['a', '', '  ', 'a', 'b'])).toEqual(['a', 'b']);
  });

  it('bounds a list that grew past the cap', () => {
    const huge = Array.from({ length: 12 }, (_, i) => `k${i}`);
    expect(sanitizeList(huge, 5)).toEqual(['k7', 'k8', 'k9', 'k10', 'k11']);
  });
});

describe('the store', () => {
  it('reads nothing when there is no chrome at all', async () => {
    expect(await loadDismissed()).toEqual(new Set());
    expect(await loadDismissedList()).toEqual([]);
  });

  it('round-trips a dismissal', async () => {
    const store = installStorage([]);

    expect(await setDismissed('1583746', true)).toEqual(new Set(['1583746']));
    expect(store[STORAGE_KEY]).toEqual(['1583746']);
    expect(await loadDismissed()).toEqual(new Set(['1583746']));
  });

  it('takes one back out', async () => {
    installStorage(['a', 'b']);
    expect(await setDismissed('a', false)).toEqual(new Set(['b']));
  });

  it('ignores a listing with no key', async () => {
    const store = installStorage(['a']);
    expect(await setDismissed(null, true)).toEqual(new Set(['a']));
    expect(store[STORAGE_KEY]).toEqual(['a']);
  });

  it('forgets everything on request', async () => {
    const store = installStorage(['a', 'b', 'c']);
    expect(await clearDismissed()).toEqual(new Set());
    expect(store[STORAGE_KEY]).toEqual([]);
  });

  it('survives storage holding junk', async () => {
    installStorage({ not: 'a list' });
    expect(await loadDismissed()).toEqual(new Set());
  });
});

describe('the hide rule', () => {
  const facts = { title: 'Virtual Assistant', jobKey: '1583746', jobType: 'full-time' };
  const parsed = { amount: 2000, currency: 'USD', period: 'month' };

  const verdict = (settings, dismissed) =>
    evaluateListing({ facts, parsed, settings: sanitize(settings), now: Date.now(), dismissed });

  it('hides a listing you dismissed, whatever it pays', () => {
    const result = verdict({}, new Set(['1583746']));
    expect(result.hide).toBe(true);
    expect(result.reason).toBe('dismissed');
  });

  it('outranks every other rule, being the one decision made by hand', () => {
    // Low rate, wrong job type and an excluded keyword all apply too - the stub
    // still has to say "dismissed", because that is what you actually did.
    const result = verdict(
      {
        thresholdUsdPerMonth: 99999,
        hiddenJobTypes: ['full-time'],
        excludeKeywords: ['virtual'],
      },
      new Set(['1583746']),
    );
    expect(result.reason).toBe('dismissed');
  });

  it('leaves listings you have not dismissed alone', () => {
    expect(verdict({}, new Set(['other'])).hide).toBe(false);
  });

  it('can be switched off to look back at what you rejected', () => {
    expect(verdict({ hideDismissed: false }, new Set(['1583746'])).hide).toBe(false);
  });

  it('copes with no set at all', () => {
    expect(
      evaluateListing({ facts, parsed, settings: sanitize({}), now: Date.now() }).hide,
    ).toBe(false);
  });

  it('ignores a listing whose link gave no key', () => {
    const result = evaluateListing({
      facts: { ...facts, jobKey: null },
      parsed,
      settings: sanitize({}),
      now: Date.now(),
      dismissed: new Set(['1583746']),
    });
    expect(result.hide).toBe(false);
  });
});

describe('the setting', () => {
  it('hides dismissed listings by default - that is the point of dismissing one', () => {
    expect(sanitize({}).hideDismissed).toBe(true);
  });
});
