/**
 * Taking everything with you, and putting it back.
 *
 * By this point the extension holds five separate things: settings, a profile,
 * a log of applications, a list of dismissals and a list of deleted posts. All
 * of it is local, which is the point - and also means a lost profile is lost.
 * A backup is the only honest answer to that.
 *
 * Restoring goes through each store's own sanitiser rather than trusting the
 * file. A backup is a file a person can edit, and it may have been written by
 * an older version that knew fewer settings - so it is treated as untrusted
 * input, exactly like anything read out of storage.
 */

import { sanitize as sanitizeSettings, DEFAULTS } from './settings.js';
import { sanitizeSearches } from './saved-searches.js';
import { sanitizeAbout } from './about.js';
import { sanitizeProfiles, migrateLegacy } from './profiles.js';
import { sanitizeApplications, statusLabel } from './applications.js';
import { sanitizeList } from './dismissed.js';
import { sanitizeSaved } from './saved.js';
import { MAX_VIEWED } from './viewed.js';
import { sanitizeJobNotes } from './job-notes.js';
import { sanitizeJobTags } from './job-tags.js';
import { sanitizeJobColors } from './job-colors.js';
import { sanitizeTagColors } from './tag-colors.js';
import { sanitizeSnippets } from './snippets.js';
import { sanitizeBoardConfig } from './board-config.js';
import { sanitizeBook } from './employer-book.js';
import { sanitizeAlertState } from './alerts.js';
import { sanitizeUserPresets, sanitizeHidden } from './user-presets.js';
import { sanitizeDrafts } from './drafts.js';
import { sanitizeDock } from './dock.js';
import { sanitizeClocks } from './clocks.js';
import { sanitizeState as sanitizePomodoro } from './pomodoro.js';
import { sanitizeState as sanitizeTime } from './time-tracker.js';
import { EXPORT_COLUMNS, toTabDelimited } from './job-export.js';

/**
 * Bumped only when the shape changes in a way a reader must know about.
 * Adding a settings key does not count - the sanitiser fills that in.
 */
/*
 * 9: your own presets, the presets you hid, saved drafts, and the resume link.
 *
 * The first two were shipped without being added here - a preset you wrote
 * yourself would have survived nothing. Drafts cost credits to produce, so
 * losing them to a reinstall means losing something you paid for.
 *
 * 10: the dock's arrangement and the three mini apps behind it - your clocks,
 * the pomodoro's settings and day log, and the time tracker's entries. The
 * last one is the serious member of that list: hours you billed for are not
 * something to lose to a reinstall.
 *
 * Deliberately still absent: benchmark, history, visits and the employer
 * sightings. All four are LEARNED from browsing and rebuild themselves; putting
 * them in a backup would swap a real file for a much larger one that restores
 * nothing you could not get by using the extension for a week.
 */
export const BACKUP_VERSION = 10;

/** What a backup is called when saved. */
export function backupFilename(now = Date.now()) {
  return `onlinejobs-rate-filter-${new Date(now).toISOString().slice(0, 10)}.json`;
}

/**
 * Gather everything into one plain object.
 *
 * @param {object} parts {settings, profile, applications, dismissed, expired,
 *   searches, employerBook}
 */
export function buildBackup({
  settings,
  about,
  profiles,
  applications,
  saved,
  viewed,
  jobNotes,
  jobTags,
  jobColors,
  tagColors,
  snippets,
  boardConfig,
  dismissed,
  expired,
  searches,
  employerBook,
  alertState,
  userPresets,
  hiddenPresets,
  drafts,
  resumeUrl,
  dock,
  clocks,
  pomodoro,
  time,
  now = Date.now(),
} = {}) {
  const asObject = (value) => (value instanceof Map ? Object.fromEntries(value) : (value ?? {}));
  const asArray = (value) => (value instanceof Set ? [...value] : (value ?? []));

  return {
    format: 'onlinejobs-rate-filter',
    version: BACKUP_VERSION,
    exportedAt: new Date(now).toISOString(),
    settings: sanitizeSettings(settings),
    about: sanitizeAbout(about),
    profiles: sanitizeProfiles(profiles),
    applications: asObject(applications),
    saved: asObject(saved),
    viewed: asArray(viewed),
    jobNotes: asObject(jobNotes),
    jobTags: asObject(jobTags),
    jobColors: asObject(jobColors),
    tagColors: asObject(tagColors),
    snippets: sanitizeSnippets(snippets),
    boardConfig: sanitizeBoardConfig(boardConfig),
    dismissed: asArray(dismissed),
    expired: asArray(expired),
    searches: sanitizeSearches(searches),
    employerBook: asObject(employerBook),
    alertState: sanitizeAlertState(alertState),
    userPresets: sanitizeUserPresets(userPresets),
    hiddenPresets: sanitizeHidden(hiddenPresets),
    drafts: Object.fromEntries(sanitizeDrafts(drafts)),
    resumeUrl: typeof resumeUrl === 'string' ? resumeUrl.slice(0, 500) : '',
    dock: sanitizeDock(dock),
    clocks: sanitizeClocks(clocks),
    pomodoro: sanitizePomodoro(pomodoro),
    time: sanitizeTime(time),
  };
}

export function toBackupJson(parts) {
  return JSON.stringify(buildBackup(parts), null, 2);
}

/**
 * Read a backup file, refusing anything that is not one.
 *
 * Deliberately forgiving about *missing* sections and strict about the file
 * being ours: a backup with no profile is one taken before profiles existed,
 * which should restore fine - whereas some other application's JSON should not
 * silently wipe five stores.
 *
 * @returns {{ok: true, data: object} | {ok: false, error: string}}
 */
export function readBackup(text) {
  let raw;
  try {
    raw = typeof text === 'string' ? JSON.parse(text) : text;
  } catch (error) {
    return { ok: false, error: `That is not valid JSON: ${error.message}` };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'That file does not contain a backup.' };
  }

  if (raw.format !== 'onlinejobs-rate-filter') {
    return { ok: false, error: 'That file was not written by this extension.' };
  }

  if (Number(raw.version) > BACKUP_VERSION) {
    return {
      ok: false,
      error: `That backup came from a newer version (${raw.version}). Update the extension first.`,
    };
  }

  return {
    ok: true,
    data: {
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : null,
      settings: sanitizeSettings(raw.settings),
      // Version 3 carries About + profiles. A version-2 file has a single
      // `profile`, which migrateLegacy splits into About plus one profile; v1
      // has neither, and restores empty.
      ...(raw.about || Array.isArray(raw.profiles)
        ? { about: sanitizeAbout(raw.about), profiles: sanitizeProfiles(raw.profiles) }
        : raw.profile
          ? migrateLegacy(raw.profile)
          : { about: sanitizeAbout(null), profiles: [] }),
      applications: sanitizeApplications(raw.applications, Date.now()),
      // Version 4 stores. Backups older than 4 simply lack them and restore
      // empty, exactly like saved searches did when they were new.
      saved: sanitizeSaved(raw.saved, Date.now()),
      viewed: sanitizeList(raw.viewed, MAX_VIEWED),
      jobNotes: sanitizeJobNotes(raw.jobNotes),
      jobTags: sanitizeJobTags(raw.jobTags),
      // Version 6. Older backups lack it and restore no card colours.
      jobColors: sanitizeJobColors(raw.jobColors),
      // Version 7. Older backups lack it and restore no tag colours.
      tagColors: sanitizeTagColors(raw.tagColors),
      // Version 8. Older backups lack it and restore no snippets.
      snippets: sanitizeSnippets(raw.snippets),
      // Version 5. Older backups lack it and restore the default board.
      boardConfig: sanitizeBoardConfig(raw.boardConfig),
      dismissed: sanitizeList(raw.dismissed),
      expired: sanitizeList(raw.expired),
      // Absent in backups taken before saved searches existed, which must still
      // restore rather than being rejected as malformed.
      searches: sanitizeSearches(raw.searches),
      // Version 2. A version-1 file simply has none, and restores an empty book.
      employerBook: sanitizeBook(raw.employerBook, Date.now()),
      alertState: sanitizeAlertState(raw.alertState),
      // Version 9. Older backups lack all four and restore none of them, which
      // is the same thing a fresh install has.
      userPresets: sanitizeUserPresets(raw.userPresets),
      hiddenPresets: sanitizeHidden(raw.hiddenPresets),
      drafts: sanitizeDrafts(raw.drafts),
      resumeUrl: typeof raw.resumeUrl === 'string' ? raw.resumeUrl.slice(0, 500) : '',
      // Version 10. Older backups lack all four; each sanitiser turns the
      // missing section into whatever a fresh install would have - the default
      // dock, the default clocks, an idle timer and an empty log.
      dock: sanitizeDock(raw.dock),
      clocks: sanitizeClocks(raw.clocks),
      pomodoro: sanitizePomodoro(raw.pomodoro),
      time: sanitizeTime(raw.time),
    },
  };
}

/** A one-line summary of what a restore would bring in. */
export function describeBackup(data) {
  const changedSettings = Object.keys(DEFAULTS).filter(
    (key) => JSON.stringify(data.settings[key]) !== JSON.stringify(DEFAULTS[key]),
  ).length;

  const parts = [
    `${data.applications.size} application${data.applications.size === 1 ? '' : 's'}`,
    `${data.dismissed.length} dismissed`,
    `${data.expired.length} no longer posted`,
    `${changedSettings} setting${changedSettings === 1 ? '' : 's'} changed from default`,
  ];

  if (data.searches.length > 0) {
    parts.push(`${data.searches.length} saved search${data.searches.length === 1 ? '' : 'es'}`);
  }

  const employers = data.employerBook?.size ?? 0;
  if (employers > 0) parts.push(`${employers} employer${employers === 1 ? '' : 's'} noted or blocked`);

  const saved = data.saved?.size ?? 0;
  if (saved > 0) parts.push(`${saved} saved`);

  const notes = data.jobNotes?.size ?? 0;
  if (notes > 0) parts.push(`${notes} job note${notes === 1 ? '' : 's'}`);

  const tagged = data.jobTags?.size ?? 0;
  if (tagged > 0) parts.push(`${tagged} tagged`);

  const hours = data.time?.entries?.length ?? 0;
  if (hours > 0) parts.push(`${hours} time entr${hours === 1 ? 'y' : 'ies'}`);

  const count = data.profiles?.length ?? 0;
  if (count > 0) parts.unshift(`${count} profile${count === 1 ? '' : 's'}`);

  return parts.join(' · ');
}

/**
 * Every application as a spreadsheet, newest first.
 *
 * The same columns a single job copies as, so a row pasted from the modal and a
 * row pasted from here land in the same shape. The columns an application does
 * not know about - the rate, the hours - are left empty rather than dropped,
 * because a ragged row is worse than a sparse one.
 */
export function applicationsToTabDelimited(applications) {
  const rows = [...(applications instanceof Map ? applications : new Map())]
    .map(([, record]) => record)
    .sort((a, b) => b.appliedAt - a.appliedAt)
    .map((record) => ({
      title: record.title,
      employer: '',
      rateText: '',
      usdPerMonth: null,
      jobType: '',
      hoursPerWeek: '',
      postedAt: record.appliedAt,
      status: statusLabel(record.status),
      url: record.url,
    }));

  return rows.length === 0 ? EXPORT_COLUMNS.join('\t') : toTabDelimited(rows);
}
