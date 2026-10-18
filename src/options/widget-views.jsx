import { useEffect } from 'react';
import { Applications } from './Applications.jsx';
import { SavedJobs } from './SavedJobs.jsx';
import { Snippets } from './Snippets.jsx';
import { SalaryCalculator } from './SalaryCalculator.jsx';
import { TimeTracker } from './TimeTracker.jsx';
import { Pomodoro } from './Pomodoro.jsx';
import { Clocks } from './Clocks.jsx';

/**
 * Which component answers which `?view=` - and nothing else.
 *
 * One build, many faces: the same bundle is the settings page in a tab and,
 * with a `view` in the query, a single mini app framed inside the content
 * script's modal. This table is the whole routing layer. A new widget is a
 * component, a line here, and an entry in core/dock.js; no modal, no launcher
 * and no plumbing of its own.
 *
 * Keys must match the widget ids in core/dock.js. The dock only ever asks for
 * ids it has, but a stale frame from a previous version might not - so an
 * unknown key falls back to the full settings page rather than a blank screen.
 */
export const VIEWS = {
  board: Applications,
  saved: SavedJobs,
  snippets: Snippets,
  calculator: SalaryCalculator,
  timer: TimeTracker,
  pomodoro: Pomodoro,
  clocks: Clocks,
};

export function hasView(id) {
  return Object.hasOwn(VIEWS, String(id ?? ''));
}

/**
 * One mini app, filling the frame.
 *
 * The frame is cross-origin from the job site around it, so an Escape keypress
 * inside here never reaches the shell that drew the modal. We forward it up as
 * a message instead - unless a field is being edited, which gets to cancel
 * itself first, because losing a half-typed note to a stray Escape is worse
 * than having to press it twice.
 */
export function WidgetView({ id }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      const el = document.activeElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      window.parent.postMessage({ type: 'ojrf-widget-close' }, '*');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const View = VIEWS[id];
  if (!View) return null;

  // `board-view` is kept for the board alone: a good deal of the stylesheet
  // hangs off it, and renaming it here would be a cosmetic change with a
  // hundred-line diff behind it.
  const className = `app widget-view view-${id}${id === 'board' ? ' board-view' : ''}`;
  return (
    <main className={className}>
      <View />
    </main>
  );
}
