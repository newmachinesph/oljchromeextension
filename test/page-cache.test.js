// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  readCached,
  writeCached,
  cacheStats,
  clearCache,
  CACHE_TTL_MS,
  MAX_CACHE_CHARS,
} from '../src/content/page-cache.js';

const URL_A = 'https://www.onlinejobs.ph/jobseekers/jobsearch?keyword=n8n';
const URL_B = 'https://www.onlinejobs.ph/jobseekers/jobsearch/30?keyword=n8n';
const CARDS = '<div class="jobpost-cat-box">a listing</div>';

/** Pinned, so the staleness tests do not depend on when they run. */
const NOW = Date.parse('2026-08-18T12:00:00Z');

beforeEach(() => {
  sessionStorage.clear();
});

describe('reading and writing', () => {
  it('gives back exactly what was stored', () => {
    expect(writeCached(URL_A, CARDS, NOW)).toBe(true);
    expect(readCached(URL_A, NOW)).toBe(CARDS);
  });

  it('knows nothing about a page it has not seen', () => {
    expect(readCached(URL_A, NOW)).toBeNull();
  });

  it('keeps pages apart by url', () => {
    writeCached(URL_A, 'first', NOW);
    writeCached(URL_B, 'second', NOW);

    expect(readCached(URL_A, NOW)).toBe('first');
    expect(readCached(URL_B, NOW)).toBe('second');
  });

  it('refuses to store nothing', () => {
    expect(writeCached(URL_A, '', NOW)).toBe(false);
    expect(writeCached(URL_A, null, NOW)).toBe(false);
  });
});

describe('going stale', () => {
  it('serves a page inside the window', () => {
    writeCached(URL_A, CARDS, NOW);
    expect(readCached(URL_A, NOW + CACHE_TTL_MS - 1000)).toBe(CARDS);
  });

  it('refuses a page past it, and forgets it', () => {
    // The cache must never be the reason you miss a job posted this morning.
    writeCached(URL_A, CARDS, NOW);

    expect(readCached(URL_A, NOW + CACHE_TTL_MS + 1)).toBeNull();
    expect(cacheStats(NOW).pages).toBe(0);
  });
});

describe('staying within its budget', () => {
  it('drops the oldest to make room', () => {
    const big = 'x'.repeat(Math.floor(MAX_CACHE_CHARS / 3));

    writeCached('url-1', big, NOW);
    writeCached('url-2', big, NOW + 1000);
    writeCached('url-3', big, NOW + 2000);
    writeCached('url-4', big, NOW + 3000);

    expect(readCached('url-1', NOW + 3000)).toBeNull();
    expect(readCached('url-4', NOW + 3000)).toBe(big);
    expect(cacheStats(NOW + 3000).chars).toBeLessThanOrEqual(MAX_CACHE_CHARS);
  });

  it('will not evict the whole cache for one oversized page', () => {
    writeCached(URL_A, CARDS, NOW);
    expect(writeCached(URL_B, 'x'.repeat(MAX_CACHE_CHARS + 1), NOW)).toBe(false);

    expect(readCached(URL_A, NOW)).toBe(CARDS);
  });
});

describe('when storage misbehaves', () => {
  it('survives a corrupted entry rather than throwing', () => {
    // This sits directly in the fetch path: a cache that throws is a broken
    // extension, not merely a slow one.
    sessionStorage.setItem(`ojrf:page:${URL_A}`, 'not json');

    expect(readCached(URL_A, NOW)).toBeNull();
    expect(() => cacheStats(NOW)).not.toThrow();
  });

  it('survives an entry with no markup in it', () => {
    sessionStorage.setItem(`ojrf:page:${URL_A}`, JSON.stringify({ at: NOW }));
    expect(readCached(URL_A, NOW)).toBeNull();
  });

  it('reports failure rather than throwing when a write is refused', () => {
    // jsdom's Storage is proxy-backed, so a plain assignment to setItem does
    // not take - it has to be defined on the prototype.
    const proto = Object.getPrototypeOf(sessionStorage);
    const real = Object.getOwnPropertyDescriptor(proto, 'setItem');

    Object.defineProperty(proto, 'setItem', {
      configurable: true,
      value: () => {
        throw new Error('QuotaExceededError');
      },
    });

    try {
      expect(writeCached(URL_A, CARDS, NOW)).toBe(false);
    } finally {
      Object.defineProperty(proto, 'setItem', real);
    }
  });
});

describe('housekeeping', () => {
  it('leaves other extensions and the site alone', () => {
    sessionStorage.setItem('someone-elses-key', 'keep me');
    writeCached(URL_A, CARDS, NOW);

    clearCache();

    expect(sessionStorage.getItem('someone-elses-key')).toBe('keep me');
    expect(readCached(URL_A, NOW)).toBeNull();
  });

  it('counts what it is holding', () => {
    writeCached(URL_A, CARDS, NOW);
    writeCached(URL_B, CARDS, NOW - CACHE_TTL_MS - 1);

    const stats = cacheStats(NOW);
    expect(stats.pages).toBe(2);
    expect(stats.fresh).toBe(1);
    expect(stats.chars).toBeGreaterThan(0);
  });

  it('says how many it forgot', () => {
    writeCached(URL_A, CARDS, NOW);
    writeCached(URL_B, CARDS, NOW);

    expect(clearCache()).toBe(2);
    expect(clearCache()).toBe(0);
  });
});
