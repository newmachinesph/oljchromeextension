/**
 * What your applications add up to.
 *
 * The application log answers "did I apply to this one". Across fifty of them
 * it can answer better questions: how many got a reply, whether the replies
 * are picking up, and whether the jobs that answered paid more or less than
 * the ones that did not. None of that needs anything beyond the records
 * already kept.
 *
 * Pure. The options page draws it; nothing here touches storage.
 */

import { APPLICATION_STATUSES, isReplyStatus, isPreApplication } from './applications.js';

const MS_PER_DAY = 86400000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/** A reply is an employer answering - see applications.js for what counts. */
function isReply(status) {
  return isReplyStatus(status);
}

function records(applications) {
  if (!applications || typeof applications.values !== 'function') return [];
  return [...applications.values()];
}

/**
 * The funnel: how many in each status, how many were actually sent, and what
 * share of those got any reply.
 *
 * `total` is every record, board included; `submitted` excludes the ones still
 * in preparing, because a response rate is only meaningful over applications
 * that actually went out.
 *
 * @returns {{total: number, submitted: number, byStatus: Record<string, number>,
 *   responseRate: number|null}}
 */
export function summarize(applications) {
  const byStatus = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s.value, 0]));
  let total = 0;
  let submitted = 0;
  let replies = 0;

  for (const record of records(applications)) {
    total += 1;
    if (record.status in byStatus) byStatus[record.status] += 1;
    if (!isPreApplication(record.status)) submitted += 1;
    if (isReply(record.status)) replies += 1;
  }

  return {
    total,
    submitted,
    byStatus,
    responseRate: submitted > 0 ? replies / submitted : null,
  };
}

/** A submitted application sitting this long with no reply counts as stale. */
export const DEFAULT_STALE_DAYS = 14;

/**
 * How long it took an employer to answer, in days, read from the stage-history
 * trail: the gap between reaching `applied` and the first reply status. Null
 * when it has not been replied to (or there is no usable history).
 *
 * @returns {number|null}
 */
export function daysToReply(record) {
  const history = Array.isArray(record?.history) ? record.history : [];
  const appliedEntry = history.find((h) => h.status === 'applied');
  const appliedAt = appliedEntry
    ? appliedEntry.at
    : (Number.isFinite(record?.appliedAt) ? record.appliedAt : null);
  const replyEntry = history.find((h) => isReply(h.status));
  if (appliedAt == null || !replyEntry || !Number.isFinite(replyEntry.at)) return null;
  const days = (replyEntry.at - appliedAt) / MS_PER_DAY;
  return days >= 0 ? days : null;
}

/**
 * A submitted-but-unanswered application that has waited past the threshold.
 * Only `applied` counts - `preparing` was never sent, and the reply statuses
 * already got an answer.
 */
export function isStale(record, now, thresholdDays = DEFAULT_STALE_DAYS) {
  if (record?.status !== 'applied') return false;
  const since = Number.isFinite(record?.updatedAt) ? record.updatedAt : record?.appliedAt;
  if (!Number.isFinite(since)) return false;
  return (now - since) / MS_PER_DAY >= thresholdDays;
}

/**
 * Velocity across the log: how fast replies come, and which applications have
 * gone quiet. Built entirely from the records already kept.
 *
 * @returns {{replied: number, avgDaysToReply: number|null,
 *   medianDaysToReply: number|null, stale: Array<{key: string, title: string,
 *   employer: string, days: number}>}}
 */
export function velocity(applications, now, thresholdDays = DEFAULT_STALE_DAYS) {
  const entries = applications && typeof applications.entries === 'function' ? [...applications.entries()] : [];
  const replyDays = [];
  const stale = [];
  for (const [key, record] of entries) {
    const d = daysToReply(record);
    if (d != null) replyDays.push(d);
    if (isStale(record, now, thresholdDays)) {
      const since = Number.isFinite(record.updatedAt) ? record.updatedAt : record.appliedAt;
      stale.push({
        key,
        title: record.title || 'Untitled job',
        employer: record.employer || '',
        days: Math.floor((now - since) / MS_PER_DAY),
      });
    }
  }
  const avg = replyDays.length ? replyDays.reduce((a, b) => a + b, 0) / replyDays.length : null;
  const sorted = [...replyDays].sort((a, b) => a - b);
  const median = sorted.length
    ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
    : null;
  stale.sort((a, b) => b.days - a.days);
  return { replied: replyDays.length, avgDaysToReply: avg, medianDaysToReply: median, stale };
}

/**
 * Midnight UTC on the Monday of the week holding this moment.
 *
 * UTC rather than local so a week is the same week whichever machine reads
 * the backup; the rows are labelled by date, not by clock time.
 */
export function weekStart(epochMs) {
  const date = new Date(epochMs);
  const day = date.getUTCDay(); // Sunday = 0
  const sinceMonday = (day + 6) % 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - sinceMonday);
}

function isoDate(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * One row per week, oldest first: applications made that week, and replies
 * that arrived that week (judged by when the status last moved).
 *
 * @returns {Array<{weekStart: string, applied: number, replies: number}>}
 */
export function byWeek(applications, now, weeks = 12) {
  const latest = weekStart(now);
  const earliest = latest - (weeks - 1) * MS_PER_WEEK;

  const rows = new Map();
  for (let start = earliest; start <= latest; start += MS_PER_WEEK) {
    rows.set(start, { weekStart: isoDate(start), applied: 0, replies: 0 });
  }

  for (const record of records(applications)) {
    // A job still in preparing has not been applied to, so it does not count
    // as an application this week - only as work in progress.
    if (!isPreApplication(record.status) && Number.isFinite(record.appliedAt)) {
      const row = rows.get(weekStart(record.appliedAt));
      if (row) row.applied += 1;
    }
    if (isReply(record.status) && Number.isFinite(record.updatedAt)) {
      const row = rows.get(weekStart(record.updatedAt));
      if (row) row.replies += 1;
    }
  }

  return [...rows.values()];
}

/**
 * Coarse on purpose. The benchmark's buckets suit a distribution of hundreds;
 * a funnel of a few dozen applications wants bands wide enough to hold more
 * than one each.
 */
export const RATE_BANDS = Object.freeze([
  { min: 0, max: 300, label: 'under $300' },
  { min: 300, max: 500, label: '$300–499' },
  { min: 500, max: 800, label: '$500–799' },
  { min: 800, max: 1200, label: '$800–1,199' },
  { min: 1200, max: 2000, label: '$1,200–1,999' },
  { min: 2000, max: Infinity, label: '$2,000 and up' },
]);

function bandFor(usdPerMonth) {
  if (!Number.isFinite(usdPerMonth) || usdPerMonth < 0) return null;
  return RATE_BANDS.find((band) => usdPerMonth >= band.min && usdPerMonth < band.max) ?? null;
}

/**
 * Response rate per pay band, for the applications that recorded a figure.
 * Bands with nothing in them are left out rather than shown as zero rows.
 *
 * @returns {Array<{label: string, total: number, replies: number, responseRate: number}>}
 */
export function byRateBand(applications) {
  const tallies = new Map();

  for (const record of records(applications)) {
    // Preparing jobs were never sent, so they belong in no response-rate row.
    if (isPreApplication(record.status)) continue;

    const band = bandFor(record.usdPerMonth);
    if (!band) continue;

    const tally = tallies.get(band) ?? { label: band.label, total: 0, replies: 0 };
    tally.total += 1;
    if (isReply(record.status)) tally.replies += 1;
    tallies.set(band, tally);
  }

  return RATE_BANDS.filter((band) => tallies.has(band)).map((band) => {
    const tally = tallies.get(band);
    return { ...tally, responseRate: tally.replies / tally.total };
  });
}
