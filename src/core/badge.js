/**
 * The one number the toolbar icon can show.
 *
 * Two things want the badge: applications due a follow-up, and new listings
 * for a watched search. The icon has room for a single short figure, so it
 * shows the sum and the popup breaks it down. Empty at zero - a "0" badge is
 * noise that never goes away.
 */

const MAX_SHOWN = 99;

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function badgeText(due, fresh) {
  const total = count(due) + count(fresh);
  if (total === 0) return '';
  return total > MAX_SHOWN ? `${MAX_SHOWN}+` : String(total);
}
