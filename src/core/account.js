/**
 * The optional half of the extension.
 *
 * Everything else here runs on your machine and sends nothing anywhere, and
 * that stays true. An account exists only for the features that genuinely
 * cannot be local: the ones needing an API key, which must never ship inside an
 * extension bundle, and credits, which cannot be enforced client-side at all -
 * a balance kept in chrome.storage is decoration, since anyone can edit it.
 *
 * So nothing in this file is required for the extension to work. Signed out,
 * every existing feature behaves exactly as before.
 */

const STORAGE_KEY = 'ojRateFilterAuth';

/**
 * Where the API lives.
 *
 * The deployed production service. It is the one line to change if the service
 * moves, and it has to match a host_permissions entry in the manifest or every
 * request fails before it is sent.
 */
export const API_BASE = 'https://oljextension.site'; // local testing: 'http://localhost:3100'

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export function sanitizeAuth(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (token.length === 0) return null;

  return {
    token,
    email: typeof input.email === 'string' ? input.email : '',
    // Stored so the popup can tell "signed out" from "session expired" without
    // a round trip, which matters on a slow connection.
    expiresAt: typeof input.expiresAt === 'string' ? input.expiresAt : null,
  };
}

export async function loadAuth() {
  if (!hasStorage()) return null;
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeAuth(stored?.[STORAGE_KEY]);
}

export async function saveAuth(auth) {
  const clean = sanitizeAuth(auth);
  if (hasStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: clean });
  return clean;
}

export async function clearAuth() {
  if (hasStorage()) await chrome.storage.local.remove(STORAGE_KEY);
  return null;
}

/**
 * One place where a network failure becomes a sentence someone can act on.
 *
 * "Failed to fetch" is what a browser says when the server is down, and it is
 * not something to put in front of a reader.
 */
async function call(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Could not reach the server. Is it running?');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);

  return data;
}

/**
 * Where signing in happens: on the website, never in the extension.
 *
 * The popup used to carry its own email/password form, which meant passwords
 * passed through extension code. Now it opens this page instead: you
 * authenticate on the site (or already are), press Connect, and the page hands
 * the worker a ready-made session token over `chrome.runtime.sendMessage` -
 * the same pattern Grammarly uses, and the reason the store listing does not
 * have to declare collecting authentication information.
 */
export function connectUrl() {
  return `${API_BASE}/connect-extension`;
}

/**
 * The gate on that handoff, pure so it can be tested.
 *
 * `onMessageExternal` is reachable by any page the manifest's
 * `externally_connectable` patterns match, so the sender origin - the one thing
 * a page cannot fake - must be our own site, and the message must be shaped
 * like the connect page sends it. Anything else is refused with null, never
 * repaired.
 *
 * @returns {object|null} the sanitized auth to store, or null to ignore
 */
export function connectAuthFromMessage(message, senderOrigin, apiBase = API_BASE) {
  if (!senderOrigin || senderOrigin !== new URL(apiBase).origin) return null;
  if (!message || typeof message !== 'object' || message.type !== 'connect-token') return null;

  return sanitizeAuth({
    token: message.token,
    email: message.email,
    expiresAt: message.expiresAt,
  });
}

/**
 * The account as the server sees it.
 *
 * The balance is a display value and never an entitlement. Whether work is
 * allowed is decided by the server at the moment it is asked for, because
 * anything this side of the network can be edited by the person reading it.
 *
 * @returns {object|null} null when the session is gone, having cleared it
 */
export async function fetchAccount() {
  const auth = await loadAuth();
  if (!auth) return null;

  try {
    return await call('/api/me', { token: auth.token });
  } catch (error) {
    // A revoked or expired session should sign you out here rather than leave
    // the popup insisting you are signed in to something that refuses you.
    if (String(error.message).includes('unauthorized')) {
      await clearAuth();
      return null;
    }
    throw error;
  }
}

/**
 * Open the free trial of the get-paid ops tools.
 *
 * Costs nothing and needs no verification - the trial spends no credits, and
 * making someone prove their OnlineJobs email before they may look at an
 * invoice builder would gate the evaluation on something unrelated to it.
 *
 * Straight through `call` rather than via the worker, like fetchAccount: the
 * popup is already holding the token to have asked who you are.
 *
 * @returns {Promise<{active: boolean, expiresAt: string|null, daysLeft: number}>}
 */
export async function startTrial() {
  const auth = await loadAuth();
  if (!auth) throw new Error('Sign in first.');

  const data = await call('/api/subscription/trial', {
    method: 'POST',
    token: auth.token,
    body: {},
  });
  return data.subscription;
}

/**
 * Spend credits to open - or extend - the ops subscription.
 *
 * Unlike the trial this does need a verified account, because it moves the
 * credit ledger. The server refuses with `verification_required` and the popup
 * says so rather than guessing why nothing happened.
 *
 * @returns {Promise<{subscription: object, balance: number}>}
 */
export async function activateSubscription() {
  const auth = await loadAuth();
  if (!auth) throw new Error('Sign in first.');

  return call('/api/subscription/activate', {
    method: 'POST',
    token: auth.token,
    body: {},
  });
}

/**
 * A failed draft request, with the status the panel needs to word it.
 */
export class DraftRequestError extends Error {
  constructor(status, body) {
    super(body?.error ?? `Request failed (${status})`);
    this.name = 'DraftRequestError';
    this.status = status;
    this.body = body ?? {};
  }
}

/**
 * Ask the server for an application draft. One credit.
 *
 * The body is built by drafts.js and carries the job text and the profile
 * fields a draft needs - the only time anything personal leaves the browser,
 * and only because you pressed the button. The reply is the draft, the subject
 * line if the job demanded one, and the balance after the charge.
 *
 * Not through call(): the panel needs the status code to say the right thing
 * (no credits / already charged / refunded), not a flattened message.
 *
 * @returns {Promise<{draft: string, subject: string|null, credits: number, model: string}>}
 * @throws {DraftRequestError}
 */
export async function requestDraft(body) {
  // Through the service worker, not straight from here. A content script runs
  // on the site's https page, and the dev API is http://localhost - fetching
  // that from an https page is mixed content and is blocked. The worker runs at
  // the extension's own origin, holds the host permission, and has neither
  // problem. It also keeps the token in one place. The popup could fetch
  // directly, but routing both the same way keeps one path to reason about.
  let reply;
  try {
    reply = await chrome.runtime.sendMessage({ type: 'draft-request', body });
  } catch {
    throw new DraftRequestError(0, { error: 'unreachable' });
  }
  if (!reply) throw new DraftRequestError(0, { error: 'unreachable' });

  const { status, data = {} } = reply;
  if (status === 401) await clearAuth();
  if (status < 200 || status >= 300) throw new DraftRequestError(status, data);

  return {
    draft: String(data.draft ?? ''),
    subject: typeof data.subject === 'string' && data.subject ? data.subject : null,
    credits: Number.isFinite(data.credits) ? data.credits : null,
    model: String(data.model ?? ''),
  };
}

/**
 * The draft fetch itself, run in the service worker.
 *
 * Reads the token from storage rather than taking it from the message, so a
 * page cannot ask the worker to spend someone else's credits by passing a
 * token. Returns a plain {status, data} for requestDraft to interpret.
 */
export async function performDraftFetch(body) {
  const auth = await loadAuth();
  if (!auth) return { status: 401, data: { error: 'unauthorized' } };

  try {
    const response = await fetch(`${API_BASE}/api/drafts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token}` },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } catch {
    return { status: 0, data: { error: 'unreachable' } };
  }
}

/**
 * Ask the server to analyse a job through one lens. Costs the lens's price.
 *
 * Same shape as requestDraft and for the same reasons: routed through the
 * service worker (mixed-content + one token), and the panel needs the status
 * code to word "no credits" / "already charged" / "refunded" itself.
 *
 * @returns {Promise<{lens: string, analysis: object, credits: number|null, model: string}>}
 * @throws {DraftRequestError}
 */
export async function requestAnalysis(body) {
  let reply;
  try {
    reply = await chrome.runtime.sendMessage({ type: 'analyze-request', body });
  } catch {
    throw new DraftRequestError(0, { error: 'unreachable' });
  }
  if (!reply) throw new DraftRequestError(0, { error: 'unreachable' });

  const { status, data = {} } = reply;
  if (status === 401) await clearAuth();
  if (status < 200 || status >= 300) throw new DraftRequestError(status, data);

  return {
    lens: String(data.lens ?? ''),
    analysis: data.analysis && typeof data.analysis === 'object' ? data.analysis : {},
    credits: Number.isFinite(data.credits) ? data.credits : null,
    model: String(data.model ?? ''),
  };
}

/** The analyse fetch itself, in the service worker. Token from storage, never
   from the message, so a page cannot spend someone else's credits. */
export async function performAnalyzeFetch(body) {
  const auth = await loadAuth();
  if (!auth) return { status: 401, data: { error: 'unauthorized' } };

  try {
    const response = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token}` },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } catch {
    return { status: 0, data: { error: 'unreachable' } };
  }
}

/**
 * Start a credit purchase. Returns the PayMongo hosted-checkout URL for the
 * caller to open; credits are granted server-side by the webhook after payment,
 * never by the client.
 *
 * @returns {Promise<{checkoutUrl: string, credits: number, amount: number, currency: string, balance: number|null}>}
 * @throws {DraftRequestError}
 */
export async function requestCheckout() {
  let reply;
  try {
    reply = await chrome.runtime.sendMessage({ type: 'checkout-request' });
  } catch {
    throw new DraftRequestError(0, { error: 'unreachable' });
  }
  if (!reply) throw new DraftRequestError(0, { error: 'unreachable' });

  const { status, data = {} } = reply;
  if (status === 401) await clearAuth();
  if (status < 200 || status >= 300) throw new DraftRequestError(status, data);

  return {
    checkoutUrl: String(data.checkoutUrl ?? ''),
    credits: Number.isFinite(data.credits) ? data.credits : null,
    amount: Number.isFinite(data.amount) ? data.amount : null,
    currency: String(data.currency ?? 'PHP'),
    balance: Number.isFinite(data.balance) ? data.balance : null,
  };
}

/** The checkout fetch itself, in the service worker. Token from storage. */
export async function performCheckoutFetch() {
  const auth = await loadAuth();
  if (!auth) return { status: 401, data: { error: 'unauthorized' } };

  try {
    const response = await fetch(`${API_BASE}/api/credits/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token}` },
      body: '{}',
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } catch {
    return { status: 0, data: { error: 'unreachable' } };
  }
}

/**
 * Attest an OnlineJobs.ph account email to the server, verifying this account.
 *
 * The email is read from your OLJ account-settings page (see olj-account.js) and
 * posted to /api/account/verify. When it matches the email you registered with,
 * the account is verified and the one-time welcome credits are granted; a
 * mismatch (403) leaves it unverified and is reported so the UI can say so.
 * Routed through the worker for the same reasons drafts are: one token, read
 * from storage, and no mixed-content/cross-origin trouble.
 *
 * @returns {Promise<{verified: boolean, welcomeGranted: boolean, credits: number|null}>}
 */
export async function requestVerify(oljEmail) {
  let reply;
  try {
    reply = await chrome.runtime.sendMessage({ type: 'verify-request', oljEmail });
  } catch {
    throw new Error('Could not reach the server. Is it running?');
  }
  if (!reply) throw new Error('Could not reach the server. Is it running?');

  const { status, data = {} } = reply;
  if (status === 401) {
    await clearAuth();
    throw new Error('That session has ended. Sign in again.');
  }
  if (status === 403) {
    // The attested OLJ email did not match the registration email.
    return { verified: false, welcomeGranted: false, credits: null };
  }
  if (status < 200 || status >= 300) {
    throw new Error(data.error ?? `Request failed (${status})`);
  }

  return {
    verified: Boolean(data.verified),
    welcomeGranted: Boolean(data.welcomeGranted),
    credits: Number.isFinite(data.credits) ? data.credits : null,
  };
}

/** The verify POST itself, in the worker. Token from storage, never the message. */
export async function performVerifyFetch(oljEmail) {
  const auth = await loadAuth();
  if (!auth) return { status: 401, data: { error: 'unauthorized' } };

  try {
    const response = await fetch(`${API_BASE}/api/account/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ oljEmail: String(oljEmail ?? '') }),
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } catch {
    return { status: 0, data: { error: 'unreachable' } };
  }
}

/**
 * Soft-delete this account on the server, then clear the local session.
 *
 * The server keeps the row for anti-abuse (so welcome/referral credits cannot be
 * re-earned by deleting and recreating) but revokes every session; clearing the
 * local token here signs the extension out to match.
 */
export async function deleteAccount() {
  let reply;
  try {
    reply = await chrome.runtime.sendMessage({ type: 'delete-account' });
  } catch {
    throw new Error('Could not reach the server. Is it running?');
  }
  if (!reply) throw new Error('Could not reach the server. Is it running?');

  const { status, data = {} } = reply;
  // 401 means the session was already gone; either way the account is no longer
  // reachable from here, so clear local auth and treat it as done.
  if (status !== 401 && (status < 200 || status >= 300)) {
    throw new Error(data.error ?? `Request failed (${status})`);
  }

  await clearAuth();
  return true;
}

/** The delete request itself, in the worker. Token from storage. */
export async function performDeleteFetch() {
  const auth = await loadAuth();
  if (!auth) return { status: 401, data: { error: 'unauthorized' } };

  try {
    const response = await fetch(`${API_BASE}/api/account`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${auth.token}` },
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } catch {
    return { status: 0, data: { error: 'unreachable' } };
  }
}

export async function signOut() {
  const auth = await loadAuth();
  if (auth) {
    // Best effort: the local token goes either way, but telling the server lets
    // it drop the row so a copied token cannot outlive the sign-out.
    await call('/api/auth/sign-out', { method: 'POST', token: auth.token }).catch(() => {});
  }
  return clearAuth();
}
