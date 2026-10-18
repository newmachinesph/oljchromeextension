/**
 * Watching the first page of the current search while you read.
 *
 * The site lists newest first, so a posting that appears while you are part-way
 * down the page never shows up until you reload - and reloading costs you the
 * filter, the merged pages and your scroll position. This re-reads page one on
 * a timer and puts anything genuinely new at the top.
 *
 * Three deliberate limits, all of them about not hammering a signed-in account:
 *
 *   - one page per tick, never a merge - see FETCH_CONCURRENCY in prefetch.js,
 *     which serialises this against anything else already on the wire;
 *   - nothing at all while the tab is hidden, since a backgrounded tab polling
 *     all afternoon is exactly the traffic that gets an account rate-limited.
 *     A tab that comes back checks once immediately, then resumes the rhythm;
 *   - the timer is driven by the caller's clock, so tests do not sleep.
 *
 * Everything here is injected. The module never touches the network, the DOM or
 * a real timer itself, which is what makes the scheduling testable.
 */

/** Below this the polling is heavier than the browsing it is meant to help. */
export const MIN_INTERVAL_MINUTES = 1;
export const MAX_INTERVAL_MINUTES = 60;
export const DEFAULT_INTERVAL_MINUTES = 5;

/** Clamp anything into a usable number of minutes. */
export function clampInterval(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_INTERVAL_MINUTES;
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(n)));
}

/**
 * @param {object} deps
 * @param {() => boolean} deps.isEnabled read per tick, so the setting can be
 *   flipped without tearing the poller down
 * @param {() => number} deps.getIntervalMinutes likewise
 * @param {() => Promise<number>} deps.checkNow does the fetch-and-prepend and
 *   resolves with how many arrived
 * @param {(count: number) => void} [deps.onResult]
 * @param {() => boolean} [deps.isHidden]
 * @param {(fn: Function, ms: number) => any} [deps.setTimer]
 * @param {(handle: any) => void} [deps.clearTimer]
 * @param {(type: string, fn: Function) => void} [deps.onVisibilityChange]
 */
export function createAutoRefresh({
  isEnabled,
  getIntervalMinutes,
  checkNow,
  onResult = () => {},
  isHidden = () => typeof document !== 'undefined' && document.hidden,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle),
  onVisibilityChange = null,
} = {}) {
  let handle = null;
  let running = false;
  /** True when a tick was skipped because the tab was hidden. */
  let missed = false;

  const stop = () => {
    if (handle !== null) clearTimer(handle);
    handle = null;
  };

  const schedule = () => {
    stop();
    if (!isEnabled()) return;
    handle = setTimer(tick, clampInterval(getIntervalMinutes()) * 60_000);
  };

  async function tick() {
    handle = null;

    if (!isEnabled()) return;

    // Hidden tabs do not poll. Remember that we skipped, so coming back is
    // worth an immediate look rather than another full interval of waiting.
    if (isHidden()) {
      missed = true;
      schedule();
      return;
    }

    // A tick that lands while the previous one is still in flight is dropped
    // rather than queued: two in-flight polls of the same page help nobody.
    if (running) {
      schedule();
      return;
    }

    running = true;
    try {
      const added = await checkNow();
      if (added > 0) onResult(added);
    } catch {
      // A failed poll is not worth surfacing - the next one is a minute away,
      // and the page you are reading is unaffected.
    } finally {
      running = false;
      schedule();
    }
  }

  /** A tab coming back to the front checks straight away if it missed one. */
  const handleVisible = () => {
    if (isHidden() || !isEnabled() || !missed) return;
    missed = false;
    stop();
    tick();
  };

  if (typeof onVisibilityChange === 'function') {
    onVisibilityChange('visibilitychange', handleVisible);
  }

  return {
    /** Begin, or re-read the settings after they changed. */
    start: schedule,
    stop,
    /** Force a check now, outside the rhythm. */
    checkNow: tick,
    isRunning: () => handle !== null,
  };
}
