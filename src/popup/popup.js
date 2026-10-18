/**
 * The toolbar popup: connect your account, see your balance, sign out.
 *
 * Deliberately the only place an account is mentioned in the browsing UI. The
 * bar on the results page belongs to filtering, which needs no account and
 * should not start asking for one. Signing in itself happens on the website -
 * the popup never handles a password.
 */
import {
  API_BASE,
  connectUrl,
  fetchAccount,
  loadAuth,
  signOut,
  requestVerify,
  requestCheckout,
  startTrial,
  activateSubscription,
} from '../core/account.js';
import {
  readOljEmail,
  hasOljPermission,
  requestOljPermission,
} from '../core/olj-account.js';
import { creditNudge } from '../core/credit-nudge.js';
import { loadApplications, markFollowedUp, onApplicationsChanged } from '../core/applications.js';
import { loadSettings, saveSettings } from '../core/settings.js';
import { dueFollowUps, describeWaiting } from '../core/follow-ups.js';
import { loadSearches, nameKey } from '../core/saved-searches.js';
import {
  loadAlertState,
  onAlertStateChanged,
  clearNewCount,
  clearAllNew,
  watchedSearches,
} from '../core/alerts.js';
import { absoluteSearchUrl } from '../core/search-url.js';

const SITE = 'https://www.onlinejobs.ph';

const panes = {
  loading: document.getElementById('loading'),
  signedOut: document.getElementById('signed-out'),
  signedIn: document.getElementById('signed-in'),
};

const errorBox = document.getElementById('error');

function show(name) {
  for (const [key, pane] of Object.entries(panes)) pane.hidden = key !== name;
}

function fail(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

/** Draw whichever pane matches the stored session, checking it against the server. */
async function render() {
  const auth = await loadAuth();
  if (!auth) {
    show('signedOut');
    return;
  }

  // Optimistic: the stored email fills the pane immediately, and the balance
  // arrives when the server answers. A popup that shows nothing until the
  // network replies feels broken on a slow connection.
  document.getElementById('email').textContent = auth.email;
  document.getElementById('credits').textContent = '—';
  show('signedIn');

  try {
    const account = await fetchAccount();
    if (!account) {
      // The session was revoked or expired; fetchAccount has already cleared it.
      show('signedOut');
      fail('That session has ended. Sign in again.');
      return;
    }

    renderAccount(account);
  } catch (error) {
    document.getElementById('credits').textContent = 'unavailable';
    document.getElementById('account-note').textContent = error.message;
  }
}

/** Paint the credits, verification state and low-credit nudge from /api/me. */
function renderAccount(account) {
  document.getElementById('email').textContent = account.user.email;

  const credits = Number.isFinite(account.credits) ? account.credits : 0;
  const buckets = account.buckets ?? {};
  const creditsEl = document.getElementById('credits');
  creditsEl.textContent = credits.toLocaleString('en-US');
  // The bonus/purchased split, when there is one worth showing, as a hover title.
  if (Number.isFinite(buckets.bonus) && Number.isFinite(buckets.purchased) && credits > 0) {
    creditsEl.title = `${buckets.purchased.toLocaleString('en-US')} purchased · ${buckets.bonus.toLocaleString('en-US')} bonus`;
  } else {
    creditsEl.removeAttribute('title');
  }

  const byok = account.byok ?? {};
  const byokActive = byok.enabled === true;
  document.getElementById('ai-billing').textContent = byokActive
    ? `BYOK · ${byok.provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'}`
    : 'OljExtension credits';
  document.getElementById('account-note').textContent = byokActive
    ? `AI requests use your ${byok.keyHint ?? 'saved'} provider key. Your OljExtension credits are not spent.`
    : 'Credits are spent only by AI features, and only when you ask for one.';

  renderVerify(account.user.emailVerified === true);
  renderNudge(account.user.emailVerified === true && !byokActive ? credits : null);
  renderSubscription(account);
}

/** How many days, said the way a person would say it. */
function daysLabel(n) {
  if (n <= 0) return 'today';
  if (n === 1) return '1 day left';
  return `${n} days left`;
}

/**
 * The get-paid ops subscription: where it stands, and the way in.
 *
 * Three states, and each shows only the action that would actually work:
 * running (say when it ends), never started (offer the free trial first, since
 * that is what almost anyone should take), and lapsed or trial-spent (offer to
 * pay). The trial button is hidden the moment it stops being available, so it
 * can never be pressed into a 409.
 */
function renderSubscription(account) {
  const pane = document.getElementById('subscription');
  const sub = account.subscription;
  if (!sub) {
    pane.hidden = true;
    return;
  }

  const trial = account.trial ?? {};
  const price = account.subscriptionPrice ?? { credits: 10, days: 30 };
  const title = document.getElementById('sub-title');
  const body = document.getElementById('sub-body');
  const trialBtn = document.getElementById('sub-trial');
  const activateBtn = document.getElementById('sub-activate');

  pane.hidden = false;
  trialBtn.hidden = !trial.eligible;
  trialBtn.textContent = `Start ${trial.days ?? 14}-day free trial`;
  activateBtn.textContent = `${price.credits} credits · ${price.days} days`;
  activateBtn.hidden = false;

  if (sub.active) {
    const ends = sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString() : null;
    title.textContent = `Get-paid tools · ${daysLabel(sub.daysLeft ?? 0)}`;
    body.textContent = ends
      ? `Invoices, contracts, portfolio and the client book are unlocked until ${ends}.`
      : 'Invoices, contracts, portfolio and the client book are unlocked.';
    // Extending early is legitimate, but it is not the thing to lead with while
    // the window is still open, and the primary style would say otherwise.
    activateBtn.textContent = `Extend · ${price.credits} credits`;
    return;
  }

  title.textContent = 'Get-paid tools are locked';
  body.textContent = trial.eligible
    ? `Invoicing, contracts, portfolio PDFs and your client book. Try them free for ${trial.days ?? 14} days — no credits, nothing renews.`
    : `Invoicing, contracts, portfolio PDFs and your client book. ${price.credits} credits unlocks ${price.days} days; nothing renews on its own.`;
}

/** The verification block: hidden once verified, a CTA until then. */
function renderVerify(verified) {
  const pane = document.getElementById('verify');
  pane.hidden = verified;
}

/**
 * The low-credit nudge, from the pure creditNudge rule. Null balance (an
 * unverified account, where credits do not yet apply) shows nothing.
 */
function renderNudge(credits) {
  const pane = document.getElementById('nudge');
  const nudge = creditNudge(credits);
  if (!nudge) {
    pane.hidden = true;
    return;
  }

  document.getElementById('nudge-title').textContent = nudge.title;
  document.getElementById('nudge-body').textContent = nudge.body;
  document.getElementById('get-credits').hidden = !nudge.actions.includes('get-credits');
  document.getElementById('invite').hidden = !nudge.actions.includes('invite');
  pane.dataset.level = nudge.level;
  pane.hidden = false;
}

/*
 * No form here: the popup never sees a password. The button opens the site's
 * connect page; signing in (or up) happens there, and the page hands the
 * worker a session token. Next time the popup opens, render() finds it.
 */
document.getElementById('connect').addEventListener('click', () => {
  chrome.tabs.create({ url: connectUrl() });
});

document.getElementById('open-site').addEventListener('click', (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: API_BASE });
});

/*
 * Built from API_BASE so it follows the environment: localhost while testing,
 * the deployed site in a release. One source of truth for where "us" is.
 *
 * Routed through the handoff rather than straight at /dashboard: the extension
 * authenticates with a bearer token and the site with a cookie, so a plain
 * navigation arrives signed out however signed in you are here. The handoff
 * trades one for the other and then redirects. Without a token we send you to
 * the dashboard anyway and let the site ask for a sign-in.
 */
document.getElementById('open-dashboard').addEventListener('click', async () => {
  const auth = await loadAuth();
  const url = auth?.token
    ? new URL(`/api/auth/handoff?token=${encodeURIComponent(auth.token)}&next=/dashboard`, API_BASE)
    : new URL('/dashboard', API_BASE);

  chrome.tabs.create({ url: url.href });
});

/**
 * Both subscription buttons, sharing one path.
 *
 * Repainted from a fresh /api/me rather than from the reply: activation moves
 * the credit balance as well as the window, and the popup shows both. One
 * source of truth beats stitching two.
 */
async function runSubscriptionAction(button, action, busyLabel) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;

  try {
    await action();
    const account = await fetchAccount();
    if (account) renderAccount(account);
  } catch (error) {
    const message = String(error.message ?? '');
    document.getElementById('sub-body').textContent = message.includes('verification_required')
      ? 'Verify your OnlineJobs.ph account first — spending credits needs a verified account.'
      : message.includes('insufficient_credits')
        ? 'Not enough credits for that yet.'
        : message.includes('already_used')
          ? 'That free trial has already been used on this account.'
          : message || 'That did not work. Try again in a moment.';
    button.textContent = original;
  } finally {
    button.disabled = false;
  }
}

document.getElementById('sub-trial').addEventListener('click', (event) => {
  runSubscriptionAction(event.currentTarget, startTrial, 'Starting…');
});

document.getElementById('sub-activate').addEventListener('click', (event) => {
  runSubscriptionAction(event.currentTarget, activateSubscription, 'Activating…');
});

document.getElementById('sign-out').addEventListener('click', async () => {
  await signOut();
  show('signedOut');
});

document.getElementById('open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

/**
 * Verify by attesting the OnlineJobs.ph account email.
 *
 * Asks for the onlinejobs.ph permission (the button press is the user gesture
 * the browser requires), reads the email off the account-settings page in the
 * worker, and posts it to the server. Every failure has its own sentence: not
 * granted, not logged in, no match. A wrong read only ever fails the match.
 */
async function verifyFlow() {
  const btn = document.getElementById('verify-btn');
  const body = document.getElementById('verify-body');
  btn.disabled = true;
  btn.textContent = 'Checking…';

  try {
    if (!(await hasOljPermission())) {
      const granted = await requestOljPermission();
      if (!granted) {
        body.textContent =
          'Permission to read your OnlineJobs.ph account was declined, so we cannot verify. Allow it and try again.';
        return;
      }
    }

    const read = await readOljEmail();
    if (!read.ok) {
      body.textContent =
        read.error === 'not-found' || read.error === 'permission'
          ? 'We could not read your OnlineJobs.ph email. Open onlinejobs.ph, make sure you are logged in, then try again.'
          : 'Could not reach onlinejobs.ph. Check you are logged in there and try again.';
      return;
    }

    const result = await requestVerify(read.email);
    if (!result.verified) {
      body.textContent =
        'That OnlineJobs.ph email does not match the email you signed up with. Sign up (or sign in) with the same email your OnlineJobs.ph account uses.';
      return;
    }

    // Verified: the block hides and the balance refreshes on the next render.
    await render();
  } catch (error) {
    body.textContent = error.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verify my OnlineJobs.ph account';
  }
}

document.getElementById('verify-btn').addEventListener('click', verifyFlow);

document.getElementById('get-credits').addEventListener('click', async (event) => {
  const btn = event.currentTarget;
  btn.disabled = true;
  try {
    const { checkoutUrl } = await requestCheckout();
    if (checkoutUrl) chrome.tabs.create({ url: checkoutUrl });
  } catch (error) {
    document.getElementById('nudge-body').textContent = error.message;
  } finally {
    btn.disabled = false;
  }
});

// Invite friends lives with the referral code on the options page.
document.getElementById('invite').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

/**
 * Applications that have waited long enough for a nudge.
 *
 * Read from the same store and the same rule as the card chip and the badge,
 * so the three never disagree. Each line opens the job; "Followed up" restarts
 * its clock and takes it off this list.
 */
async function renderFollowUps(applications) {
  const pane = document.getElementById('followups');
  const list = document.getElementById('followup-list');
  const settings = await loadSettings();
  const due = dueFollowUps(applications, Date.now(), settings.followUpDays);

  list.textContent = '';
  pane.hidden = due.length === 0;
  if (due.length === 0) return;

  for (const entry of due.slice(0, 8)) {
    const item = document.createElement('li');
    item.className = 'todo-item';

    const link = document.createElement('a');
    link.href = '#';
    link.className = 'todo-link';
    link.textContent = entry.title || 'Untitled job';
    link.title = 'Open the job';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      if (entry.url) chrome.tabs.create({ url: new URL(entry.url, SITE).href });
    });

    const when = document.createElement('span');
    when.className = 'todo-when';
    when.textContent = describeWaiting(entry);

    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'todo-done';
    done.textContent = 'Followed up';
    done.title = 'Note that you nudged them; the reminder starts again from now';
    done.addEventListener('click', async () => {
      done.disabled = true;
      renderFollowUps(await markFollowedUp(entry.key));
    });

    item.append(link, when, done);
    list.appendChild(item);
  }

  if (due.length > 8) {
    const more = document.createElement('li');
    more.className = 'todo-more';
    more.textContent = `and ${due.length - 8} more in All settings`;
    list.appendChild(more);
  }
}

/**
 * New listings for watched searches, one line each.
 *
 * Opening a search clears its count - you are about to see them - and opens
 * the site's own search for its first keyword, where the page filters as usual.
 */
async function renderMatches(state) {
  const pane = document.getElementById('matches');
  const list = document.getElementById('match-list');
  const settings = await loadSettings();
  if (!settings.alertsEnabled) {
    pane.hidden = true;
    return;
  }

  const searches = watchedSearches(await loadSearches());
  const rows = searches
    .map((search) => ({ search, entry: state.bySearch[nameKey(search.name)] }))
    .filter(({ entry }) => entry && (entry.newCount > 0 || entry.lastError));

  list.textContent = '';
  pane.hidden = rows.length === 0;
  if (rows.length === 0) return;

  for (const { search, entry } of rows) {
    const item = document.createElement('li');
    item.className = 'todo-item';

    const link = document.createElement('a');
    link.href = '#';
    link.className = 'todo-link';
    link.textContent = search.name;
    link.title = 'Open this search';
    link.addEventListener('click', async (event) => {
      event.preventDefault();
      chrome.tabs.create({ url: absoluteSearchUrl(search.filters.searchKeywords[0], 0) });
      renderMatches(await clearNewCount(search.name));
    });

    const when = document.createElement('span');
    when.className = 'todo-when';
    when.textContent = entry.lastError
      ? `last check failed: ${entry.lastError}`
      : `${entry.newCount} new listing${entry.newCount === 1 ? '' : 's'}`;

    item.append(link, when);
    list.appendChild(item);
  }
}

document.getElementById('mark-seen').addEventListener('click', async (event) => {
  event.preventDefault();
  renderMatches(await clearAllNew());
});

// The master switch, in the footer. It reflects the stored setting and writes
// it back on toggle; the content-script bootstrap watches for the change and
// reloads the open OnlineJobs.ph tabs, so it applies both ways at once. Left
// available whether or not you are signed in - it governs the free UI too.
const injectToggle = document.getElementById('inject-toggle');
loadSettings().then((settings) => {
  injectToggle.checked = settings.injectionEnabled !== false;
});
injectToggle.addEventListener('change', () => {
  saveSettings({ injectionEnabled: injectToggle.checked });
});

render();
loadApplications().then(renderFollowUps);
loadAlertState().then(renderMatches);
onAlertStateChanged(renderMatches);
onApplicationsChanged(renderFollowUps);
// Opening the popup is a fine moment for the badge to re-check its count.
chrome.runtime.sendMessage({ type: 'refresh-badge' }).catch(() => {});
