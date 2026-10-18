/**
 * Service worker.
 *
 * Three jobs. Opening the options page, which a content script is not allowed
 * to do for itself. Painting the toolbar badge with what is waiting on you -
 * applications due a follow-up, and new listings for watched searches. And,
 * only when you have turned it on, re-running your saved searches on a timer
 * to find those new listings.
 *
 * Event-driven throughout: the worker wakes for a message, a storage change,
 * a startup or an alarm, does the one thing, and goes back to sleep. A module,
 * so it shares the same pure logic the page uses and never disagrees with it.
 */

import { sanitizeApplications } from './core/applications.js';
import { sanitize as sanitizeSettings } from './core/settings.js';
import { dueFollowUps } from './core/follow-ups.js';
import { badgeText } from './core/badge.js';
import {
  performDraftFetch,
  performAnalyzeFetch,
  performCheckoutFetch,
  performVerifyFetch,
  performDeleteFetch,
  connectAuthFromMessage,
  saveAuth,
} from './core/account.js';
import { performOljEmailFetch } from './core/olj-account.js';
import { isResumeUrl, bytesToBase64 } from './core/resume.js';

/**
 * Fetch a résumé by its OnlineJobs link, at the extension's own origin.
 *
 * Fenced to OnlineJobs https links and sent without credentials, so it can only
 * pull a file the site serves openly; a login-gated link simply fails and the
 * options page falls back to importing a downloaded file.
 */
async function fetchResume(url) {
  if (!isResumeUrl(url)) return { ok: false, error: 'Only an OnlineJobs résumé link can be imported.' };
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) {
      return { ok: false, error: `Could not fetch it (HTTP ${res.status}). Download it and use “Import from a file”.` };
    }
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > 15 * 1024 * 1024) return { ok: false, error: 'That file is too large.' };
    return { ok: true, contentType: res.headers.get('content-type') || '', base64: bytesToBase64(buffer) };
  } catch {
    return { ok: false, error: 'Could not reach the file. Download it and use “Import from a file”.' };
  }
}
import { loadSearches } from './core/saved-searches.js';
import { nameKey } from './core/saved-searches.js';
import {
  ALARM_NAME,
  watchedSearches,
  jobKeysFromHtml,
  diffSeen,
  loadAlertState,
  saveAlertState,
  totalNew,
  ALERTS_KEY,
  alertMessage,
  notificationId,
  notificationTarget,
  NOTIFICATION_PREFIX,
} from './core/alerts.js';
import { absoluteSearchUrl } from './core/search-url.js';


const APPLICATIONS_KEY = 'ojRateFilterApplications';
const SETTINGS_KEY = 'ojRateFilter';

/** Slate, not red: this is a to-do count, not an alarm. */
const BADGE_COLOUR = '#475569';

async function readSettings() {
  const sync = await chrome.storage.sync.get(SETTINGS_KEY);
  return sanitizeSettings(sync?.[SETTINGS_KEY]);
}

/**
 * Read what is due and what is new, and put the sum on the icon.
 *
 * Reads storage directly rather than through the stores' load helpers, which
 * is the same data by the same sanitisers - just without assuming the worker
 * has the page's conveniences.
 */
export async function paintBadge() {
  const [local, settings, alerts] = await Promise.all([
    chrome.storage.local.get(APPLICATIONS_KEY),
    readSettings(),
    loadAlertState(),
  ]);
  const applications = sanitizeApplications(local?.[APPLICATIONS_KEY]);

  const due = dueFollowUps(applications, Date.now(), settings.followUpDays).length;
  const fresh = settings.alertsEnabled ? totalNew(alerts) : 0;

  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOUR });
  await chrome.action.setBadgeText({ text: badgeText(due, fresh) });
}

function paintQuietly() {
  paintBadge().catch((error) => {
    console.error('[onlinejobs rate filter] badge failed:', error);
  });
}

/**
 * Whether the optional permissions alerts need have actually been granted.
 *
 * Checked before every fetch rather than trusted from the setting: the reader
 * can revoke a permission from the browser's own UI at any time, and the
 * setting would not know.
 */
async function canFetchSite() {
  if (!chrome.permissions?.contains) return false;
  return chrome.permissions.contains({
    permissions: ['alarms'],
    origins: ['https://www.onlinejobs.ph/*'],
  });
}

/**
 * Re-run every watched search once and remember what was seen.
 *
 * One request per keyword, first page only, sequential rather than parallel -
 * this runs unattended, and unattended traffic should be the gentlest kind.
 * A failed search records its error and moves on; the run never throws.
 */
export async function runAlertCheck() {
  const settings = await readSettings();
  if (!settings.alertsEnabled || !(await canFetchSite())) return;

  const [searches, state] = await Promise.all([loadSearches(), loadAlertState()]);
  const now = Date.now();

  /** What this tick turned up, for the notification at the end. */
  const arrivals = [];

  for (const search of watchedSearches(searches)) {
    const key = nameKey(search.name);
    const entry = state.bySearch[key] ?? { seen: [], newCount: 0, checkedAt: null, lastError: '' };

    try {
      const found = new Set();
      for (const keyword of search.filters.searchKeywords) {
        const response = await fetch(absoluteSearchUrl(keyword, 0), { credentials: 'omit' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        for (const jobKey of jobKeysFromHtml(await response.text())) found.add(jobKey);
      }

      const diff = diffSeen(entry.seen, found);
      state.bySearch[key] = {
        seen: diff.seen,
        // Accumulates until you open the search; two quiet ticks should not
        // hide what the first one found.
        newCount: entry.newCount + diff.newKeys.length,
        checkedAt: now,
        lastError: '',
      };

      if (diff.newKeys.length > 0) {
        arrivals.push({
          name: search.name,
          count: diff.newKeys.length,
          url: absoluteSearchUrl(search.filters.searchKeywords[0] ?? '', 0),
        });
      }
    } catch (error) {
      state.bySearch[key] = { ...entry, checkedAt: now, lastError: String(error?.message ?? error) };
    }
  }

  state.checkedAt = now;
  await saveAlertState(state);
  await paintBadge();
  await announce(arrivals);
}

/**
 * Say out loud what this tick found.
 *
 * The badge has carried the count from the start, but a number on a toolbar
 * icon is only ever seen by someone already looking at it - and the point of
 * checking while no tab is open is that they are not looking. On OnlineJobs.ph
 * the advantage is applying before the pile builds up, and an advantage nobody
 * is told about is not one.
 *
 * One notification per tick, never one per search: three searches turning up a
 * job each is one thing that happened, not three. Silent when the permission
 * was never granted, which leaves the badge exactly as it was.
 */
async function announce(arrivals) {
  const message = alertMessage(arrivals);
  if (!chrome.notifications || message === '') return;

  try {
    await chrome.notifications.create(notificationId(arrivals), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: 'New jobs on OnlineJobs.ph',
      message,
    });
  } catch (error) {
    console.error('[onlinejobs rate filter] could not post the notification:', error);
  }
}

/** Create or clear the alarm to match the setting. Idempotent. */
export async function scheduleAlerts(settings) {
  if (!chrome.alarms) return;
  if (!settings.alertsEnabled || !(await canFetchSite())) {
    await chrome.alarms.clear(ALARM_NAME);
    return;
  }

  const existing = await chrome.alarms.get(ALARM_NAME);
  if (existing && existing.periodInMinutes === settings.alertIntervalMinutes) return;

  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: settings.alertIntervalMinutes,
  });
}

function scheduleQuietly() {
  readSettings()
    .then(scheduleAlerts)
    .catch((error) => console.error('[onlinejobs rate filter] alarm failed:', error));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'open-options') {
    chrome.runtime.openOptionsPage();
  } else if (message?.type === 'refresh-badge') {
    paintQuietly();
  } else if (message?.type === 'draft-request') {
    // The draft fetch runs here, at the extension's origin, so it is neither
    // mixed content (an https page reaching http://localhost) nor a cross-origin
    // request the site would refuse. The token is read from storage inside.
    performDraftFetch(message.body)
      .then(sendResponse)
      .catch(() => sendResponse({ status: 0, data: { error: 'unreachable' } }));
    return true;
  } else if (message?.type === 'analyze-request') {
    // Same reasoning as draft-request: run at the extension's origin, token
    // read from storage inside, so a page cannot spend someone else's credits.
    performAnalyzeFetch(message.body)
      .then(sendResponse)
      .catch(() => sendResponse({ status: 0, data: { error: 'unreachable' } }));
    return true;
  } else if (message?.type === 'checkout-request') {
    performCheckoutFetch()
      .then(sendResponse)
      .catch(() => sendResponse({ status: 0, data: { error: 'unreachable' } }));
    return true;
  } else if (message?.type === 'verify-request') {
    // Attest the OLJ email. Run here so the token is read from storage, never
    // taken from the message - a page cannot verify someone else's account.
    performVerifyFetch(message.oljEmail)
      .then(sendResponse)
      .catch(() => sendResponse({ status: 0, data: { error: 'unreachable' } }));
    return true;
  } else if (message?.type === 'delete-account') {
    performDeleteFetch()
      .then(sendResponse)
      .catch(() => sendResponse({ status: 0, data: { error: 'unreachable' } }));
    return true;
  } else if (message?.type === 'read-olj-email') {
    // Read the account email off the OLJ account-settings page, with the user's
    // OLJ cookies, at the extension origin. Fenced to the one URL inside.
    performOljEmailFetch()
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: 'unreachable' }));
    return true;
  } else if (message?.type === 'fetch-resume') {
    fetchResume(message.url)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: 'unreachable' }));
    return true;
  } else if (message?.type === 'check-alerts-now') {
    // From the options page's "Check now" button. Answered when done so the
    // page can refresh its "last checked" line.
    runAlertCheck()
      .catch((error) => console.error('[onlinejobs rate filter] alert check failed:', error))
      .finally(() => sendResponse({ done: true }));
    return true;
  }
  return undefined;
});

/**
 * The connect handoff: the website's connect page delivering a session token.
 *
 * Only pages matched by the manifest's `externally_connectable` can reach this
 * at all, and connectAuthFromMessage additionally pins the sender origin to
 * API_BASE and the message to the connect shape - so a random matched page (or
 * a future widened pattern) still cannot plant a token. This is the only
 * external message the worker answers.
 */
chrome.runtime.onMessageExternal?.addListener((message, sender, sendResponse) => {
  const origin = sender?.origin ?? (sender?.url ? new URL(sender.url).origin : undefined);
  const auth = connectAuthFromMessage(message, origin);
  if (!auth) {
    sendResponse({ ok: false });
    return undefined;
  }

  saveAuth(auth)
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

/**
 * A click on the alert goes where the jobs are, not to a settings page.
 *
 * The whole reason for telling someone early is that they can get there first,
 * so the click has to land on the search itself. With more than one search
 * involved there is no single right destination, and settings - which lists
 * every watched search and its count - is the honest answer.
 */
chrome.notifications?.onClicked.addListener((id) => {
  if (!id.startsWith(NOTIFICATION_PREFIX)) return;
  const url = notificationTarget(id);
  chrome.notifications.clear(id);
  if (url) chrome.tabs.create({ url });
  else chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => {
  paintQuietly();
  scheduleQuietly();
});
chrome.runtime.onInstalled.addListener(() => {
  paintQuietly();
  scheduleQuietly();
});

// Any change to applications, settings or the alert state may change the
// badge; a settings change may also change whether and how often to check.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes[APPLICATIONS_KEY] || changes[ALERTS_KEY])) paintQuietly();
  if (area === 'sync' && changes[SETTINGS_KEY]) {
    paintQuietly();
    scheduleQuietly();
  }
});

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  runAlertCheck().catch((error) =>
    console.error('[onlinejobs rate filter] alert check failed:', error),
  );
});

paintQuietly();
scheduleQuietly();
