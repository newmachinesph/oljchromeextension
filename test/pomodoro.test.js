import { describe, it, expect } from 'vitest';
import {
  PHASES,
  DEFAULT_CONFIG,
  MAX_LOG_DAYS,
  sanitizeConfig,
  sanitizeRun,
  sanitizeLog,
  sanitizeState,
  phaseLength,
  remainingMs,
  isPaused,
  isRunning,
  isElapsed,
  formatRemaining,
  startPhase,
  pause,
  resume,
  nextPhase,
  advance,
  record,
  today,
  recentDays,
  dayKey,
} from '../src/core/pomodoro.js';

const T0 = Date.parse('2026-08-23T09:00:00');
const MIN = 60_000;

describe('sanitizeConfig', () => {
  it('fills in the defaults', () => {
    expect(sanitizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(sanitizeConfig({}).focusMinutes).toBe(25);
  });

  it('holds every length inside a sane range', () => {
    expect(sanitizeConfig({ focusMinutes: 0 }).focusMinutes).toBe(1);
    expect(sanitizeConfig({ focusMinutes: 9999 }).focusMinutes).toBe(180);
    expect(sanitizeConfig({ longEvery: 1 }).longEvery).toBe(2);
    expect(sanitizeConfig({ shortMinutes: 'x' }).shortMinutes).toBe(5);
  });

  it('rounds rather than storing a fraction of a minute', () => {
    expect(sanitizeConfig({ focusMinutes: 24.6 }).focusMinutes).toBe(25);
  });

  it('defaults the two auto-starts differently, on purpose', () => {
    // Breaks start themselves; the next focus does not. A break you have to end
    // yourself is a break you actually take.
    expect(sanitizeConfig({}).autoStartBreaks).toBe(true);
    expect(sanitizeConfig({}).autoStartFocus).toBe(false);
  });
});

describe('sanitizeRun', () => {
  it('turns anything unrecognised into idle', () => {
    expect(sanitizeRun(null).phase).toBe(PHASES.IDLE);
    expect(sanitizeRun({ phase: 'lunch' }).phase).toBe(PHASES.IDLE);
  });

  it('keeps the cycle across an idle stretch', () => {
    // Otherwise a break you took by hand would reset your progress towards the
    // long one, which is the count people actually care about.
    expect(sanitizeRun({ phase: 'idle', cycle: 3 }).cycle).toBe(3);
  });

  it('refuses a non-numeric instant rather than rendering NaN', () => {
    expect(sanitizeRun({ phase: 'focus', endsAt: 'soon' }).endsAt).toBeNull();
  });

  it('trims a task down to one line', () => {
    expect(sanitizeRun({ phase: 'focus', task: '  cover \n letter  ' }).task).toBe('cover letter');
  });
});

describe('remainingMs', () => {
  it('counts down from the stored end, not from a counter', () => {
    const run = startPhase(PHASES.FOCUS, DEFAULT_CONFIG, undefined, T0);
    expect(remainingMs(run, T0)).toBe(25 * MIN);
    expect(remainingMs(run, T0 + 10 * MIN)).toBe(15 * MIN);
  });

  it('never goes below zero, however late the tab wakes up', () => {
    // The case a setInterval always gets wrong: a background tab throttled for
    // an hour comes back to a finished session, not a negative one.
    const run = startPhase(PHASES.FOCUS, DEFAULT_CONFIG, undefined, T0);
    expect(remainingMs(run, T0 + 60 * MIN)).toBe(0);
  });

  it('is zero when nothing is running', () => {
    expect(remainingMs(null, T0)).toBe(0);
  });
});

describe('pause and resume', () => {
  it('freezes the countdown while paused', () => {
    const run = startPhase(PHASES.FOCUS, DEFAULT_CONFIG, undefined, T0);
    const held = pause(run, T0 + 5 * MIN);
    expect(isPaused(held)).toBe(true);
    expect(isRunning(held)).toBe(false);
    expect(remainingMs(held, T0 + 5 * MIN)).toBe(20 * MIN);
    // Ten minutes later, still twenty on the clock.
    expect(remainingMs(held, T0 + 15 * MIN)).toBe(20 * MIN);
  });

  it('gives back exactly the time the pause took', () => {
    const run = startPhase(PHASES.FOCUS, DEFAULT_CONFIG, undefined, T0);
    const held = pause(run, T0 + 5 * MIN);
    const going = resume(held, T0 + 12 * MIN);
    expect(remainingMs(going, T0 + 12 * MIN)).toBe(20 * MIN);
    expect(isRunning(going)).toBe(true);
  });

  it('ignores a second pause and a resume that was never paused', () => {
    const run = startPhase(PHASES.FOCUS, DEFAULT_CONFIG, undefined, T0);
    expect(pause(pause(run, T0 + MIN), T0 + 2 * MIN).pausedAt).toBe(T0 + MIN);
    expect(resume(run, T0 + MIN)).toEqual(run);
  });

  it('will not pause an idle timer', () => {
    expect(pause(null, T0).phase).toBe(PHASES.IDLE);
  });
});

describe('nextPhase', () => {
  it('follows focus with a short break, most of the time', () => {
    expect(nextPhase({ phase: PHASES.FOCUS, cycle: 0 }, DEFAULT_CONFIG)).toBe(PHASES.SHORT);
    expect(nextPhase({ phase: PHASES.FOCUS, cycle: 2 }, DEFAULT_CONFIG)).toBe(PHASES.SHORT);
  });

  it('follows the fourth focus with the long one', () => {
    expect(nextPhase({ phase: PHASES.FOCUS, cycle: 3 }, DEFAULT_CONFIG)).toBe(PHASES.LONG);
  });

  it('respects a different cycle length', () => {
    const config = { ...DEFAULT_CONFIG, longEvery: 2 };
    expect(nextPhase({ phase: PHASES.FOCUS, cycle: 1 }, config)).toBe(PHASES.LONG);
  });

  it('always follows a break with focus', () => {
    expect(nextPhase({ phase: PHASES.SHORT, cycle: 1 }, DEFAULT_CONFIG)).toBe(PHASES.FOCUS);
    expect(nextPhase({ phase: PHASES.LONG, cycle: 4 }, DEFAULT_CONFIG)).toBe(PHASES.FOCUS);
  });
});

describe('advance', () => {
  const state = (over = {}) => ({
    config: { ...DEFAULT_CONFIG, ...over.config },
    run: over.run ?? startPhase(PHASES.FOCUS, DEFAULT_CONFIG, undefined, T0),
    log: over.log ?? [],
  });

  it('starts the break by itself, since breaks auto-start', () => {
    const { run } = advance(state(), T0 + 25 * MIN);
    expect(run.phase).toBe(PHASES.SHORT);
    expect(run.cycle).toBe(1);
  });

  it('parks on idle after a break, since the next focus does not', () => {
    const run = startPhase(PHASES.SHORT, DEFAULT_CONFIG, { cycle: 1 }, T0);
    const next = advance(state({ run }), T0 + 5 * MIN);
    expect(next.run.phase).toBe(PHASES.IDLE);
    expect(next.run.cycle).toBe(1);
  });

  it('logs the minutes actually spent, not the minutes planned', () => {
    // A session you cut short at eighteen minutes was eighteen minutes of work.
    const { log } = advance(state(), T0 + 18 * MIN);
    expect(log[0].focusMinutes).toBe(18);
    expect(log[0].focusCount).toBe(1);
  });

  it('does not log a break', () => {
    const run = startPhase(PHASES.SHORT, DEFAULT_CONFIG, undefined, T0);
    expect(advance(state({ run }), T0 + 5 * MIN).log).toEqual([]);
  });

  it('says whether a focus session was what finished', () => {
    expect(advance(state(), T0 + 25 * MIN).completedFocus).toBe(true);
    const run = startPhase(PHASES.LONG, DEFAULT_CONFIG, undefined, T0);
    expect(advance(state({ run }), T0 + 15 * MIN).completedFocus).toBe(false);
  });

  it('has nothing to advance when idle', () => {
    const next = advance(state({ run: { phase: PHASES.IDLE } }), T0);
    expect(next.run.phase).toBe(PHASES.IDLE);
    expect(next.completedFocus).toBe(false);
  });

  it('reaches the long break on the fourth session', () => {
    let current = state();
    for (let session = 1; session <= 4; session += 1) {
      const done = advance(
        { ...current, run: startPhase(PHASES.FOCUS, current.config, current.run, T0) },
        T0 + 25 * MIN,
      );
      current = { ...current, run: done.run, log: done.log };
      expect(current.run.phase).toBe(session === 4 ? PHASES.LONG : PHASES.SHORT);
      // The break auto-started, so end it before the next focus.
      const after = advance(current, T0 + 30 * MIN);
      current = { ...current, run: after.run, log: after.log };
    }
    expect(current.log[0].focusCount).toBe(4);
  });
});

describe('the log', () => {
  it('adds to today rather than starting a second row', () => {
    const once = record([], 25, T0);
    const twice = record(once, 20, T0 + 40 * MIN);
    expect(twice).toHaveLength(1);
    expect(twice[0]).toMatchObject({ focusCount: 2, focusMinutes: 45 });
  });

  it('merges a duplicate day that reached storage somehow', () => {
    const merged = sanitizeLog([
      { day: '2026-08-23', focusCount: 2, focusMinutes: 50 },
      { day: '2026-08-23', focusCount: 1, focusMinutes: 25 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ focusCount: 3, focusMinutes: 75 });
  });

  it('throws away a row that is not a day', () => {
    expect(sanitizeLog([{ day: 'yesterday', focusCount: 1 }])).toEqual([]);
    expect(sanitizeLog('nope')).toEqual([]);
  });

  it('keeps a quarter and no more', () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({
      day: dayKey(T0 - index * 86_400_000),
      focusCount: 1,
      focusMinutes: 25,
    }));
    expect(sanitizeLog(rows)).toHaveLength(MAX_LOG_DAYS);
  });

  it('gives a zeroed row for a day with nothing in it', () => {
    expect(today([], T0)).toMatchObject({ focusCount: 0, focusMinutes: 0 });
  });

  it('fills the gaps when showing a week', () => {
    const week = recentDays(record([], 25, T0), 7, T0);
    expect(week).toHaveLength(7);
    // Oldest first, today last - the direction a bar chart is read.
    expect(week[6].focusCount).toBe(1);
    expect(week[0].focusCount).toBe(0);
  });
});

describe('formatRemaining', () => {
  it('reads as a timer', () => {
    expect(formatRemaining(25 * MIN)).toBe('25:00');
    expect(formatRemaining(65_000)).toBe('1:05');
    expect(formatRemaining(9_000)).toBe('0:09');
  });

  it('adds the hour only when there is one', () => {
    expect(formatRemaining(3_600_000)).toBe('1:00:00');
    expect(formatRemaining(3_725_000)).toBe('1:02:05');
  });

  it('never shows a negative', () => {
    expect(formatRemaining(-5000)).toBe('0:00');
    expect(formatRemaining('x')).toBe('0:00');
  });
});

describe('the whole state', () => {
  it('survives a round trip through nothing', () => {
    const clean = sanitizeState(null);
    expect(clean.config).toEqual(DEFAULT_CONFIG);
    expect(clean.run.phase).toBe(PHASES.IDLE);
    expect(clean.log).toEqual([]);
  });

  it('knows a phase has run out', () => {
    const run = startPhase(PHASES.FOCUS, DEFAULT_CONFIG, undefined, T0);
    expect(isElapsed(run, T0 + 24 * MIN)).toBe(false);
    expect(isElapsed(run, T0 + 25 * MIN)).toBe(true);
    expect(isElapsed({ phase: PHASES.IDLE }, T0)).toBe(false);
  });

  it('measures a phase from the config', () => {
    expect(phaseLength(PHASES.FOCUS, { focusMinutes: 50 })).toBe(50 * MIN);
    expect(phaseLength(PHASES.IDLE, DEFAULT_CONFIG)).toBe(0);
  });
});
