import { useEffect, useMemo, useState } from 'react';
import {
  loadClocks,
  onClocksChanged,
  saveClock,
  removeClock,
  moveClock,
  readClock,
  localZone,
  zoneCity,
  overlapHours,
  COMMON_ZONES,
  MAX_CLOCKS,
} from '../core/clocks.js';
import { Button } from './fields.jsx';

/** 14:00 reads as "2pm" - the way you would say it out loud in a message. */
function hourLabel(hour) {
  const wrapped = ((hour % 24) + 24) % 24;
  const suffix = wrapped < 12 ? 'am' : 'pm';
  const twelve = wrapped % 12 === 0 ? 12 : wrapped % 12;
  return `${twelve}${suffix}`;
}

function dayNote(delta) {
  if (delta < 0) return 'yesterday';
  if (delta > 0) return 'tomorrow';
  return '';
}

/**
 * World clocks.
 *
 * The face is deliberately plain - a time, a day, an offset. What earns its
 * place is the line underneath: the hours where your working day and theirs
 * actually overlap, in your own time, so "I can do 9 to 11am your time" is
 * something you can say without opening a converter.
 *
 * Re-renders once a second. That is cheap for a handful of cached Intl
 * formats, and a clock that only updates on the minute looks broken for the
 * fifty-nine seconds it spends being wrong.
 */
export function Clocks() {
  const [clocks, setClocks] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [hour12, setHour12] = useState(true);
  const [adding, setAdding] = useState('');

  useEffect(() => {
    loadClocks().then(setClocks);
    return onClocksChanged(setClocks);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const here = useMemo(() => localZone(), []);

  if (clocks === null) return <p className="loading">Loading...</p>;

  const taken = new Set(clocks.map((clock) => clock.timeZone));
  const choices = COMMON_ZONES.filter((zone) => !taken.has(zone.timeZone));

  const add = (timeZone) => {
    if (!timeZone) return;
    setAdding('');
    saveClock({ timeZone, label: zoneCity(timeZone) }).then(setClocks);
  };

  return (
    <div className="clocks">
      <div className="clocks-bar">
        <span className="clocks-here">
          Your zone: <strong>{here}</strong>
        </span>
        <label className="clocks-toggle">
          <input type="checkbox" checked={!hour12} onChange={() => setHour12((on) => !on)} />
          <span>24-hour</span>
        </label>
      </div>

      <ul className="clock-grid">
        {clocks.map((clock, index) => {
          const face = readClock(clock.timeZone, now, { hour12, from: here });
          if (!face) return null;
          const overlap = overlapHours(here, clock.timeZone, { at: now });
          const note = dayNote(face.dayDelta);
          return (
            <li key={clock.id} className={`clock-card${face.isNight ? ' is-night' : ''}`}>
              <div className="clock-top">
                <span className="clock-label">{clock.label}</span>
                <span className="clock-offset">{face.offsetLabel}</span>
              </div>
              <p className="clock-time">{face.time}</p>
              <p className="clock-day">
                {face.weekday} {face.day}
                {note ? <span className="clock-delta"> · {note}</span> : null}
              </p>
              <p className="clock-overlap">
                {clock.timeZone === here ? (
                  'This is you'
                ) : overlap.length === 0 ? (
                  'No 9–6 overlap'
                ) : (
                  <>
                    Overlap {hourLabel(overlap[0].hourHere)}–
                    {hourLabel(overlap[overlap.length - 1].hourHere + 1)} your time
                  </>
                )}
              </p>
              <div className="clock-actions">
                <button
                  type="button"
                  className="clock-move"
                  aria-label={`Move ${clock.label} earlier in the list`}
                  disabled={index === 0}
                  onClick={() => moveClock(clock.id, -1).then(setClocks)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="clock-move"
                  aria-label={`Move ${clock.label} later in the list`}
                  disabled={index === clocks.length - 1}
                  onClick={() => moveClock(clock.id, 1).then(setClocks)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="clock-remove"
                  onClick={() => removeClock(clock.id).then(setClocks)}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {clocks.length === 0 ? (
        <p className="empty">No clocks yet. Add the zone your employer works in.</p>
      ) : null}

      {clocks.length < MAX_CLOCKS ? (
        <div className="clocks-add">
          <select
            className="text-input"
            value={adding}
            aria-label="Add a timezone"
            onChange={(event) => add(event.target.value)}
          >
            <option value="">Add a city…</option>
            {choices.map((zone) => (
              <option key={zone.timeZone} value={zone.timeZone}>
                {zone.label}
              </option>
            ))}
          </select>
          {!taken.has(here) ? (
            <Button size="sm" variant="ghost" onClick={() => add(here)}>
              Add my zone
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="field-hint">That is {MAX_CLOCKS} clocks — remove one to add another.</p>
      )}
    </div>
  );
}
