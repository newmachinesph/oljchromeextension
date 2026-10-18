import { useEffect, useState } from 'react';
import { loadBook, setBlocked, setNote, onBookChanged } from '../core/employer-book.js';

/**
 * The employers you have blocked or written about, and the way to undo either.
 *
 * Its own component for the same reason DismissedCount is: the book lives in
 * chrome.storage.local rather than in settings - it is a record of decisions,
 * not a preference. Blocking and noting happen in the job modal, where the
 * employer is in front of you; this is where you come to take one back.
 */
export function BlockedEmployers() {
  const [book, setBook] = useState(null);

  useEffect(() => {
    loadBook().then(setBook);
    return onBookChanged(setBook);
  }, []);

  if (book === null) return null;

  const entries = [...book.values()]
    .filter((entry) => entry.blocked || entry.note)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (entries.length === 0) {
    return (
      <div className="field">
        <p className="field-hint">
          No employers blocked or noted yet. Both are done from a job's details, where the
          employer is named.
        </p>
      </div>
    );
  }

  return (
    <div className="field">
      <ul className="employer-list">
        {entries.map((entry) => (
          <li key={entry.name || `#${entry.id}`} className="employer-row">
            <span className="employer-name">
              {entry.name || `Employer #${entry.id} (name not given)`}
            </span>
            {entry.blocked && <span className="employer-tag">blocked</span>}
            {entry.note && <span className="employer-note">{entry.note}</span>}
            <span className="employer-actions">
              {entry.blocked && (
                <button
                  type="button"
                  className="reset"
                  onClick={() => setBlocked({ name: entry.name, id: entry.id }, false).then(setBook)}
                >
                  Unblock
                </button>
              )}
              {entry.note && (
                <button
                  type="button"
                  className="reset"
                  onClick={() => setNote({ name: entry.name, id: entry.id }, '').then(setBook)}
                >
                  Clear note
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
