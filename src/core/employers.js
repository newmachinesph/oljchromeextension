/**
 * Who is posting, and what they have posted twice.
 *
 * Two facts a merged list hides. Measured on 180 live listings: 12 employers
 * accounted for 33 of them, and several had posted the same role more than once
 * - one of them eight times. Neither is visible when you are reading a flat
 * list one card at a time.
 *
 * Pure: given the listing facts, it says what repeats. Nothing here touches the
 * DOM or storage, so the rule that decides whether a job is a repost can be
 * tested without a browser.
 */

/**
 * The site writes employer names by hand, so the same person appears as
 * "Young Publisher", "young publisher" and "Young Publisher " across cards.
 * Compared on a normalized key, but always *displayed* as it was written.
 */
export function employerKey(name) {
  const key = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  // "Not Given" is the site's own placeholder for an employer who withheld
  // their name, and people type "N/A" or "Confidential" to the same effect.
  // Treated as no name at all: otherwise every anonymous poster on the page
  // would be one employer, their titles would collapse into reposts, and a
  // block on one would block them all.
  return PLACEHOLDER_NAMES.test(key) ? '' : key;
}

const PLACEHOLDER_NAMES =
  /^(?:not\s*given|n\s*a|none|nil|null|unknown|confidential|anonymous|private|undisclosed|no\s*name|not\s*(?:specified|provided|available|stated))?$/;

/**
 * A title reduced to what it would still be after an edit.
 *
 * Case, punctuation, emoji and runs of whitespace all go. The pay is stripped
 * too: employers routinely repost the identical role with the figure nudged -
 * "$900 p/m" becoming "$1,000 p/m" - and that is the same job, not a new one.
 */
export function titleKey(title) {
  return String(title ?? '')
    .toLowerCase()
    // Money, in any of the forms the site's titles use.
    .replace(/[$₱£€]\s*[\d,.]+\s*(k|per\s*\w+|p\/\w+|\/\w+)?/g, ' ')
    .replace(/[\d,.]+\s*(usd|php|aud|cad|gbp|eur)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Group listings by who posted them.
 *
 * @param {Array<{jobKey: string, employer: string|null}>} listings
 * @returns {Map<string, {name: string, jobKeys: string[]}>} keyed by employerKey
 */
export function groupByEmployer(listings) {
  const groups = new Map();

  for (const listing of listings ?? []) {
    const key = employerKey(listing?.employer);
    if (key.length === 0) continue;

    const group = groups.get(key);
    if (group) group.jobKeys.push(listing.jobKey);
    // The first spelling seen wins, so the chip reads the way the card does.
    else groups.set(key, { name: String(listing.employer).trim(), jobKeys: [listing.jobKey] });
  }

  return groups;
}

/**
 * How many listings each employer has on this page, by job key.
 *
 * @returns {Map<string, {name: string, count: number}>} keyed by jobKey
 */
export function employerCounts(listings) {
  const counts = new Map();

  for (const { name, jobKeys } of groupByEmployer(listings).values()) {
    for (const jobKey of jobKeys) counts.set(jobKey, { name, count: jobKeys.length });
  }

  return counts;
}

/**
 * The same job, posted more than once.
 *
 * Deliberately strict: the same employer *and* the same title once pay and
 * punctuation are discounted. No fuzzy matching, because the two failures are
 * not equal - showing a duplicate wastes a second of your time, and hiding a
 * job that was never a duplicate costs you the job. "Instagram Admin" and
 * "Instagram Manager" from one agency stay two listings.
 *
 * An employer is required. Identical generic titles - "Virtual Assistant",
 * "Construction Estimator" - are ordinary across different employers, and
 * matching on title alone would collapse unrelated postings.
 *
 * The first of a group is kept. Order is the caller's, which on a merged page
 * is the site's own ordering, so the surviving copy is the one the site ranked
 * highest rather than an arbitrary pick.
 *
 * @returns {Map<string, {of: string, size: number}>} the repeats only, keyed by
 *   jobKey: `of` is the jobKey of the copy being kept
 */
export function findReposts(listings) {
  const firstSeen = new Map();
  const repeats = new Map();
  const sizes = new Map();

  for (const listing of listings ?? []) {
    const employer = employerKey(listing?.employer);
    const title = titleKey(listing?.title);
    if (employer.length === 0 || title.length === 0) continue;

    const key = `${employer} ${title}`;
    const original = firstSeen.get(key);

    if (original === undefined) {
      firstSeen.set(key, listing.jobKey);
      sizes.set(key, 1);
      continue;
    }

    sizes.set(key, sizes.get(key) + 1);
    repeats.set(listing.jobKey, { of: original, key });
  }

  // Second pass so every repeat carries the final group size, not the size at
  // the moment it happened to be seen.
  for (const [jobKey, repeat] of repeats) {
    repeats.set(jobKey, { of: repeat.of, size: sizes.get(repeat.key) });
  }

  return repeats;
}

/** "3 jobs from this employer", or nothing when they only posted the one. */
export function describeEmployer(entry) {
  if (!entry || entry.count < 2) return '';
  return `${entry.count} jobs from ${entry.name} on this page`;
}
