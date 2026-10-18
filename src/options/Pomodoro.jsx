import { useEffect, useRef, useState } from 'react';
import {
  loadPomodoro,
  onPomodoroChanged,
  updatePomodoro,
  savePomodoroConfig,
  PHASES,
  LIMITS,
  startPhase,
  pause,
  resume,
  advance,
  remainingMs,
  isElapsed,
  isRunning,
  isPaused,
  formatRemaining,
  phaseLength,
  today,
  recentDays,
  MAX_TASK,
} from '../core/pomodoro.js';
import { Button, NumberField, ToggleField } from './fields.jsx';

const PHASE_LABELS = {
  [PHASES.IDLE]: 'Ready',
  [PHASES.FOCUS]: 'Focus',
  [PHASES.SHORT]: 'Short break',
  [PHASES.LONG]: 'Long break',
};

/**
 * A short two-tone beep, made on the spot.
 *
 * A bundled sound file would be a second packaged asset and a licence question
 * for the sake of half a second of noise. WebAudio can do it in a dozen lines,
 * and it fails silently when the tab has never been interacted with - which is
 * the correct behaviour anyway.
 */
function chime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.7);
    gain.connect(ctx.destination);
    for (const [at, hz] of [
      [0, 660],
      [0.22, 880],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = hz;
      osc.connect(gain);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.2);
    }
    setTimeout(() => ctx.close(), 1200);
  } catch {
    // No audio device, or a policy that forbids it. Not worth reporting.
  }
}

/**
 * A desktop notification, if we are already allowed one.
 *
 * Best-effort and never asked for up front: the timer works without it, and
 * being prompted for notification permission by a job board is exactly the
 * sort of thing that gets an extension uninstalled.
 */
function notify(title, body) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification(title, { body, silent: true });
  } catch {
    // Notifications unavailable in this context.
  }
}

/**
 * The pomodoro.
 *
 * The countdown is derived from a stored end instant every tick rather than
 * decremented, so it is right after a reload, a sleep, or a tab that was
 * throttled in the background for ten minutes. That last one is the case a
 * setInterval-based timer always gets wrong.
 *
 * When a phase runs out, exactly one write must make the transition - two
 * would log the session twice. The write goes through updatePomodoro, whose
 * queue serialises it, and the ref below stops this component from firing the
 * same transition again while that write is still in flight.
 */
export function Pomodoro() {
  const [state, setState] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [showSettings, setShowSettings] = useState(false);
  const advancing = useRef(false);

  useEffect(() => {
    loadPomodoro().then(setState);
    return onPomodoroChanged(setState);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!state || advancing.current) return;
    if (!isElapsed(state.run, now)) return;
    advancing.current = true;
    const wasFocus = state.run.phase === PHASES.FOCUS;
    const shouldChime = state.config.chime;
    updatePomodoro((current) => {
      const next = advance(current, Date.now());
      return { ...current, run: next.run, log: next.log };
    })
      .then((next) => {
        setState(next);
        if (shouldChime) chime();
        if (wasFocus) notify('Focus session done', 'Take a break.');
        else notify('Break over', 'Back to it.');
      })
      .finally(() => {
        advancing.current = false;
      });
  }, [state, now]);

  if (state === null) return <p className="loading">Loading...</p>;

  const { run, config, log } = state;
  const left = remainingMs(run, now);
  const total = phaseLength(run.phase, config);
  const done = today(log, now);
  const week = recentDays(log, 7, now);
  const peak = Math.max(1, ...week.map((day) => day.focusCount));

  const set = (patch) => savePomodoroConfig({ ...config, ...patch }).then(setState);
  const go = (phase) =>
    updatePomodoro((current) => ({
      ...current,
      run: startPhase(phase, current.config, current.run, Date.now()),
    })).then(setState);

  const stop = () =>
    updatePomodoro((current) => ({
      ...current,
      run: { ...current.run, phase: PHASES.IDLE, startedAt: null, endsAt: null, pausedAt: null },
    })).then(setState);

  const setTask = (task) =>
    updatePomodoro((current) => ({
      ...current,
      run: { ...current.run, task: task.slice(0, MAX_TASK) },
    })).then(setState);

  // A ring rather than a bar: it reads as a timer at a glance, and it fits the
  // small size the shell gives this widget.
  const progress = total > 0 ? 1 - left / total : 0;
  const CIRCUM = 2 * Math.PI * 52;

  return (
    <div className={`pomodoro phase-${run.phase}`}>
      <div className="pomo-dial">
        <svg viewBox="0 0 120 120" className="pomo-ring" aria-hidden="true">
          <circle className="pomo-track" cx="60" cy="60" r="52" />
          <circle
            className="pomo-fill"
            cx="60"
            cy="60"
            r="52"
            style={{ strokeDasharray: CIRCUM, strokeDashoffset: CIRCUM * (1 - progress) }}
          />
        </svg>
        <div className="pomo-readout">
          <span className="pomo-phase">{PHASE_LABELS[run.phase]}</span>
          <strong className="pomo-time">
            {formatRemaining(run.phase === PHASES.IDLE ? phaseLength(PHASES.FOCUS, config) : left)}
          </strong>
          <span className="pomo-cycle">
            {run.cycle % config.longEvery}/{config.longEvery} to a long break
          </span>
        </div>
      </div>

      <input
        type="text"
        className="text-input pomo-task"
        value={run.task}
        maxLength={MAX_TASK}
        placeholder="What are you working on?"
        aria-label="What are you working on?"
        onChange={(event) => setTask(event.target.value)}
      />

      <div className="pomo-controls">
        {run.phase === PHASES.IDLE ? (
          <>
            <Button variant="primary" onClick={() => go(PHASES.FOCUS)}>
              Start focus
            </Button>
            <Button size="sm" variant="ghost" onClick={() => go(PHASES.SHORT)}>
              Short break
            </Button>
            <Button size="sm" variant="ghost" onClick={() => go(PHASES.LONG)}>
              Long break
            </Button>
          </>
        ) : (
          <>
            {isRunning(run) ? (
              <Button
                variant="primary"
                onClick={() =>
                  updatePomodoro((c) => ({ ...c, run: pause(c.run, Date.now()) })).then(setState)
                }
              >
                Pause
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() =>
                  updatePomodoro((c) => ({ ...c, run: resume(c.run, Date.now()) })).then(setState)
                }
              >
                Resume
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={stop}>
              Stop
            </Button>
          </>
        )}
      </div>

      <p className="pomo-today">
        <strong>{done.focusCount}</strong> {done.focusCount === 1 ? 'session' : 'sessions'} today ·{' '}
        {done.focusMinutes} min
        {isPaused(run) ? <span className="pomo-paused"> · paused</span> : null}
      </p>

      <ol className="pomo-week" aria-label="Focus sessions this week">
        {week.map((day) => (
          <li key={day.day} title={`${day.day}: ${day.focusCount} sessions`}>
            <span
              className="pomo-bar"
              style={{ height: `${Math.round((day.focusCount / peak) * 100)}%` }}
            />
            <span className="pomo-bar-day">{day.day.slice(8)}</span>
          </li>
        ))}
      </ol>

      <button
        type="button"
        className="pomo-settings-toggle"
        onClick={() => setShowSettings((open) => !open)}
      >
        {showSettings ? 'Hide settings' : 'Settings'}
      </button>

      {showSettings ? (
        <div className="pomo-settings">
          <NumberField
            label="Focus"
            value={config.focusMinutes}
            min={LIMITS.focusMinutes.min}
            max={LIMITS.focusMinutes.max}
            suffix="min"
            onChange={(focusMinutes) => set({ focusMinutes })}
          />
          <NumberField
            label="Short break"
            value={config.shortMinutes}
            min={LIMITS.shortMinutes.min}
            max={LIMITS.shortMinutes.max}
            suffix="min"
            onChange={(shortMinutes) => set({ shortMinutes })}
          />
          <NumberField
            label="Long break"
            value={config.longMinutes}
            min={LIMITS.longMinutes.min}
            max={LIMITS.longMinutes.max}
            suffix="min"
            onChange={(longMinutes) => set({ longMinutes })}
          />
          <NumberField
            label="Long break every"
            hint="How many focus sessions before the long one."
            value={config.longEvery}
            min={LIMITS.longEvery.min}
            max={LIMITS.longEvery.max}
            suffix="sessions"
            onChange={(longEvery) => set({ longEvery })}
          />
          <ToggleField
            label="Start breaks automatically"
            checked={config.autoStartBreaks}
            onChange={(autoStartBreaks) => set({ autoStartBreaks })}
          />
          <ToggleField
            label="Start the next focus automatically"
            hint="Off by default — a break you have to end yourself is a break you actually take."
            checked={config.autoStartFocus}
            onChange={(autoStartFocus) => set({ autoStartFocus })}
          />
          <ToggleField
            label="Chime when a phase ends"
            checked={config.chime}
            onChange={(on) => set({ chime: on })}
          />
        </div>
      ) : null}
    </div>
  );
}
