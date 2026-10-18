/**
 * Export, import and restore.
 *
 * Everything this extension holds is local, which is the point - and also means
 * a reinstall, a wiped profile or a new machine loses all of it. This is the
 * only answer to that, so it is deliberately plain: one button that saves a
 * file, one that reads one back.
 *
 * A restore always shows what it found before it writes anything. Replacing
 * five stores is not something to do on a mis-click.
 */

import { useState, useEffect } from 'react';
import { FileButton } from './fields.jsx';
import { loadSettings, replaceSettings } from '../core/settings.js';
import { loadAbout, replaceAbout } from '../core/about.js';
import { loadProfiles, replaceProfiles } from '../core/profiles.js';
import { loadApplications, replaceApplications } from '../core/applications.js';
import { loadSaved, replaceSaved } from '../core/saved.js';
import { loadViewed, replaceViewed } from '../core/viewed.js';
import { loadJobNotes, replaceJobNotes } from '../core/job-notes.js';
import { loadJobTags, replaceJobTags } from '../core/job-tags.js';
import { loadJobColors, replaceJobColors } from '../core/job-colors.js';
import { loadTagColors, replaceTagColors } from '../core/tag-colors.js';
import { loadSnippets, replaceSnippets } from '../core/snippets.js';
import { loadBoardConfig, replaceBoardConfig } from '../core/board-config.js';
import { loadDismissedList, replaceDismissed } from '../core/dismissed.js';
import { loadExpiredList, replaceExpired } from '../core/expired.js';
import { loadSearches, replaceSearches } from '../core/saved-searches.js';
import { loadBook, replaceBook } from '../core/employer-book.js';
import { loadAlertState, saveAlertState } from '../core/alerts.js';
import {
  loadUserPresets,
  replaceUserPresets,
  loadHiddenPresets,
  replaceHiddenPresets,
} from '../core/user-presets.js';
import { loadDrafts, replaceDrafts } from '../core/drafts.js';
import { loadDock, saveDock } from '../core/dock.js';
import { loadClocks, replaceClocks } from '../core/clocks.js';
import { loadPomodoro, replacePomodoro } from '../core/pomodoro.js';
import { loadTime, replaceTime } from '../core/time-tracker.js';
import { RESUME_URL_KEY } from '../core/resume.js';

/** The resume link is a bare string under its own key, with no store module. */
async function loadResumeUrl() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return '';
  const stored = await chrome.storage.local.get(RESUME_URL_KEY);
  return typeof stored?.[RESUME_URL_KEY] === 'string' ? stored[RESUME_URL_KEY] : '';
}

async function replaceResumeUrl(url) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return '';
  if (url) await chrome.storage.local.set({ [RESUME_URL_KEY]: url });
  else await chrome.storage.local.remove(RESUME_URL_KEY);
  return url ?? '';
}
import {
  toBackupJson,
  readBackup,
  describeBackup,
  backupFilename,
  applicationsToTabDelimited,
} from '../core/backup.js';

/** Hand the browser a file to save, without needing the downloads permission. */
function saveFile(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on a later tick: revoking immediately can beat the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function gather() {
  const [
    settings, about, profiles, applications, saved, viewed, jobNotes, jobTags, jobColors, tagColors, snippets, boardConfig,
    dismissed, expired, searches, employerBook, alertState,
    userPresets, hiddenPresets, drafts, resumeUrl,
    dock, clocks, pomodoro, time,
  ] = await Promise.all([
    loadSettings(),
    loadAbout(),
    loadProfiles(),
    loadApplications(),
    loadSaved(),
    loadViewed(),
    loadJobNotes(),
    loadJobTags(),
    loadJobColors(),
    loadTagColors(),
    loadSnippets(),
    loadBoardConfig(),
    loadDismissedList(),
    loadExpiredList(),
    loadSearches(),
    loadBook(),
    loadAlertState(),
    loadUserPresets(),
    loadHiddenPresets(),
    loadDrafts(),
    loadResumeUrl(),
    loadDock(),
    loadClocks(),
    loadPomodoro(),
    loadTime(),
  ]);
  return {
    settings, about, profiles, applications, saved, viewed, jobNotes, jobTags, jobColors, tagColors, snippets, boardConfig,
    dismissed, expired, searches, employerBook, alertState,
    userPresets, hiddenPresets, drafts, resumeUrl,
    dock, clocks, pomodoro, time,
  };
}

export function Backup() {
  const [counts, setCounts] = useState(null);
  const [pending, setPending] = useState(null);
  const [note, setNote] = useState('');

  const refresh = () =>
    gather().then((all) =>
      setCounts({
        applications: all.applications.size,
        saved: all.saved.size,
        dismissed: all.dismissed.length,
        expired: all.expired.length,
        searches: all.searches.length,
        profiles: all.profiles.length,
        hasProfile: all.profiles.length > 0 || Boolean(all.about.name || all.about.email),
      }),
    );

  useEffect(() => {
    refresh();
  }, []);

  if (counts === null) return <p className="loading">Loading...</p>;

  const onExport = async () => {
    try {
      saveFile(backupFilename(), toBackupJson(await gather()));
      setNote('Backup saved.');
    } catch (error) {
      setNote(`Could not save the backup: ${error.message}`);
    }
  };

  const onCopyApplications = async () => {
    try {
      const { applications } = await gather();
      const ok = await copyText(applicationsToTabDelimited(applications));
      setNote(ok ? 'Applications copied — paste into a spreadsheet.' : 'Could not copy.');
    } catch (error) {
      setNote(`Could not copy: ${error.message}`);
    }
  };

  const onChoose = async (event) => {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file twice still fires a change.
    event.target.value = '';
    if (!file) return;

    const result = readBackup(await file.text());
    if (!result.ok) {
      setPending(null);
      setNote(result.error);
      return;
    }

    setNote('');
    setPending(result.data);
  };

  const onRestore = async () => {
    try {
      await Promise.all([
      replaceSettings(pending.settings),
      replaceAbout(pending.about),
      replaceProfiles(pending.profiles),
      replaceApplications(pending.applications),
      replaceSaved(pending.saved),
      replaceViewed(pending.viewed),
      replaceJobNotes(pending.jobNotes),
      replaceJobTags(pending.jobTags),
      replaceJobColors(pending.jobColors),
      replaceTagColors(pending.tagColors),
      replaceSnippets(pending.snippets),
      replaceBoardConfig(pending.boardConfig),
      replaceDismissed(pending.dismissed),
      replaceExpired(pending.expired),
      replaceSearches(pending.searches),
      replaceBook(pending.employerBook),
      saveAlertState(pending.alertState),
      // Version 9. A file written before these existed restores them empty,
      // which is what a fresh install has anyway.
      replaceUserPresets(pending.userPresets),
      replaceHiddenPresets(pending.hiddenPresets),
      replaceDrafts(pending.drafts),
      replaceResumeUrl(pending.resumeUrl),
      // Version 10: the dock and the three mini apps behind it. The dock is
      // saved rather than replaced - it is a single object, not a list, and
      // saveDock is the only writer that sanitises it on the way in.
      saveDock(pending.dock),
      replaceClocks(pending.clocks),
      replacePomodoro(pending.pomodoro),
      replaceTime(pending.time),
      ]);

      setPending(null);
      setNote('Restored. Reload any open job-search tab to see it.');
      refresh();
    } catch (error) {
      // Leave `pending` set so the restore can be retried; the stores each
      // sanitise on read, so a partial write is not corrupting, only incomplete.
      setNote(`Restore failed: ${error.message}. Try again, or check your storage space.`);
      refresh();
    }
  };

  return (
    <div className="backup">
      <p className="section-desc">
        Everything is stored on this machine and nowhere else, so a reinstall or a
        new laptop loses all of it unless you take a copy. The file below holds your
        settings, profile, applications, dismissals, deleted-job list, the
        employers you blocked or wrote notes on, and everything in the dock —
        your logged hours included.
      </p>

      <p className="field-hint backup-counts">
        Right now: {counts.profiles} profile{counts.profiles === 1 ? '' : 's'} ·{' '}
        {counts.applications} application{counts.applications === 1 ? '' : 's'} ·{' '}
        {counts.saved} saved · {counts.dismissed} dismissed ·{' '}
        {counts.expired} no longer posted ·{' '}
        {counts.searches} saved search{counts.searches === 1 ? '' : 'es'}.
      </p>

      <div className="rules-actions">
        <button type="button" className="reset" onClick={onExport}>
          Save a backup file
        </button>
        <button type="button" className="reset" onClick={onCopyApplications}>
          Copy applications for a spreadsheet
        </button>
      </div>

      <h3 className="rules-examples-heading">Restore from a backup</h3>
      <p className="field-hint">
        This <strong>replaces</strong> everything above — it does not merge. You will
        see what the file contains before anything is written.
      </p>

      <FileButton label="Choose a backup file…" accept="application/json,.json" onFile={onChoose} />

      {pending && (
        <div className="backup-pending">
          <p>
            <strong>Ready to restore</strong>
            {pending.exportedAt ? ` — taken ${pending.exportedAt.slice(0, 10)}` : ''}
          </p>
          <p className="field-hint">{describeBackup(pending)}</p>
          <div className="rules-actions">
            <button type="button" className="reset" onClick={onRestore}>
              Replace everything with this
            </button>
            <button type="button" className="reset" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {note && (
        <p className="field-hint backup-note" aria-live="polite">
          {note}
        </p>
      )}
    </div>
  );
}
