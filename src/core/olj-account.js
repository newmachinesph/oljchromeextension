/**
 * Reading your OnlineJobs.ph account email, to verify your extension account.
 *
 * Verification here is not a mailed link. The extension already runs on OLJ
 * pages while you are logged in; the server grants the welcome credits only when
 * the email on your OnlineJobs.ph account-settings page matches the email you
 * registered the extension account with. So the one thing this file does is read
 * that email and hand it to the server to compare - it never decides anything
 * itself, and a wrong read only ever fails the match, it can never verify a
 * stranger.
 *
 * The fetch runs in the service worker, at the extension's own origin, with your
 * OLJ cookies, and needs the onlinejobs.ph host permission granted (the same
 * optional permission alerts use). The parse is pure and regex-based - a service
 * worker has no DOMParser - which is also what lets it be unit-tested against
 * whatever shape the page turns out to have.
 */

/** The page that shows your account email while you are signed in to OLJ. */
export const ACCOUNT_SETTINGS_URL = 'https://www.onlinejobs.ph/jobseeker/account-settings';

/** The host permission the worker needs to read the page with your cookies. */
export const OLJ_ORIGIN_PERMISSION = { origins: ['https://www.onlinejobs.ph/*'] };

/** A whole-string email test. */
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
/** Every email on the page, for the last-resort single-candidate check. */
const EMAIL_RE_G = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Trim + lowercase, the same normalisation the server stores emails under. */
function normalize(email) {
  return String(email ?? '').trim().toLowerCase();
}

function isEmail(value) {
  const email = normalize(value);
  return email.length > 0 && email.length <= 254 && EMAIL_RE.test(email) && !/\s/.test(email);
}

/**
 * Addresses that appear on the page but are not the account holder's: the site's
 * own support and no-reply addresses in footers, and obvious placeholders. Kept
 * out so a footer link can never be attested as your email.
 */
const SYSTEM_LOCALPARTS = new Set([
  'support', 'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'info', 'admin',
  'help', 'hello', 'contact', 'sales', 'jobs', 'careers', 'team', 'notifications',
  'notification', 'mailer', 'mailer-daemon', 'postmaster', 'webmaster', 'abuse',
]);
const PLACEHOLDER_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'domain.com', 'email.com', 'sentry.io',
]);

function isSystemAddress(email) {
  const [local = '', domain = ''] = normalize(email).split('@');
  return SYSTEM_LOCALPARTS.has(local) || PLACEHOLDER_DOMAINS.has(domain);
}

/**
 * The account email from the account-settings HTML, or '' when it cannot be read
 * with confidence.
 *
 * Deliberately conservative. It tries the most reliable shapes first - the email
 * input's value, then a value sitting next to the word "email" - and only falls
 * back to a page-wide scan when exactly one plausible address remains. When the
 * page is ambiguous it returns '' rather than guess, because a wrong value sent
 * to the server is worse than asking you to make sure you are logged in.
 */
export function parseAccountEmail(html) {
  const text = String(html ?? '');
  if (text.length === 0) return '';

  // 1. An <input> that is the email field: type=email, or a name/id that says so.
  //    Its value= attribute is the account email the site itself put there.
  for (const tag of text.match(/<input\b[^>]*>/gi) ?? []) {
    const isEmailField =
      /type\s*=\s*["']?email["']?/i.test(tag) ||
      /\b(?:name|id)\s*=\s*["'][^"']*e-?mail[^"']*["']/i.test(tag);
    if (!isEmailField) continue;
    const value = tag.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1];
    if (value && isEmail(value) && !isSystemAddress(value)) return normalize(value);
  }

  // 2. A value labelled "email" nearby: covers "<td>Email</td><td>x@y.com</td>",
  //    "Email: x@y.com", "Email Address</label> ... x@y.com". Kept short-range so
  //    the label and the address genuinely belong together.
  const labelled = text.match(/e-?mail\b[\s\S]{0,120}?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
  if (labelled && isEmail(labelled[1]) && !isSystemAddress(labelled[1])) {
    return normalize(labelled[1]);
  }

  // 3. Last resort: the page has exactly one plausible address once the site's
  //    own and placeholder addresses are removed. More than one is ambiguous, so
  //    we decline rather than pick.
  const candidates = [...new Set((text.match(EMAIL_RE_G) ?? []).map(normalize))].filter(
    (email) => !isSystemAddress(email) && !email.endsWith('@onlinejobs.ph'),
  );
  if (candidates.length === 1) return candidates[0];

  return '';
}

/** Whether the onlinejobs.ph host permission has actually been granted. */
export async function hasOljPermission() {
  if (!chrome.permissions?.contains) return false;
  return chrome.permissions.contains(OLJ_ORIGIN_PERMISSION);
}

/**
 * Ask for the onlinejobs.ph host permission. Must be called from a user gesture
 * in an extension page (the popup / options button), never from the worker.
 */
export async function requestOljPermission() {
  if (!chrome.permissions?.request) return false;
  return chrome.permissions.request(OLJ_ORIGIN_PERMISSION);
}

/**
 * Ask the worker to read the account email. The popup/options call this after
 * the permission is granted; the worker holds the host permission and the
 * OLJ cookies, neither of which an extension page can use for this fetch.
 *
 * @returns {Promise<{ok: boolean, email?: string, error?: string}>}
 */
export async function readOljEmail() {
  let reply;
  try {
    reply = await chrome.runtime.sendMessage({ type: 'read-olj-email' });
  } catch {
    return { ok: false, error: 'unreachable' };
  }
  return reply ?? { ok: false, error: 'unreachable' };
}

/**
 * The fetch + parse itself, run in the service worker.
 *
 * Sent with credentials so your OLJ login is used, and fenced to the one
 * account-settings URL. A read that lands on the login page (not signed in)
 * yields no plausible email and is reported as such, so the UI can tell you to
 * log in rather than show a mysterious failure.
 */
export async function performOljEmailFetch() {
  if (!(await hasOljPermission())) {
    return { ok: false, error: 'permission' };
  }

  let response;
  try {
    response = await fetch(ACCOUNT_SETTINGS_URL, { credentials: 'include' });
  } catch {
    return { ok: false, error: 'unreachable' };
  }

  if (!response.ok) {
    return { ok: false, error: `http_${response.status}` };
  }

  const email = parseAccountEmail(await response.text().catch(() => ''));
  if (!email) return { ok: false, error: 'not-found' };
  return { ok: true, email };
}
