import { useEffect, useMemo, useState } from 'react';
import {
  loadTime,
  onTimeChanged,
  startTimer,
  stopTimer,
  discardTimer,
  updateRunning,
  removeEntry,
  durationOf,
  formatDuration,
  formatHours,
  earnedOf,
  groupByDay,
  totalsByClient,
  todayMs,
  totalMs,
  toCsv,
  dayKey,
  MAX_LABEL,
  MAX_CLIENT,
} from '../core/time-tracker.js';
import { Button } from './fields.jsx';

function clockOf(at) {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "Today", "Yesterday", then the date - the way you would skim your own week. */
function dayLabel(day, now) {
  if (day === dayKey(now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === dayKey(yesterday)) return 'Yesterday';
  return new Date(`${day}T00:00:00`).toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Hand the reader a file without a server.
 *
 * A blob URL, clicked and revoked. Nothing leaves the machine: the whole point
 * of the free half of this extension is that your hours are yours.
 */
function download(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The time tracker.
 *
 * A stopwatch, a log, and a total per client. Deliberately not the paid
 * timesheet: nothing here syncs, invoices, or knows about a client record on
 * the server. It answers "how long did that actually take" - which is the
 * question you need answered before you can quote the next job honestly.
 *
 * The running entry ticks off a stored start instant, so closing the tab, or
 * the browser, does not lose the clock.
 */
export function TimeTracker() {
  const [state, setState] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [label, setLabel] = useState('');
  const [client, setClient] = useState('');
  const [rate, setRate] = useState('');

  useEffect(() => {
    loadTime().then(setState);
    return onTimeChanged(setState);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const days = useMemo(() => (state ? groupByDay(state.entries, now) : []), [state, now]);
  const clients = useMemo(() => (state ? totalsByClient(state.entries, now) : []), [state, now]);

  if (state === null) return <p className="loading">Loading...</p>;

  const { running, entries } = state;

  const start = () => {
    startTimer({ label, client, rateUsd: rate === '' ? null : Number(rate) }).then((next) => {
      setState(next);
      setLabel('');
    });
  };

  const known = [...new Set(entries.map((entry) => entry.client).filter(Boolean))];

  return (
    <div className="tracker-time">
      <section className={`time-now${running ? ' is-running' : ''}`}>
        {running ? (
          <>
            <div className="time-now-head">
              <strong className="time-elapsed">{formatDuration(durationOf(running, now))}</strong>
              <span className="time-since">since {clockOf(running.startedAt)}</span>
            </div>
            <input
              type="text"
              className="text-input"
              value={running.label}
              maxLength={MAX_LABEL}
              placeholder="What are you working on?"
              aria-label="What are you working on?"
              onChange={(event) => updateRunning({ label: event.target.value }).then(setState)}
            />
            <div className="time-row">
              <input
                type="text"
                className="text-input"
                value={running.client}
                maxLength={MAX_CLIENT}
                placeholder="Client"
                aria-label="Client"
                list="time-clients"
                onChange={(event) => updateRunning({ client: event.target.value }).then(setState)}
              />
              <input
                type="number"
                className="text-input time-rate"
                value={running.rateUsd ?? ''}
                min="0"
                step="0.5"
                placeholder="$/hr"
                aria-label="Hourly rate in USD"
                onChange={(event) =>
                  updateRunning({
                    rateUsd: event.target.value === '' ? null : Number(event.target.value),
                  }).then(setState)
                }
              />
            </div>
            <div className="time-actions">
              <Button variant="primary" onClick={() => stopTimer().then(setState)}>
                Stop
              </Button>
              <Button size="sm" variant="ghost" onClick={() => discardTimer().then(setState)}>
                Discard
              </Button>
              {running.rateUsd !== null ? (
                <span className="time-earned">
                  ${(earnedOf(running, now) ?? 0).toFixed(2)} so far
                </span>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <input
              type="text"
              className="text-input"
              value={label}
              maxLength={MAX_LABEL}
              placeholder="What are you working on?"
              aria-label="What are you working on?"
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') start();
              }}
            />
            <div className="time-row">
              <input
                type="text"
                className="text-input"
                value={client}
                maxLength={MAX_CLIENT}
                placeholder="Client"
                aria-label="Client"
                list="time-clients"
                onChange={(event) => setClient(event.target.value)}
              />
              <input
                type="number"
                className="text-input time-rate"
                value={rate}
                min="0"
                step="0.5"
                placeholder="$/hr"
                aria-label="Hourly rate in USD"
                onChange={(event) => setRate(event.target.value)}
              />
              <Button variant="primary" onClick={start}>
                Start
              </Button>
            </div>
          </>
        )}
        <datalist id="time-clients">
          {known.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </section>

      <div className="time-totals">
        <span>
          Today <strong>{formatHours(todayMs(entries, now))}</strong>
        </span>
        <span>
          All time <strong>{formatHours(totalMs(entries, now))}</strong>
        </span>
        {entries.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              download(toCsv(entries, { now }), 'oljextension-hours.csv', 'text/csv;charset=utf-8')
            }
          >
            ⤓ CSV
          </Button>
        ) : null}
      </div>

      {clients.some((row) => row.client) ? (
        <ul className="time-clients">
          {clients.map((row) => (
            <li key={row.client || '(none)'}>
              <span className="time-client-name">{row.client || 'Unlabelled'}</span>
              <span className="time-client-hours">{formatHours(row.ms)}</span>
              {row.hasRate ? (
                <span className="time-client-earned">${row.earned.toFixed(2)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {entries.length === 0 ? (
        <p className="empty">Nothing logged yet. Start the clock when you begin a task.</p>
      ) : (
        <div className="time-log">
          {days.map((day) => (
            <section key={day.day}>
              <h3 className="time-day">
                <span>{dayLabel(day.day, now)}</span>
                <span className="time-day-total">{formatHours(day.ms)}</span>
              </h3>
              <ul>
                {day.entries.map((entry) => (
                  <li key={entry.id} className="time-entry">
                    <span className="time-entry-label">{entry.label || 'Untitled'}</span>
                    {entry.client ? <span className="time-entry-client">{entry.client}</span> : null}
                    <span className="time-entry-span">
                      {clockOf(entry.startedAt)}–{entry.endedAt ? clockOf(entry.endedAt) : '…'}
                    </span>
                    <span className="time-entry-dur">{formatHours(durationOf(entry, now))}</span>
                    <button
                      type="button"
                      className="time-entry-remove"
                      aria-label={`Delete ${entry.label || 'entry'}`}
                      onClick={() => removeEntry(entry.id).then(setState)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
