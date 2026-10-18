import { describe, it, expect, beforeEach } from 'vitest';
import {
  ALERT_INTERVALS,
  MAX_WATCHED,
  MAX_SEEN,
  ALERTS_KEY,
  watchedSearches,
  jobKeysFromHtml,
  diffSeen,
  sanitizeAlertState,
  totalNew,
  loadAlertState,
  saveAlertState,
  clearNewCount,
  clearAllNew,
  alertMessage,
  notificationId,
  notificationTarget,
  NOTIFICATION_PREFIX,
} from '../src/core/alerts.js';
import { nameKey } from '../src/core/saved-searches.js';

function installStorage(initial) {
  const store = initial === undefined ? {} : { [ALERTS_KEY]: initial };
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

describe('watchedSearches', () => {
  const search = (name, keywords) => ({ name, filters: { searchKeywords: keywords } });

  it('keeps only searches with keywords, by name, capped', () => {
    const searches = [
      search('Zed', ['z']),
      search('Admin', ['admin', 'va']),
      search('Rate only', []),
      { name: 'No filters' },
      search('Beta', ['b']),
    ];
    expect(watchedSearches(searches).map((s) => s.name)).toEqual(['Admin', 'Beta', 'Zed']);
    expect(watchedSearches(searches, 2).map((s) => s.name)).toEqual(['Admin', 'Beta']);
    expect(MAX_WATCHED).toBe(10);
  });

  it('is empty for junk', () => {
    expect(watchedSearches(null)).toEqual([]);
    expect(watchedSearches('x')).toEqual([]);
  });
});

describe('jobKeysFromHtml', () => {
  it('finds every job link, relative or absolute, once', () => {
    const html = `
      <div class="jobpost-cat-box"><a href="/jobseekers/job/Video-Editor-1711036">A</a></div>
      <a href="https://www.onlinejobs.ph/jobseekers/job/Virtual-Assistant-1711037?from=x">B</a>
      <a href='/jobseekers/job/Virtual-Assistant-1711037'>B again</a>
      <a href="/jobseekers/jobsearch/30">next page</a>
      <a href="/employers/job/1711038">employer side</a>
    `;
    expect([...jobKeysFromHtml(html)].sort()).toEqual(['1711036', '1711037']);
  });

  it('is empty for nothing', () => {
    expect(jobKeysFromHtml('').size).toBe(0);
    expect(jobKeysFromHtml(null).size).toBe(0);
  });
});

describe('diffSeen', () => {
  it('treats the first run as a baseline and reports nothing new', () => {
    const result = diffSeen([], new Set(['a', 'b']));
    expect(result.baseline).toBe(true);
    expect(result.newKeys).toEqual([]);
    expect(result.seen.sort()).toEqual(['a', 'b']);
  });

  it('reports keys it has not seen and keeps the old ones', () => {
    const result = diffSeen(['a'], new Set(['a', 'b', 'c']));
    expect(result.baseline).toBe(false);
    expect(result.newKeys.sort()).toEqual(['b', 'c']);
    expect(result.seen.sort()).toEqual(['a', 'b', 'c']);
  });

  it('caps the memory, dropping the oldest', () => {
    const previous = Array.from({ length: MAX_SEEN }, (_, i) => `old${i}`);
    const result = diffSeen(previous, new Set(['fresh']));
    expect(result.seen).toHaveLength(MAX_SEEN);
    expect(result.seen.at(-1)).toBe('fresh');
    expect(result.seen.includes('old0')).toBe(false);
    expect(MAX_SEEN).toBe(300);
  });

  it('does not forget what it saw when a fetch comes back empty', () => {
    const result = diffSeen(['a', 'b'], new Set());
    expect(result.newKeys).toEqual([]);
    expect(result.seen.sort()).toEqual(['a', 'b']);
  });
});

describe('sanitizeAlertState', () => {
  it('coerces junk into a usable shape', () => {
    expect(sanitizeAlertState(null)).toEqual({ bySearch: {}, checkedAt: null });
    expect(sanitizeAlertState({ bySearch: 'x' })).toEqual({ bySearch: {}, checkedAt: null });

    const state = sanitizeAlertState({
      checkedAt: 5,
      bySearch: {
        'Admin VA': { seen: ['a', 1, null], newCount: '3', checkedAt: 7, lastError: 42 },
        '': { seen: ['x'] },
        junk: 'nope',
      },
    });
    expect(state.checkedAt).toBe(5);
    expect(Object.keys(state.bySearch)).toEqual([nameKey('Admin VA')]);
    expect(state.bySearch['admin va']).toEqual({
      seen: ['a'],
      newCount: 0,
      checkedAt: 7,
      lastError: '',
    });
  });

  it('keeps a numeric newCount and a string error', () => {
    const state = sanitizeAlertState({
      bySearch: { a: { seen: [], newCount: 4, lastError: 'HTTP 503' } },
    });
    expect(state.bySearch.a.newCount).toBe(4);
    expect(state.bySearch.a.lastError).toBe('HTTP 503');
    expect(totalNew(state)).toBe(4);
  });
});

describe('the store', () => {
  it('is empty without storage', async () => {
    expect(await loadAlertState()).toEqual({ bySearch: {}, checkedAt: null });
  });

  it('saves, clears one, clears all', async () => {
    installStorage();
    await saveAlertState({
      checkedAt: 1,
      bySearch: {
        a: { seen: ['x'], newCount: 2, checkedAt: 1, lastError: '' },
        b: { seen: ['y'], newCount: 3, checkedAt: 1, lastError: '' },
      },
    });
    expect(totalNew(await loadAlertState())).toBe(5);

    let state = await clearNewCount('a');
    expect(state.bySearch.a.newCount).toBe(0);
    expect(state.bySearch.a.seen).toEqual(['x']);
    expect(totalNew(state)).toBe(3);

    state = await clearAllNew();
    expect(totalNew(state)).toBe(0);
    expect(state.bySearch.b.seen).toEqual(['y']);
  });
});

describe('ALERT_INTERVALS', () => {
  it('offers sensible choices in minutes', () => {
    expect(ALERT_INTERVALS.map((i) => i.value)).toEqual([60, 180, 360, 720, 1440]);
    for (const interval of ALERT_INTERVALS) expect(interval.label.length).toBeGreaterThan(2);
  });
});

describe('what the notification says', () => {
  const one = [{ name: 'Virtual assistant', count: 3, url: 'https://x/?k=va' }];
  const many = [
    { name: 'Virtual assistant', count: 3, url: 'https://x/?k=va' },
    { name: 'Data entry', count: 1, url: 'https://x/?k=de' },
  ];

  it('names the search when only one found anything', () => {
    expect(alertMessage(one)).toBe('3 new jobs for "Virtual assistant"');
  });

  it('sums across searches rather than listing them', () => {
    expect(alertMessage(many)).toBe('4 new jobs across 2 saved searches');
  });

  it('says "job" for a single listing', () => {
    expect(alertMessage([{ name: 'VA', count: 1, url: 'u' }])).toBe('1 new job for "VA"');
  });

  it('is empty when nothing arrived, so nothing is posted', () => {
    expect(alertMessage([])).toBe('');
    expect(alertMessage([{ name: 'VA', count: 0, url: 'u' }])).toBe('');
    expect(alertMessage(null)).toBe('');
  });

  it('ignores searches that found nothing when counting', () => {
    expect(alertMessage([...one, { name: 'Quiet', count: 0, url: 'u' }])).toBe(
      '3 new jobs for "Virtual assistant"',
    );
  });
});

describe('where a click on the notification goes', () => {
  it('carries the search url when there is only one', () => {
    const id = notificationId([{ name: 'VA', count: 2, url: 'https://x/?k=va' }]);
    expect(id).toBe(`${NOTIFICATION_PREFIX}https://x/?k=va`);
    expect(notificationTarget(id)).toBe('https://x/?k=va');
  });

  it('carries nothing when several searches found something', () => {
    const id = notificationId([
      { name: 'VA', count: 2, url: 'https://x/?k=va' },
      { name: 'DE', count: 1, url: 'https://x/?k=de' },
    ]);
    expect(notificationTarget(id)).toBe('');
  });

  it('ignores an id that is not ours', () => {
    expect(notificationTarget('some-other-extension:thing')).toBe('');
    expect(notificationTarget(undefined)).toBe('');
  });
});
