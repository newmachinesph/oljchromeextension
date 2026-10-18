// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  currentOffset,
  pageUrl,
  fetchAdditionalPages,
  fetchSearches,
  searchUrl,
  mergeCards,
  removeImported,
  prependCards,
  clearFresh,
  clearSearchHits,
  FRESH_ATTR,
  SEARCH_HIT_ATTR,
  mapLimit,
  FETCH_CONCURRENCY,
  requestsInFlight,
  MAX_REQUESTS_PER_LOAD,
} from '../src/content/prefetch.js';
import { clearCache } from '../src/content/page-cache.js';

const loc = (pathname, search = '') => ({ pathname, search });

function card(id) {
  return `
    <div class="jobpost-cat-box">
      <a href="/jobseekers/job/role-${id}">Role ${id}</a>
      <dl><dt><i class="icon icon-round-dollar"></i></dt><dd>$${id}00/month</dd></dl>
    </div>
  `;
}

/** A page of results, as the site would return it. */
function page(...ids) {
  return { ok: true, text: async () => `<html><body>${ids.map(card).join('')}</body></html>` };
}

beforeEach(() => {
  document.body.innerHTML = '';
  // Every test starts cold. Without this a page fetched by an earlier test is
  // served from the tab cache and the fetch spy never fires - which is the
  // cache working, and a test asserting on request counts silently measuring
  // nothing.
  clearCache();
});

describe('the default', () => {
  it('merges one further page - saved searches multiply requests, so the default stays light', async () => {
    const { DEFAULTS } = await import('../src/core/settings.js');
    expect(DEFAULTS.prefetchPages).toBe(1);
  });

  it('re-checks for new listings every 3 minutes by default', async () => {
    const { DEFAULTS } = await import('../src/core/settings.js');
    expect(DEFAULTS.autoRefreshMinutes).toBe(3);
  });

  it('is clamped to a sane range, capped at five', async () => {
    const { sanitize } = await import('../src/core/settings.js');
    expect(sanitize({ prefetchPages: 999 }).prefetchPages).toBe(5);
    expect(sanitize({ prefetchPages: -3 }).prefetchPages).toBe(0);
  });
});

describe('currentOffset', () => {
  it('reads 0 for the first page', () => {
    expect(currentOffset(loc('/jobseekers/jobsearch'))).toBe(0);
  });

  it('reads the offset from the path', () => {
    expect(currentOffset(loc('/jobseekers/jobsearch/60'))).toBe(60);
  });
});

describe('pageUrl', () => {
  it('keeps the search query intact', () => {
    expect(pageUrl(90, loc('/jobseekers/jobsearch/30', '?jobkeyword=writer'))).toBe(
      '/jobseekers/jobsearch/90?jobkeyword=writer',
    );
  });
});

/** A fetch stand-in that records how many calls overlap. */
function countingFetch(onCall = () => {}) {
  let live = 0;
  let peak = 0;
  const impl = async (url) => {
    live += 1;
    peak = Math.max(peak, live);
    onCall(url);
    // Yield twice so every runner has a chance to start before any resolves.
    await Promise.resolve();
    await Promise.resolve();
    live -= 1;
    return page(1);
  };
  return { impl, peak: () => peak };
}

describe('mapLimit', () => {
  it('keeps input order regardless of completion order', async () => {
    const out = await mapLimit([3, 1, 2], 3, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });
    expect(out).toEqual([3, 1, 2]);
  });

  it('never runs more than the limit at once', async () => {
    let live = 0;
    let peak = 0;

    await mapLimit(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 1));
      live -= 1;
    });

    expect(peak).toBe(4);
  });

  it('still runs everything', async () => {
    const seen = [];
    await mapLimit([1, 2, 3, 4, 5, 6, 7], 2, async (n) => seen.push(n));
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('does not idle a runner waiting on a slow sibling', async () => {
    // Batching would make this 2 rounds; a shared cursor makes it 1 slow + 3 fast.
    const order = [];
    await mapLimit([50, 1, 1, 1], 2, async (ms, index) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      order.push(index);
    });
    // The three quick ones all finish before the slow first one.
    expect(order).toEqual([1, 2, 3, 0]);
  });

  it('handles an empty list', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});

describe('request throttling', () => {
  it('caps how many pages are in flight at once', async () => {
    const { impl, peak } = countingFetch();

    await fetchAdditionalPages({
      count: 10,
      loc: loc('/jobseekers/jobsearch'),
      fetchImpl: impl,
    });

    expect(peak()).toBeLessThanOrEqual(FETCH_CONCURRENCY);
  });

  it('caps keyword searches too - four terms over five pages is twenty requests', async () => {
    const seen = [];
    const { impl, peak } = countingFetch((url) => seen.push(url));

    await fetchSearches({
      keywords: ['engineer', 'full stack', 'developer', 'fullstack'],
      pages: 5,
      fetchImpl: impl,
    });

    // Twenty is under the per-load ceiling, so nothing is trimmed.
    expect(seen).toHaveLength(20);
    expect(peak()).toBeLessThanOrEqual(FETCH_CONCURRENCY);
  });

  it('fetches strictly one page at a time', () => {
    expect(FETCH_CONCURRENCY).toBe(1);
  });

  it('shares one cap across overlapping operations', async () => {
    // The case a per-call pool misses: adding a search term while a page merge
    // is still in flight. Two pools of four would put eight on the wire, so the
    // cap belongs to the module rather than to one call.
    let peak = 0;
    const impl = async (url) => {
      peak = Math.max(peak, requestsInFlight());
      await new Promise((resolve) => setTimeout(resolve, 5));
      return page(1);
    };

    await Promise.all([
      fetchAdditionalPages({ count: 8, loc: loc('/jobseekers/jobsearch'), fetchImpl: impl }),
      fetchSearches({ keywords: ['engineer', 'writer'], pages: 5, fetchImpl: impl }),
    ]);

    expect(peak).toBeLessThanOrEqual(FETCH_CONCURRENCY);
  });

  it('gives every slot back, so a later search is not starved', async () => {
    await fetchAdditionalPages({
      count: 6,
      loc: loc('/jobseekers/jobsearch'),
      fetchImpl: async (url) => (url.includes('/60') ? { ok: false } : page(1)),
    });

    expect(requestsInFlight()).toBe(0);
  });

  it('releases the slot even when a request throws', async () => {
    await fetchSearches({
      keywords: ['engineer'],
      pages: 3,
      fetchImpl: async () => {
        throw new Error('network');
      },
    });

    expect(requestsInFlight()).toBe(0);
  });
});

describe('fetchAdditionalPages', () => {
  it('requests the pages after the current one', async () => {
    const seen = [];
    const fetchImpl = vi.fn(async (url) => {
      seen.push(url);
      return page(1, 2);
    });

    const cards = await fetchAdditionalPages({
      count: 3,
      loc: loc('/jobseekers/jobsearch', '?jobkeyword='),
      fetchImpl,
    });

    expect(seen).toEqual([
      '/jobseekers/jobsearch/30?jobkeyword=',
      '/jobseekers/jobsearch/60?jobkeyword=',
      '/jobseekers/jobsearch/90?jobkeyword=',
    ]);
    expect(cards).toHaveLength(6);
  });

  it('continues from a later offset', async () => {
    const seen = [];
    await fetchAdditionalPages({
      count: 2,
      loc: loc('/jobseekers/jobsearch/120'),
      fetchImpl: async (url) => {
        seen.push(url);
        return page(1);
      },
    });
    expect(seen).toEqual(['/jobseekers/jobsearch/150', '/jobseekers/jobsearch/180']);
  });

  it('survives a page that fails', async () => {
    const cards = await fetchAdditionalPages({
      count: 3,
      loc: loc('/jobseekers/jobsearch'),
      fetchImpl: async (url) => {
        if (url.includes('/60')) throw new Error('network');
        if (url.includes('/90')) return { ok: false };
        return page(1, 2);
      },
    });
    // Only the first page contributed, and nothing threw.
    expect(cards).toHaveLength(2);
  });

  it('does nothing when asked for no pages', async () => {
    const fetchImpl = vi.fn();
    expect(await fetchAdditionalPages({ count: 0, fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('fetchSearches', () => {
  it('runs one search per keyword and combines them', async () => {
    const seen = [];
    const { cards } = await fetchSearches({
      keywords: ['engineer', 'full stack', 'developer', 'fullstack'],
      pages: 1,
      fetchImpl: async (url) => {
        seen.push(url);
        return page(1, 2);
      },
    });

    const keywords = seen.map((url) => new URL(url, 'https://x').searchParams.get('jobkeyword'));
    expect(keywords).toEqual(['engineer', 'full stack', 'developer', 'fullstack']);
    expect(seen.every((url) => url.startsWith('/jobseekers/jobsearch/0?'))).toBe(true);
    expect(cards).toHaveLength(8);
  });

  it('submits the same parameters as the site\'s own search form', () => {
    const params = new URL(searchUrl('engineer', 30), 'https://x').searchParams;

    expect(params.get('jobkeyword')).toBe('engineer');
    expect(params.get('isFromJobsearchForm')).toBe('1');
    expect(params.get('gig')).toBe('on');
    expect(params.get('partTime')).toBe('on');
    expect(params.get('fullTime')).toBe('on');
    // Left empty deliberately: the site keys skill_tags by numeric skill IDs,
    // so skill filtering is done in the page instead.
    expect(params.get('skill_tags')).toBe('');
  });

  it('pages each keyword', async () => {
    const seen = [];
    await fetchSearches({
      keywords: ['writer'],
      pages: 3,
      fetchImpl: async (url) => {
        seen.push(url);
        return page(1);
      },
    });
    const offsets = seen.map((url) => url.match(/jobsearch\/(\d+)\?/)[1]);
    expect(offsets).toEqual(['0', '30', '60']);
  });

  it('ignores blank terms and does nothing when there are none', async () => {
    const fetchImpl = vi.fn();
    expect((await fetchSearches({ keywords: ['', '  '], fetchImpl })).cards).toEqual([]);
    expect((await fetchSearches({ keywords: [], fetchImpl })).cards).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('combines the searches into one deduplicated list', async () => {
    document.body.innerHTML = '<div id="results"></div>';
    const host = document.getElementById('results');

    // The same job matching two keywords must appear once.
    const { cards } = await fetchSearches({
      keywords: ['engineer', 'developer'],
      fetchImpl: async (url) => (url.includes('engineer') ? page(1, 2) : page(2, 3)),
    });

    expect(cards).toHaveLength(4);
    expect(mergeCards(cards, host)).toBe(3);
  });
});

describe('mergeCards', () => {
  function container(...ids) {
    document.body.innerHTML = `<div id="results">${ids.map(card).join('')}</div>`;
    return document.getElementById('results');
  }

  async function cardsFrom(...ids) {
    return fetchAdditionalPages({
      count: 1,
      loc: loc('/jobseekers/jobsearch'),
      fetchImpl: async () => page(...ids),
    });
  }

  it('appends the new listings', async () => {
    const host = container(1, 2);
    const added = mergeCards(await cardsFrom(3, 4), host);

    expect(added).toBe(2);
    expect(host.querySelectorAll('.jobpost-cat-box')).toHaveLength(4);
  });

  it('skips listings already on the page', async () => {
    const host = container(1, 2);
    // New postings shift the offsets, so overlap is expected, not exceptional.
    const added = mergeCards(await cardsFrom(2, 3), host);

    expect(added).toBe(1);
    expect(host.querySelectorAll('.jobpost-cat-box')).toHaveLength(3);
  });

  it('deduplicates within one batch', async () => {
    const host = container(1);
    expect(mergeCards(await cardsFrom(2, 2, 3), host)).toBe(2);
  });

  it('marks what it added, so it can be taken back out', async () => {
    const host = container(1);
    mergeCards(await cardsFrom(2, 3), host);

    expect(host.querySelectorAll('[data-ojrf-imported]')).toHaveLength(2);

    removeImported(document);
    expect(host.querySelectorAll('.jobpost-cat-box')).toHaveLength(1);
    expect(host.querySelector('a').getAttribute('href')).toBe('/jobseekers/job/role-1');
  });

  it('does nothing without a container', async () => {
    expect(mergeCards(await cardsFrom(1), null)).toBe(0);
  });

  it('marks what a keyword search brought back as a hit', async () => {
    const host = container(1);
    mergeCards(await cardsFrom(2, 3), host, document, { searchHit: true });

    expect(host.querySelectorAll(`[${SEARCH_HIT_ATTR}]`)).toHaveLength(2);
  });

  it('marks a card already on the page when the search returns it too', async () => {
    // The site's own results and ours overlap, and mergeCards skips the
    // duplicate rather than importing it. Skipping it silently left the copy on
    // the page unmarked - a genuine hit that the search rule then hid.
    const host = container(1, 2);
    mergeCards(await cardsFrom(2, 3), host, document, { searchHit: true });

    const marked = Array.from(host.querySelectorAll(`[${SEARCH_HIT_ATTR}]`), (node) =>
      node.querySelector('a').getAttribute('href'),
    );
    expect(marked).toEqual(['/jobseekers/job/role-2', '/jobseekers/job/role-3']);
  });

  it('leaves an ordinary page merge unmarked', async () => {
    const host = container(1);
    mergeCards(await cardsFrom(2), host);

    expect(host.querySelectorAll(`[${SEARCH_HIT_ATTR}]`)).toHaveLength(0);
  });

  it('clears the marks, so the last search does not vouch for this one', async () => {
    const host = container(1);
    mergeCards(await cardsFrom(2), host, document, { searchHit: true });

    clearSearchHits(document);
    expect(host.querySelectorAll(`[${SEARCH_HIT_ATTR}]`)).toHaveLength(0);
  });
});

describe('the tab cache', () => {
  /**
   * The reason it exists: ten terms over five pages is fifty requests, and
   * without a cache every refresh made all fifty again. A signed-in account
   * doing that each time someone presses F5 is what gets rate-limited.
   */
  it('does not ask twice for the same page', async () => {
    const seen = [];
    const impl = async (url) => {
      seen.push(url);
      return page(1, 2);
    };

    await fetchSearches({ keywords: ['n8n'], pages: 2, fetchImpl: impl });
    expect(seen).toHaveLength(2);

    // The refresh.
    await fetchSearches({ keywords: ['n8n'], pages: 2, fetchImpl: impl });
    expect(seen).toHaveLength(2);
  });

  it('gives back the same listings from cache as from the wire', async () => {
    const impl = async () => page(1, 2, 3);

    const first = await fetchSearches({ keywords: ['n8n'], pages: 1, fetchImpl: impl });
    const second = await fetchSearches({ keywords: ['n8n'], pages: 1, fetchImpl: impl });

    expect(second.cards).toHaveLength(first.cards.length);
    expect(second.cards.map((c) => c.querySelector('a').getAttribute('href'))).toEqual(
      first.cards.map((c) => c.querySelector('a').getAttribute('href')),
    );
  });

  it('goes to the wire again once the cache is cleared', async () => {
    let calls = 0;
    const impl = async () => {
      calls += 1;
      return page(1);
    };

    await fetchSearches({ keywords: ['n8n'], pages: 1, fetchImpl: impl });
    clearCache();
    await fetchSearches({ keywords: ['n8n'], pages: 1, fetchImpl: impl });

    expect(calls).toBe(2);
  });

  it('can be told not to use the cache at all', async () => {
    let calls = 0;
    const impl = async () => {
      calls += 1;
      return page(1);
    };

    await fetchSearches({ keywords: ['n8n'], pages: 1, fetchImpl: impl, useCache: false });
    await fetchSearches({ keywords: ['n8n'], pages: 1, fetchImpl: impl, useCache: false });

    expect(calls).toBe(2);
  });
});

describe('the per-load request ceiling', () => {
  it('trims pages per term rather than dropping a search', async () => {
    // Ten terms at five pages each would be fifty requests on every load.
    // Dropping whole terms would silently remove results you asked for, so the
    // tail shortens instead.
    const seen = [];
    const impl = async (url) => {
      seen.push(url);
      return page(1);
    };

    const terms = Array.from({ length: 10 }, (unused, i) => `term-${i}`);
    const result = await fetchSearches({ keywords: terms, pages: 5, fetchImpl: impl });

    expect(seen.length).toBeLessThanOrEqual(MAX_REQUESTS_PER_LOAD);
    expect(result.capped).toBe(true);

    // Every term still got at least its first page.
    for (const term of terms) {
      expect(seen.some((url) => url.includes(encodeURIComponent(term)))).toBe(true);
    }
  });

  it('never drops below one page each, however many terms', async () => {
    const seen = [];
    const impl = async (url) => {
      seen.push(url);
      return page(1);
    };

    const terms = Array.from({ length: MAX_REQUESTS_PER_LOAD + 15 }, (unused, i) => `t-${i}`);
    const result = await fetchSearches({ keywords: terms, pages: 5, fetchImpl: impl });

    expect(result.pagesPerTerm).toBe(1);
    expect(seen).toHaveLength(terms.length);
  });

  it('leaves a modest fan-out alone', async () => {
    const seen = [];
    const impl = async (url) => {
      seen.push(url);
      return page(1);
    };

    const result = await fetchSearches({ keywords: ['a', 'b'], pages: 3, fetchImpl: impl });

    expect(result.capped).toBe(false);
    expect(seen).toHaveLength(6);
  });
});

describe('prependCards', () => {
  /** A container shaped like the real page: our UI first, then the listings. */
  function host(...ids) {
    const node = document.createElement('div');
    node.innerHTML = `<div id="ojrf-bar">control bar</div>${ids.map(card).join('')}`;
    return node;
  }

  const parse = (...ids) => {
    const doc = new DOMParser().parseFromString(`<body>${ids.map(card).join('')}</body>`, 'text/html');
    return Array.from(doc.querySelectorAll('.jobpost-cat-box'));
  };

  const titles = (node) =>
    Array.from(node.querySelectorAll('.jobpost-cat-box a'), (a) => a.textContent);

  const bar = (container) => container.querySelector('#ojrf-bar');

  it('inserts above the listings but below our own UI', () => {
    const container = host(3, 4);

    prependCards(parse(1, 2), container, document, { after: bar(container) });

    // The bar must still come before every listing - putting new arrivals above
    // it stranded them at the top of the page.
    expect(container.firstElementChild.id).toBe('ojrf-bar');
    expect(titles(container)).toEqual(['Role 1', 'Role 2', 'Role 3', 'Role 4']);
  });

  it('stays below the bar even when a card is already above it', () => {
    // The state the live page was in: an earlier arrival had landed above the
    // bar, so "the first card" was no longer a card below the bar. Anchoring on
    // it piled every later batch up there too, and it could never recover.
    const container = document.createElement('div');
    container.innerHTML = `${card(8)}<div id="ojrf-bar">control bar</div>${card(9)}`;

    prependCards(parse(1), container, document, { after: bar(container) });

    const order = Array.from(container.children).map((el) =>
      el.id === 'ojrf-bar' ? 'BAR' : el.querySelector('a').textContent,
    );
    expect(order).toEqual(['Role 8', 'BAR', 'Role 1', 'Role 9']);
  });

  it('appends when every listing is above the bar', () => {
    const container = document.createElement('div');
    container.innerHTML = `${card(8)}<div id="ojrf-bar">control bar</div>`;

    prependCards(parse(1), container, document, { after: bar(container) });

    const order = Array.from(container.children).map((el) =>
      el.id === 'ojrf-bar' ? 'BAR' : el.querySelector('a').textContent,
    );
    expect(order).toEqual(['Role 8', 'BAR', 'Role 1']);
  });

  it("keeps the site's own order within the batch", () => {
    const container = host(9);
    prependCards(parse(1, 2, 3), container);
    expect(titles(container)).toEqual(['Role 1', 'Role 2', 'Role 3', 'Role 9']);
  });

  it('skips listings already on the page', () => {
    const container = host(1, 2);
    expect(prependCards(parse(1, 3), container)).toBe(1);
    expect(titles(container)).toEqual(['Role 3', 'Role 1', 'Role 2']);
  });

  it('marks what it added, and clearFresh takes the mark off', () => {
    const container = host(2);
    prependCards(parse(1), container);

    expect(container.querySelectorAll(`[${FRESH_ATTR}]`)).toHaveLength(1);
    clearFresh(container);
    expect(container.querySelectorAll(`[${FRESH_ATTR}]`)).toHaveLength(0);
  });

  it('appends when there is no listing to sit above', () => {
    const container = host();
    prependCards(parse(1), container);

    expect(container.firstElementChild.id).toBe('ojrf-bar');
    expect(titles(container)).toEqual(['Role 1']);
  });

  it('adds nothing, and reports nothing, for an empty batch', () => {
    const container = host(1);
    expect(prependCards([], container)).toBe(0);
    expect(prependCards(parse(1), container)).toBe(0);
  });

  it('is safe with no container', () => {
    expect(prependCards(parse(1), null)).toBe(0);
  });
});
