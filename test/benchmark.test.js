import { describe, it, expect, beforeEach } from 'vitest';
import {
  BUCKETS,
  MIN_SAMPLES,
  MAX_SAMPLES,
  bucketFor,
  addSample,
  addSamples,
  sampleCount,
  percentileOf,
  rateStanding,
  describeStanding,
  standingTone,
  sanitizeStats,
  loadStats,
  saveStats,
  recordSamples,
  clearStats,
} from '../src/core/benchmark.js';

const STORAGE_KEY = 'ojRateFilterBenchmark';
const empty = () => sanitizeStats({});

/** n listings at one rate, all tagged with the same skills. */
const many = (stats, usd, count, skills = []) =>
  Array.from({ length: count }).reduce((current) => addSample(current, usd, skills), stats);

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

describe('bucketFor', () => {
  it('puts a figure in the bucket it belongs to', () => {
    expect(bucketFor(0)).toBe(0);
    expect(bucketFor(150)).toBe(1);
    expect(bucketFor(BUCKETS.at(-1) + 5000)).toBe(BUCKETS.length - 1);
  });

  it('puts a figure exactly on a floor into that bucket, not the one below', () => {
    expect(bucketFor(500)).toBe(BUCKETS.indexOf(500));
  });

  it('refuses anything that is not a usable figure', () => {
    expect(bucketFor(null)).toBeNull();
    expect(bucketFor(-1)).toBeNull();
    expect(bucketFor(NaN)).toBeNull();
  });
});

describe('addSample', () => {
  it('counts a listing against the whole board and each of its skills', () => {
    const stats = addSample(empty(), 800, ['Data Entry', 'Admin']);

    expect(sampleCount(stats.all)).toBe(1);
    expect(sampleCount(stats.skills['Data Entry'])).toBe(1);
    expect(sampleCount(stats.skills.Admin)).toBe(1);
  });

  it('counts a listing with no skills against the board alone', () => {
    const stats = addSample(empty(), 800);

    expect(sampleCount(stats.all)).toBe(1);
    expect(Object.keys(stats.skills)).toHaveLength(0);
  });

  it('ignores a listing with no usable figure', () => {
    const stats = empty();
    expect(addSample(stats, null, ['Data Entry'])).toBe(stats);
  });

  it('does not mutate what it is given', () => {
    const stats = empty();
    addSample(stats, 800, ['Data Entry']);

    expect(sampleCount(stats.all)).toBe(0);
    expect(stats.skills['Data Entry']).toBeUndefined();
  });

  it('halves the counts once a distribution grows past its cap', () => {
    // Keeps the shape, forgets the age - recent listings should weigh more.
    const stats = many(empty(), 800, MAX_SAMPLES + 1);
    expect(sampleCount(stats.all)).toBeLessThanOrEqual(MAX_SAMPLES / 2 + 1);
  });

  it('folds a whole page in one call', () => {
    const stats = addSamples(empty(), [
      { usdPerMonth: 400, skills: ['Design'] },
      { usdPerMonth: 900, skills: ['Design'] },
    ]);

    expect(sampleCount(stats.skills.Design)).toBe(2);
  });
});

describe('percentileOf', () => {
  it('says nothing until it has seen enough', () => {
    const thin = many(empty(), 800, MIN_SAMPLES - 1);
    expect(percentileOf(thin.all, 800)).toBeNull();
  });

  it('places a figure above a cheaper crowd', () => {
    const stats = many(empty(), 300, 60);
    expect(percentileOf(stats.all, 3000)).toBe(100);
  });

  it('places a figure below a dearer crowd', () => {
    const stats = many(empty(), 3000, 60);
    expect(percentileOf(stats.all, 200)).toBe(0);
  });

  it('reads the middle of one crowded bucket as the middle', () => {
    // Everything in the same bucket should read as average, not bottom of it.
    const stats = many(empty(), 800, 60);
    expect(percentileOf(stats.all, 800)).toBe(50);
  });

  it('splits a two-sided distribution sensibly', () => {
    let stats = many(empty(), 300, 30);
    stats = many(stats, 3000, 30);

    expect(percentileOf(stats.all, 3000)).toBeGreaterThan(70);
    expect(percentileOf(stats.all, 300)).toBeLessThan(30);
  });
});

describe('rateStanding', () => {
  it('prefers a skill it knows over the whole board', () => {
    // "Good for a video editor" is the useful comparison; "good for anything" is not.
    let stats = many(empty(), 200, 40, ['Video Editing']);
    stats = many(stats, 3000, 40);

    const standing = rateStanding(stats, 1000, ['Video Editing']);
    expect(standing.label).toBe('Video Editing');
    expect(standing.percentile).toBe(100);
    expect(standing.wholeBoard).toBe(false);
  });

  it('falls back to the whole board for an unknown skill', () => {
    const stats = many(empty(), 400, 40);
    expect(rateStanding(stats, 3000, ['Never Seen']).wholeBoard).toBe(true);
  });

  it('picks the best-sampled skill when several are known', () => {
    let stats = many(empty(), 500, 30, ['Thin']);
    stats = many(stats, 500, 90, ['Thick']);

    expect(rateStanding(stats, 500, ['Thin', 'Thick']).label).toBe('Thick');
  });

  it('says nothing at all when it has seen too little', () => {
    expect(rateStanding(empty(), 800, ['Design'])).toBeNull();
    expect(rateStanding(null, 800)).toBeNull();
  });
});

describe('describeStanding and standingTone', () => {
  it('marks only the ends, leaving the middle unremarked', () => {
    expect(standingTone({ percentile: 90 })).toBe('high');
    expect(standingTone({ percentile: 10 })).toBe('low');
    expect(standingTone({ percentile: 50 })).toBeNull();
    expect(standingTone(null)).toBeNull();
  });

  it('says where a rate sits, and on what evidence', () => {
    const words = describeStanding({ percentile: 88, label: 'Design', samples: 143 });

    expect(words).toContain('well above');
    expect(words).toContain('Design');
    expect(words).toContain('88%');
    expect(words).toContain('143');
  });

  it('stays readable when the comparison is the whole board', () => {
    // Naive interpolation gives "the typical all listings listing".
    const words = describeStanding({
      percentile: 88,
      label: 'all listings',
      samples: 306,
      wholeBoard: true,
    });

    expect(words).toContain('well above the typical listing');
    expect(words).not.toContain('all listings listing');
  });

  it('says nothing when there is no standing', () => {
    expect(describeStanding(null)).toBe('');
  });
});

describe('sanitizeStats', () => {
  it('turns anything at all into usable stats', () => {
    expect(sanitizeStats(null).all).toHaveLength(BUCKETS.length);
    expect(sanitizeStats('nonsense').skills).toEqual({});
  });

  it('repairs a histogram of the wrong shape', () => {
    const stats = sanitizeStats({ all: [1, 'x', -4, null] });

    expect(stats.all).toHaveLength(BUCKETS.length);
    expect(stats.all[0]).toBe(1);
    expect(stats.all[1]).toBe(0);
    expect(stats.all[2]).toBe(0);
  });

  it('drops the least-seen skills rather than growing forever', () => {
    const skills = {};
    for (let i = 0; i < 400; i += 1) skills[`Skill ${i}`] = [i];

    const kept = Object.keys(sanitizeStats({ skills }).skills);

    expect(kept).toHaveLength(300);
    // The ones kept are the ones actually seen.
    expect(kept).toContain('Skill 399');
    expect(kept).not.toContain('Skill 0');
  });
});

describe('the store', () => {
  it('reads empty stats when there is no chrome to read from', async () => {
    expect(sampleCount((await loadStats()).all)).toBe(0);
  });

  it('round-trips', async () => {
    installStorage();
    await saveStats(many(empty(), 800, 30, ['Design']));

    const back = await loadStats();
    expect(sampleCount(back.skills.Design)).toBe(30);
  });

  it('stores counts, never individual jobs', async () => {
    // The whole privacy argument for this feature, asserted rather than assumed.
    const store = installStorage();
    await saveStats(many(empty(), 800, 5, ['Design']));

    const written = JSON.stringify(store[STORAGE_KEY]);
    expect(written).not.toMatch(/http|jobseekers|title/i);
    expect(Object.keys(store[STORAGE_KEY]).sort()).toEqual(['all', 'skills']);
  });

  it('forgets everything on request', async () => {
    installStorage({ all: [5, 5], skills: { Design: [5] } });
    const cleared = await clearStats();

    expect(sampleCount(cleared.all)).toBe(0);
    expect(cleared.skills).toEqual({});
  });
});

describe('recordSamples', () => {
  it('folds a page into what is already stored', async () => {
    installStorage();
    await saveStats(many(empty(), 800, 10, ['Design']));

    const after = await recordSamples([{ usdPerMonth: 800, skills: ['Design'] }]);
    expect(sampleCount(after.skills.Design)).toBe(11);
  });

  it('keeps what another tab learned while this page sat open', async () => {
    // The bug this exists to prevent: a results page holds its stats in memory
    // for as long as it is open, and the whole histogram is rewritten on save.
    // Folding into the snapshot would throw away every sample the other tab
    // recorded in between.
    const store = installStorage();

    // This tab's view of the world, taken at page load.
    const atPageLoad = await loadStats();
    expect(sampleCount(atPageLoad.all)).toBe(0);

    // Meanwhile, a second tab learns 40 rates.
    await saveStats(many(empty(), 3000, 40, ['Design']));

    // This tab now writes its own pass.
    await recordSamples([{ usdPerMonth: 800, skills: ['Design'] }]);

    const merged = sanitizeStats(store[STORAGE_KEY]);
    expect(sampleCount(merged.all)).toBe(41);
    expect(sampleCount(merged.skills.Design)).toBe(41);
  });

  it('does not let two overlapping passes clobber each other', async () => {
    // Both start before either finishes - learnFromThisPass is deliberately not
    // awaited by render, so this is the ordinary case, not an exotic one.
    installStorage();

    await Promise.all([
      recordSamples([{ usdPerMonth: 800, skills: ['Design'] }]),
      recordSamples([{ usdPerMonth: 900, skills: ['Design'] }]),
      recordSamples([{ usdPerMonth: 1000, skills: ['Design'] }]),
    ]);

    expect(sampleCount((await loadStats()).all)).toBe(3);
  });

  it('is a no-op for an empty page', async () => {
    installStorage();
    await saveStats(many(empty(), 800, 5));

    expect(sampleCount((await recordSamples([])).all)).toBe(5);
    expect(sampleCount((await recordSamples(null)).all)).toBe(5);
  });

  it('keeps serving later callers after one write fails', async () => {
    installStorage();
    globalThis.chrome.storage.local.set = async () => {
      throw new Error('quota exceeded');
    };
    await expect(recordSamples([{ usdPerMonth: 800, skills: [] }])).rejects.toThrow();

    // A single failure must not wedge the chain for the rest of the session.
    installStorage();
    expect(sampleCount((await recordSamples([{ usdPerMonth: 800, skills: [] }])).all)).toBe(1);
  });
});
