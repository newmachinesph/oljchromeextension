import { useEffect, useState } from 'react';
import { ToggleField, RadioField } from './fields.jsx';
import { loadSearches, onSearchesChanged, nameKey } from '../core/saved-searches.js';
import {
  ALERT_INTERVALS,
  MAX_WATCHED,
  watchedSearches,
  loadAlertState,
  onAlertStateChanged,
  clearAlertState,
} from '../core/alerts.js';

const PERMISSIONS = {
  permissions: ['alarms', 'notifications'],
  origins: ['https://www.onlinejobs.ph/*'],
};

function when(epochMs) {
  if (!Number.isFinite(epochMs)) return 'never';
  return new Date(epochMs).toLocaleString();
}

/**
 * Alerts for saved searches: the switch, how often, and what is watched.
 *
 * The switch is the one place in the extension that asks the browser for a
 * permission. It asks at the moment of turning on, for exactly the three things
 * the feature needs - a timer, the right to fetch the site's search pages while
 * no tab is open, and leave to say what it found - and if the reader declines,
 * the switch stays off. Nothing is requested at install time.
 */
export function Alerts({ settings, update }) {
  const [searches, setSearches] = useState([]);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    loadSearches().then(setSearches);
    loadAlertState().then(setState);
    const offSearches = onSearchesChanged(setSearches);
    const offState = onAlertStateChanged(setState);
    return () => {
      offSearches();
      offState();
    };
  }, []);

  const watched = watchedSearches(searches);
  const withTerms = searches.filter((s) => (s.filters?.searchKeywords?.length ?? 0) > 0).length;
  const skipped = withTerms - watched.length;

  async function toggle(on) {
    setNote('');
    if (!on) {
      await update({ alertsEnabled: false });
      await clearAlertState();
      // The permissions stay granted; revoking them here would make turning
      // alerts back on ask again, and the browser's own UI can remove them.
      return;
    }

    setBusy(true);
    try {
      const granted = await chrome.permissions.request(PERMISSIONS);
      if (!granted) {
        setNote('Not turned on: the permission was declined.');
        return;
      }
      await update({ alertsEnabled: true });
    } catch (error) {
      setNote(`Could not ask for the permission: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function checkNow() {
    setBusy(true);
    setNote('Checking…');
    try {
      await chrome.runtime.sendMessage({ type: 'check-alerts-now' });
      setState(await loadAlertState());
      setNote('Checked.');
    } catch (error) {
      setNote(`Could not check: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  function statusOf(search) {
    const entry = state?.bySearch?.[nameKey(search.name)];
    if (entry?.lastError) return `failed: ${entry.lastError}`;
    if (entry?.newCount) return `${entry.newCount} new`;
    if (entry?.checkedAt) return 'nothing new';
    return 'not checked yet';
  }

  return (
    <>
      <ToggleField
        label="Tell me when a saved search has new listings"
        hint={`Off by default. On, the extension re-runs the first page of each saved search that has keywords (up to ${MAX_WATCHED}, by name) while you are away, counts listings it has not seen before, and shows the count on the toolbar icon and in the popup. Turning this on asks the browser for three permissions it otherwise never holds: a timer, fetching onlinejobs.ph search pages without a tab open, and leave to show a notification when it finds something. It counts new listings for the keywords - it cannot apply your rate floor without a page, which the page does the moment you open it.`}
        checked={settings.alertsEnabled}
        onChange={toggle}
      />

      {settings.alertsEnabled && (
        <>
          <RadioField
            label="How often"
            hint="One request per keyword per check, one after another. The gentler the better: this runs unattended."
            name="alertIntervalMinutes"
            value={settings.alertIntervalMinutes}
            options={ALERT_INTERVALS}
            onChange={(value) => update({ alertIntervalMinutes: value })}
          />

          <div className="field">
            <span className="field-label">Watched</span>
            {watched.length === 0 ? (
              <p className="field-hint">
                No saved search has keywords yet, so there is nothing to watch. Save a search
                with terms from the bar, and it will appear here.
              </p>
            ) : (
              <ul className="watched-list">
                {watched.map((search) => (
                  <li key={search.name} className="watched-row">
                    <span className="watched-name">{search.name}</span>
                    <span className="watched-terms">
                      {search.filters.searchKeywords.join(', ')}
                    </span>
                    <span className="watched-status">{statusOf(search)}</span>
                  </li>
                ))}
              </ul>
            )}
            {skipped > 0 && (
              <p className="field-hint">
                {skipped} more saved search{skipped === 1 ? '' : 'es'} with keywords{' '}
                {skipped === 1 ? 'is' : 'are'} not watched - only the first {MAX_WATCHED} by
                name are.
              </p>
            )}
            <p className="field-hint">
              Last checked: {when(state?.checkedAt)}.{' '}
              <button type="button" className="reset" disabled={busy} onClick={checkNow}>
                Check now
              </button>
            </p>
          </div>
        </>
      )}

      {note && <p className="field-hint">{note}</p>}
    </>
  );
}
