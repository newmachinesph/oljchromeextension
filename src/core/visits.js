/**
 * When you were last here, so the list can answer "what changed?".
 *
 * Every listing already carries the moment it was posted. Paired with the
 * moment you last looked, that turns a merged list of three hundred into the
 * handful you have not seen - which is the question someone checking daily is
 * actually asking.
 *
 * Two timestamps rather than one, because a reload is not a new visit. Refresh
 * the page four times while reading and the marker must not move, or "new"
 * empties out under you. So `seenAt` follows every load, and `since` only moves
 * when you have genuinely been away.
 */

const STORAGE_KEY = 'ojRateFilterVisit';

/**
 * How long away counts as leaving.
 *
 * Long enough to survive a reload, a tab switch and a coffee; short enough that
 * coming back after lunch shows you the morning's postings.
 */
export const SESSION_GAP_MS = 30 * 60 * 1000;

function sanitizeVisit(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    since: Number.isFinite(input.since) ? input.since : null,
    seenAt: Number.isFinite(input.seenAt) ? input.seenAt : null,
  };
}

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

/**
 * Work out the cutoff for this visit, given what was stored.
 *
 * Pure, so the session rule is testable without a clock or a browser.
 *
 * @returns {{since: number, seenAt: number}} the next state to store
 */
export function nextVisit(stored, now, gap = SESSION_GAP_MS) {
  const { since, seenAt } = sanitizeVisit(stored);

  // First time here. Nothing is marked new: every listing predates you, and a
  // page where all three hundred shout NEW says nothing at all.
  if (seenAt === null) return { since: now, seenAt: now };

  // Still the same sitting - keep the cutoff, so the set does not shift while
  // you are reading it.
  if (now - seenAt < gap) return { since: since ?? now, seenAt: now };

  // Been away. Anything posted since you were last here is new.
  return { since: seenAt, seenAt: now };
}

/**
 * Record this visit and return the cutoff to judge listings against.
 *
 * @returns {Promise<number>} epoch ms; a listing posted after this is new
 */
export async function markVisit(now = Date.now()) {
  if (!hasStorage()) return now;

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const next = nextVisit(stored?.[STORAGE_KEY], now);

  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next.since;
}

/** The cutoff without moving it - for anything that only wants to read. */
export async function readVisit() {
  if (!hasStorage()) return null;
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeVisit(stored?.[STORAGE_KEY]).since;
}

/** Treat everything as seen, from now. */
export async function clearVisit(now = Date.now()) {
  if (hasStorage()) {
    await chrome.storage.local.set({ [STORAGE_KEY]: { since: now, seenAt: now } });
  }
  return now;
}

/**
 * Is this listing newer than the cutoff?
 *
 * A listing with no date is never new: we cannot tell, and claiming it is would
 * put it in the one list you are trusting to be short.
 */
export function isNew(postedAt, since) {
  if (!Number.isFinite(postedAt) || !Number.isFinite(since)) return false;
  return postedAt > since;
}
