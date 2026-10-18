import { describe, it, expect, vi } from 'vitest';
import { createAutoRefresh, clampInterval } from '../src/content/auto-refresh.js';
import { REFRESH_INTERVALS, isRefreshInterval } from '../src/core/settings.js';

/**
 * A hand-cranked clock. createAutoRefresh takes its timer in, so a test can
 * step time forward rather than sleep through five real minutes.
 */
function fakeClock() {
  let pending = null;
  let nextId = 1;
  return {
    setTimer(fn, ms) {
      pending = { fn, ms, id: (nextId += 1) };
      return pending.id;
    },
    clearTimer(id) {
      if (pending?.id === id) pending = null;
    },
    delay: () => pending?.ms ?? null,
    /** Fire the scheduled callback, as the browser eventually would. */
    async fire() {
      const job = pending;
      pending = null;
      if (job) await job.fn();
    },
    isScheduled: () => pending !== null,
  };
}

const base = (clock, over = {}) => ({
  isEnabled: () => true,
  getIntervalMinutes: () => 5,
  checkNow: async () => 0,
  isHidden: () => false,
  setTimer: clock.setTimer,
  clearTimer: clock.clearTimer,
  ...over,
});

describe('clampInterval', () => {
  it('holds the supported range', () => {
    expect(clampInterval(0)).toBe(1);
    expect(clampInterval(5)).toBe(5);
    expect(clampInterval(999)).toBe(60);
  });

  it('falls back to the default for nonsense', () => {
    expect(clampInterval('soon')).toBe(5);
    expect(clampInterval(undefined)).toBe(5);
  });

  it('rounds fractions', () => {
    expect(clampInterval(4.4)).toBe(4);
  });
});

describe('REFRESH_INTERVALS', () => {
  it('offers 5 minutes, and that is the documented default', () => {
    expect(REFRESH_INTERVALS.map((e) => e.value)).toContain(5);
    expect(isRefreshInterval(5)).toBe(true);
  });

  it('rejects a value that is not on the list', () => {
    expect(isRefreshInterval(7)).toBe(false);
  });
});

describe('createAutoRefresh', () => {
  it('schedules at the configured interval', () => {
    const clock = fakeClock();
    createAutoRefresh(base(clock, { getIntervalMinutes: () => 3 })).start();
    expect(clock.delay()).toBe(3 * 60_000);
  });

  it('does not schedule at all when disabled', () => {
    const clock = fakeClock();
    createAutoRefresh(base(clock, { isEnabled: () => false })).start();
    expect(clock.isScheduled()).toBe(false);
  });

  it('checks, reports what arrived, and re-arms', async () => {
    const clock = fakeClock();
    const onResult = vi.fn();
    createAutoRefresh(base(clock, { checkNow: async () => 2, onResult })).start();

    await clock.fire();

    expect(onResult).toHaveBeenCalledWith(2);
    expect(clock.isScheduled()).toBe(true);
  });

  it('stays quiet when nothing new arrived', async () => {
    const clock = fakeClock();
    const onResult = vi.fn();
    createAutoRefresh(base(clock, { checkNow: async () => 0, onResult })).start();

    await clock.fire();

    expect(onResult).not.toHaveBeenCalled();
  });

  it('does not fetch while the tab is hidden, but keeps the rhythm', async () => {
    const clock = fakeClock();
    const checkNow = vi.fn(async () => 1);
    createAutoRefresh(base(clock, { isHidden: () => true, checkNow })).start();

    await clock.fire();

    expect(checkNow).not.toHaveBeenCalled();
    expect(clock.isScheduled()).toBe(true);
  });

  it('re-arms after a failed check rather than dying', async () => {
    const clock = fakeClock();
    const checkNow = vi.fn(async () => {
      throw new Error('network');
    });
    const onResult = vi.fn();
    createAutoRefresh(base(clock, { checkNow, onResult })).start();

    await clock.fire();

    expect(checkNow).toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
    expect(clock.isScheduled()).toBe(true);
  });

  it('stops when the setting is turned off between ticks', async () => {
    const clock = fakeClock();
    let on = true;
    const checkNow = vi.fn(async () => 1);
    createAutoRefresh(base(clock, { isEnabled: () => on, checkNow })).start();

    on = false;
    await clock.fire();

    expect(checkNow).not.toHaveBeenCalled();
    expect(clock.isScheduled()).toBe(false);
  });

  it('stop() cancels a pending check', () => {
    const clock = fakeClock();
    const poller = createAutoRefresh(base(clock));
    poller.start();
    poller.stop();
    expect(clock.isScheduled()).toBe(false);
  });

  it('picks up a changed interval on restart', () => {
    const clock = fakeClock();
    let minutes = 5;
    const poller = createAutoRefresh(base(clock, { getIntervalMinutes: () => minutes }));
    poller.start();
    expect(clock.delay()).toBe(5 * 60_000);

    minutes = 15;
    poller.start();
    expect(clock.delay()).toBe(15 * 60_000);
  });
});
