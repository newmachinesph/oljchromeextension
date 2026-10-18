/**
 * What the popup says about a low credit balance.
 *
 * Pure, so the exact wording and the exact thresholds are pinned by a test
 * rather than buried in DOM code. The balance is only ever a display value - the
 * server decides entitlement when work is asked for - so nothing here gates a
 * feature; it only decides which nudge, if any, to show.
 *
 * Three steps, matching the product:
 *   - at 5 or fewer, a quiet notice;
 *   - at 2 or fewer, a "running low" prompt with a way to top up;
 *   - at 0, out of AI credits, reassuring that the free tools still work, with
 *     the two ways to get more (buy, or invite friends).
 */

/** The balance at or below which each nudge appears. */
export const NUDGE_NOTICE_AT = 5;
export const NUDGE_LOW_AT = 2;

/**
 * The nudge for a spendable balance, or null when there is nothing to say.
 *
 * @param {number} credits spendable balance
 * @returns {{level: 'out'|'low'|'notice', title: string, body: string,
 *            actions: Array<'get-credits'|'invite'>}|null}
 */
export function creditNudge(credits) {
  const balance = Number.isFinite(credits) ? Math.max(0, Math.floor(credits)) : null;
  if (balance === null) return null;

  if (balance === 0) {
    return {
      level: 'out',
      title: "You're Out of AI Credits",
      body: 'Your free PowerTools features are still available.',
      actions: ['get-credits', 'invite'],
    };
  }

  if (balance <= NUDGE_LOW_AT) {
    return {
      level: 'low',
      title: "You're Running Low",
      body: `${balance} AI credit${balance === 1 ? '' : 's'} left.`,
      actions: ['get-credits'],
    };
  }

  if (balance <= NUDGE_NOTICE_AT) {
    return {
      level: 'notice',
      title: `${balance} Credits Remaining`,
      body: 'Each AI action spends one or more.',
      actions: [],
    };
  }

  return null;
}
