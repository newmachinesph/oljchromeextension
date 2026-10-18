/**
 * What a rate is worth, judged against what you have actually seen.
 *
 * The parser already turns hundreds of listings a session into one comparable
 * figure, and then throws every one of them away. Keeping the shape of that
 * distribution costs almost nothing and answers the question the number alone
 * cannot: $800 a month is not good or bad, it is good or bad *for this kind of
 * work*.
 *
 * Counts per bucket, never a log of individual jobs. A running log would grow
 * without bound and would amount to the extension quietly accumulating a record
 * of your browsing; a histogram gives the same percentile in a few kilobytes
 * with nothing personal in it.
 */

const STORAGE_KEY = 'ojRateFilterBenchmark';

/**
 * Bucket floors, in USD per month.
 *
 * Tighter at the bottom where this site's listings actually cluster, and wide
 * at the top where the difference between $7,000 and $9,000 is not one anybody
 * is deciding on.
 */
export const BUCKETS = Object.freeze([
  0, 100, 200, 300, 400, 500, 650, 800, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000, 7500,
  10000,
]);

/** Below this many samples a percentile is noise dressed as a fact. */
export const MIN_SAMPLES = 25;

/** Above this, every count is halved - recent listings should weigh more. */
export const MAX_SAMPLES = 2000;

/** Skills are unbounded on the site; the least-seen are dropped first. */
const MAX_SKILLS = 300;

export function bucketFor(usdPerMonth) {
  if (!Number.isFinite(usdPerMonth) || usdPerMonth < 0) return null;

  for (let index = BUCKETS.length - 1; index >= 0; index -= 1) {
    if (usdPerMonth >= BUCKETS[index]) return index;
  }
  return 0;
}

const emptyHistogram = () => new Array(BUCKETS.length).fill(0);

function sanitizeHistogram(raw) {
  const counts = emptyHistogram();
  if (!Array.isArray(raw)) return counts;

  for (let index = 0; index < counts.length; index += 1) {
    const value = raw[index];
    counts[index] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
  return counts;
}

export function sampleCount(counts) {
  return (counts ?? []).reduce((sum, n) => sum + n, 0);
}

export function sanitizeStats(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const skills = {};

  const entries = Object.entries(input.skills ?? {})
    .filter(([name]) => String(name).trim().length > 0)
    .map(([name, counts]) => [String(name).trim().slice(0, 80), sanitizeHistogram(counts)]);

  // Over the cap the least-seen skills go: one you met twice tells you nothing,
  // and it is the long tail that would otherwise grow forever.
  entries.sort((a, b) => sampleCount(b[1]) - sampleCount(a[1]));
  for (const [name, counts] of entries.slice(0, MAX_SKILLS)) skills[name] = counts;

  return { all: sanitizeHistogram(input.all), skills };
}

/** Halve everything, so the distribution keeps its shape but forgets its age. */
function decay(counts) {
  return counts.map((n) => Math.floor(n / 2));
}

/**
 * Fold one listing into the stats. Pure - returns new stats.
 *
 * @param {object} stats
 * @param {number} usdPerMonth
 * @param {string[]} skills the chips on the card, possibly none
 */
export function addSample(stats, usdPerMonth, skills = []) {
  const bucket = bucketFor(usdPerMonth);
  if (bucket === null) return stats;

  const next = { all: [...stats.all], skills: { ...stats.skills } };

  const bump = (counts) => {
    const updated = [...counts];
    updated[bucket] += 1;
    return sampleCount(updated) > MAX_SAMPLES ? decay(updated) : updated;
  };

  next.all = bump(next.all);
  for (const skill of skills) {
    const name = String(skill ?? '').trim().slice(0, 80);
    if (name.length === 0) continue;
    next.skills[name] = bump(next.skills[name] ?? emptyHistogram());
  }

  return next;
}

/** Fold a whole page in one go, so a scan is one write rather than three hundred. */
export function addSamples(stats, samples) {
  return (samples ?? []).reduce(
    (current, sample) => addSample(current, sample.usdPerMonth, sample.skills),
    stats,
  );
}

/**
 * Where a figure sits in a distribution, 0-100.
 *
 * Everything below its bucket, plus half of its own - a figure in the middle of
 * the commonest bucket should read as the middle, not as the bottom of it.
 *
 * @returns {number|null} null when there is not enough to say
 */
export function percentileOf(counts, usdPerMonth, minSamples = MIN_SAMPLES) {
  const bucket = bucketFor(usdPerMonth);
  const total = sampleCount(counts);
  if (bucket === null || total < minSamples) return null;

  let below = 0;
  for (let index = 0; index < bucket; index += 1) below += counts[index];

  return Math.round(((below + counts[bucket] / 2) / total) * 100);
}

/**
 * The best available reading for one listing.
 *
 * A skill you have seen enough of beats the whole board, since "good for a
 * video editor" is the useful comparison and "good for anything" is not. Among
 * skills, the one with the most samples wins.
 *
 * @returns {{percentile: number, label: string, samples: number,
 *   wholeBoard: boolean}|null}
 */
export function rateStanding(stats, usdPerMonth, skills = []) {
  if (!stats) return null;

  let best = null;
  for (const skill of skills) {
    const counts = stats.skills?.[String(skill ?? '').trim()];
    if (!counts) continue;

    const percentile = percentileOf(counts, usdPerMonth);
    if (percentile === null) continue;

    const samples = sampleCount(counts);
    if (!best || samples > best.samples) {
      best = { percentile, label: String(skill).trim(), samples, wholeBoard: false };
    }
  }
  if (best) return best;

  const percentile = percentileOf(stats.all, usdPerMonth);
  if (percentile === null) return null;

  return {
    percentile,
    label: 'all listings',
    samples: sampleCount(stats.all),
    wholeBoard: true,
  };
}

/** Plain wording for a standing, for a tooltip or the modal. */
export function describeStanding(standing) {
  if (!standing) return '';

  const { percentile, label, samples } = standing;
  const where =
    percentile >= 75
      ? 'well above'
      : percentile >= 55
        ? 'above'
        : percentile <= 25
          ? 'well below'
          : percentile <= 45
            ? 'below'
            : 'about';

  // "the typical Video Editing listing", but "the typical listing" for the whole
  // board - "the typical all listings listing" is what naive interpolation gets
  // you, and it reads like a bug because it is one.
  const against = standing.wholeBoard ? 'the typical listing' : `the typical ${label} listing`;

  return `Pays ${where} ${against} — higher than ${percentile}% of the ${samples} you have seen.`;
}

/** Only the ends are worth marking; the middle is just "normal". */
export function standingTone(standing) {
  if (!standing) return null;
  if (standing.percentile >= 75) return 'high';
  if (standing.percentile <= 25) return 'low';
  return null;
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export async function loadStats() {
  if (!hasStorage()) return sanitizeStats({});
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeStats(stored?.[STORAGE_KEY]);
}

export async function saveStats(stats) {
  const clean = sanitizeStats(stats);
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: clean });
  return clean;
}

/**
 * Fold a page's worth of samples into what is already stored.
 *
 * Re-reads rather than writing from a snapshot, which is how every other store
 * here works - `setDismissed`, `setApplication` and `markExpired` all load
 * immediately before they save. It matters more for this one than for those: a
 * results page stays open for a long time, the whole histogram is rewritten
 * each save, and a base read at page load would silently discard everything a
 * second tab learned in the meantime.
 *
 * Writes are chained so two overlapping calls in one tab cannot both read the
 * same base and clobber each other. Across tabs it is still last-writer-wins -
 * chrome.storage has no transaction - but the window shrinks from a whole
 * browsing session to a single await.
 *
 * @param {Array<{usdPerMonth: number, skills: string[]}>} samples
 * @returns {Promise<object>} the stats as they now stand
 */
let pendingWrite = Promise.resolve();

export function recordSamples(samples) {
  pendingWrite = pendingWrite
    .catch(() => {})
    .then(async () => {
      if (!samples || samples.length === 0) return loadStats();
      return saveStats(addSamples(await loadStats(), samples));
    });

  return pendingWrite;
}

export async function clearStats() {
  const empty = sanitizeStats({});
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: empty });
  return empty;
}
