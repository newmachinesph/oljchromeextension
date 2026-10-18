/**
 * Posting times, written the way a person reads them.
 *
 * "Posted on 2026-08-17 16:07:49" takes a moment to decode into "is this fresh?".
 * "3h ago" answers that immediately, with the exact stamp kept in a tooltip.
 *
 * Pure: `now` is a parameter, so results never depend on when this runs.
 */

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * @param {number|null} then epoch ms
 * @param {number} now epoch ms
 * @returns {string|null} e.g. "just now", "42m ago", "3h ago", "6d ago"
 */
export function formatRelativeTime(then, now) {
  if (then === null || then === undefined || !Number.isFinite(then)) return null;

  // A clock skewed slightly into the future should read as new, not negative.
  const elapsed = Math.max(0, now - then);

  const minutes = Math.floor(elapsed / MINUTE);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(elapsed / HOUR);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(elapsed / DAY);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;

  return `${Math.floor(days / 365)}y ago`;
}

/** The full stamp, for the tooltip: "17 Aug 2026, 16:07". */
export function formatExactTime(then) {
  if (then === null || then === undefined || !Number.isFinite(then)) return '';

  const date = new Date(then);
  const pad = (value) => String(value).padStart(2, '0');

  return (
    `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
