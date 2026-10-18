/**
 * What the job page says about who is hiring.
 *
 * Read only from a page you opened yourself. The employer block lives on the
 * job page rather than the results card, and fetching one per listing to mine
 * it would be exactly the crawling pattern this extension is careful to avoid -
 * so this runs on the document the modal already has, and never on its own.
 *
 * Two things worth surfacing:
 *
 * 1. A brand new account. Everyone is new once and a new account is not a scam,
 *    but a new account paired with an unusually high rate is the shape most
 *    scams here take. Stated as a fact with a date, not as an accusation.
 *
 * 2. Contact details stripped out of the post. onlinejobs.ph removes links and
 *    email addresses from listings by employers without a paid account, so
 *    finding those markers says something about the employer as well as
 *    explaining why the post reads as though something is missing.
 *
 * The patterns below are the site's wording as we understand it, and are
 * ordinary data - meant to be corrected against a live page rather than
 * defended. Each returns nothing rather than guessing when it does not match.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Under this, the account is new enough to be worth mentioning. */
export const NEW_ACCOUNT_DAYS = 60;

/** The block naming the employer, however the page happens to head it. */
const ABOUT_HEADING = /about the employer|about employer|employer information/i;

/**
 * Month names spelled out rather than "a capitalised word".
 *
 * The loose version matched the word "since" itself under the /i flag, so
 * "Member since 2026-08-01" was read as the bare year 2026 - eight months
 * wrong, and wrong in the direction that makes a new account look established.
 */
const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?`;
// "Member since: July 27, 2026" - the colon comes after the word, not instead
// of it, which the first version did not allow, so the warning never fired.
const LEAD = String.raw`(?:member|joined|registered)\s*(?:since|on)?\s*:?\s*`;

/** "Member since May 2026", "Joined 12 August 2026", "Registered: 2026-08-01". */
const JOINED_PATTERNS = [
  // Unambiguous first, so a looser pattern cannot claim it.
  new RegExp(LEAD + String.raw`(\d{4}-\d{2}-\d{2})`, 'i'),
  new RegExp(LEAD + `(${MONTH}` + String.raw`\s+\d{1,2},?\s+\d{4})`, 'i'),
  new RegExp(LEAD + String.raw`(\d{1,2}\s+` + MONTH + String.raw`\s+\d{4})`, 'i'),
  new RegExp(LEAD + `(${MONTH}` + String.raw`\s+\d{4})`, 'i'),
];

/**
 * The text of the employer block, or the whole page when it is not found.
 *
 * Falling back to the page rather than giving up: the heading has changed
 * before, and a date read from slightly too much text beats no date at all.
 */
const SAYS_JOINED = /(member|joined|registered)/i;

export function employerBlockText(doc) {
  if (!doc) return '';

  for (const node of doc.querySelectorAll('h1, h2, h3, h4, h5, strong, .card-header')) {
    if (!ABOUT_HEADING.test(node.textContent ?? '')) continue;

    // Widen until the block actually holds the account details. On the live
    // page the heading's nearest div is the heading alone - the date sits in a
    // sibling - so taking the first container found returned a block with
    // nothing in it and the account age was never read.
    let container = node.closest('section, .card, .panel, div') ?? node.parentElement;
    for (let step = 0; step < 4 && container; step += 1) {
      const text = (container.textContent ?? '').replace(/\s+/g, ' ');
      if (SAYS_JOINED.test(text)) return text;
      container = container.parentElement;
    }
  }

  return String(doc.body?.textContent ?? '').replace(/\s+/g, ' ');
}

/**
 * When this employer's account was created.
 *
 * @returns {number|null} epoch ms, or null when the page does not say
 */
export function readJoinedAt(doc) {
  const text = employerBlockText(doc);
  if (text.length === 0) return null;

  for (const pattern of JOINED_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;

    const parsed = Date.parse(match[1]);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

/**
 * How new this account is, if it is new at all.
 *
 * @returns {{days: number, joinedAt: number}|null} null when the account is
 *   established, or when the page never said
 */
export function newAccountWarning(joinedAt, now = Date.now(), limitDays = NEW_ACCOUNT_DAYS) {
  if (!Number.isFinite(joinedAt)) return null;

  const days = Math.floor((now - joinedAt) / MS_PER_DAY);
  // A date in the future is a misread, not a very new account.
  if (days < 0 || days > limitDays) return null;

  return { days, joinedAt };
}

/** Plain wording, stating the fact rather than drawing the conclusion. */
export function describeNewAccount(warning) {
  if (!warning) return '';

  const { days } = warning;
  const age =
    days <= 1 ? 'today' : days < 14 ? `${days} days ago` : `${Math.floor(days / 7)} weeks ago`;

  return `Employer account created ${age}. Everyone is new once, but a new account paired with an unusually high rate is worth a second look.`;
}

/**
 * Markers the site leaves where it removed a link or an address.
 *
 * It strips those from listings by employers without a paid account, so
 * finding them says something about the employer as well as explaining the gap.
 */
/*
 * NOT matched on text. The site ships its "Why is this blurred?" explainer in
 * the markup of every job page and only renders it for free accounts, so a
 * text search finds it on paid postings too - which it did, and warned about a
 * posting whose email and links were plainly visible. Presence is decided by
 * layout instead, in hasBlurredBlock below.
 */
const CENSOR_PATTERNS = [
  /\[?\s*(link|links|url|website)s?\s+(removed|deleted|hidden)\s*\]?/i,
  /\[?\s*(email|e-mail|address|contact\s+details?|contact\s+info(?:rmation)?)\s+(removed|deleted|hidden)\s*\]?/i,
  /\b(upgrade|paid)\s+(?:to\s+)?(?:account|membership)\s+to\s+(?:see|view)\b/i,
];

/** The classes the site puts on a blurred block. */
const BLUR_SELECTOR = '.div-blurred-text, .on-blurred-text';

/** Whether the post has had contact details stripped out. */
export function hasCensoredContact(text) {
  const haystack = String(text ?? '');
  if (haystack.length === 0) return false;

  return CENSOR_PATTERNS.some((pattern) => pattern.test(haystack));
}

/**
 * Whether a blurred block is actually on screen.
 *
 * Presence in the markup means nothing: the explainer is shipped on every job
 * page and hidden with display:none unless the employer is on a free account.
 * Only layout distinguishes the two, so only layout is trusted.
 *
 * A document from DOMParser has no layout at all, so this cannot be decided
 * there and returns false. Saying nothing is the right failure for a signal
 * whose false positive accuses a legitimate employer.
 */
export function hasBlurredBlock(doc) {
  if (!doc?.defaultView) return false;

  for (const node of doc.querySelectorAll(BLUR_SELECTOR)) {
    const box = node.getBoundingClientRect?.();
    if (box && (box.width > 0 || box.height > 0)) return true;
  }

  return false;
}

export function describeCensoredContact() {
  return 'Links and contact details were removed from this post, which the site does for employers without a paid account.';
}

/** "Total Job Posts: 1" - a first-time poster, stated beside the account age. */
export function readTotalPosts(doc) {
  const match = /total\s+job\s+posts?\s*:?\s*(\d{1,5})/i.exec(employerBlockText(doc));
  if (!match) return null;

  const total = Number(match[1]);
  return Number.isFinite(total) && total > 0 ? total : null;
}

/**
 * Everything the page will say about the employer.
 *
 * @returns {{newAccount: object|null, censored: boolean, totalPosts: number|null,
 *   notes: string[]}}
 */
export function readEmployerSignals(doc, now = Date.now()) {
  const newAccount = newAccountWarning(readJoinedAt(doc), now);
  const censored = hasCensoredContact(doc?.body?.textContent) || hasBlurredBlock(doc);
  const totalPosts = readTotalPosts(doc);

  const notes = [];
  if (newAccount) {
    const first = totalPosts === 1 ? ' This is their first job post.' : '';
    notes.push(describeNewAccount(newAccount) + first);
  }
  if (censored) notes.push(describeCensoredContact());

  return { newAccount, censored, totalPosts, notes };
}
