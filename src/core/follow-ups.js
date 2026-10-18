/**
 * Which applications are waiting on you.
 *
 * An application sits in "applied" until something happens, and on this site
 * plenty of them sit there forever. The useful question is not "did I apply"
 * - the chip says so - but "has it been long enough that I should nudge them".
 * This answers it from the record alone: status, when you applied, and when
 * you last followed up.
 *
 * Pure. The badge, the card chip, the bar's pill and the popup all read from
 * here, so they can never disagree about who is due.
 */

export const MS_PER_DAY = 86400000;

/** A week without a reply is long enough to ask. */
export const FOLLOW_UP_DAYS_DEFAULT = 7;

/** When the clock started: your last nudge, or the application itself. */
function waitingSince(application) {
  if (Number.isFinite(application?.followedUpAt)) return application.followedUpAt;
  return Number.isFinite(application?.appliedAt) ? application.appliedAt : null;
}

/**
 * Whether one application is due a follow-up.
 *
 * Only "applied" counts. Interviewing means they answered; an offer or a
 * rejection closes the question.
 */
export function isDue(application, now, days = FOLLOW_UP_DAYS_DEFAULT) {
  if (!application || application.status !== 'applied') return false;
  const since = waitingSince(application);
  if (since === null) return false;
  return now - since >= days * MS_PER_DAY;
}

/**
 * Every due application, the longest wait first.
 *
 * @param {Map<string, object>} applications
 * @returns {Array<{key: string, title: string, url: string, appliedAt: number,
 *   daysWaiting: number, followedUp: boolean}>}
 */
export function dueFollowUps(applications, now, days = FOLLOW_UP_DAYS_DEFAULT) {
  if (!applications || typeof applications.entries !== 'function') return [];

  const due = [];
  for (const [key, application] of applications.entries()) {
    if (!isDue(application, now, days)) continue;
    const since = waitingSince(application);
    due.push({
      key,
      title: application.title ?? '',
      url: application.url ?? '',
      appliedAt: application.appliedAt,
      daysWaiting: Math.floor((now - since) / MS_PER_DAY),
      followedUp: Number.isFinite(application.followedUpAt),
    });
  }

  return due.sort((a, b) => b.daysWaiting - a.daysWaiting);
}

/** "applied 9d ago, no reply" - for the popup line and the chip tooltip. */
export function describeWaiting({ daysWaiting, followedUp }) {
  return `${followedUp ? 'followed up' : 'applied'} ${daysWaiting}d ago, no reply`;
}
