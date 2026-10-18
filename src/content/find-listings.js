/**
 * Locating job listings on the search page.
 *
 * Hybrid by design: try known selectors first, fall back to a structural walk
 * from the job links when those miss. Which path ran is reported back so the
 * control bar can say so out loud instead of failing silently.
 */

import { jobKey } from '../core/dismissed.js';

/**
 * Selectors observed on onlinejobs.ph. If the site reskins, the fallback keeps
 * working and this list is the one thing that needs re-pinning.
 */
const CANDIDATE_SELECTORS = [
  '.jobpost-cat-box',
  '.jobpost-cat-box-container',
  '[class*="jobpost"]',
];

const JOB_LINK_SELECTOR = 'a[href*="/jobseekers/job/"]';

/**
 * Who posted the job.
 *
 * Written as a bare text node before the "Posted on ..." <em>, separated by a
 * bullet: `<p data-temp="..."> Noah Jenkins • <em>Posted on ...</em></p>`.
 * Plenty of listings omit it, so absence is normal rather than a parse failure.
 *
 * Only on the results card - the job page itself names no employer anywhere,
 * checked across eight live postings.
 */
export function extractEmployer(element) {
  const block = element.querySelector('[data-temp]');
  if (!block) return null;

  const lead = Array.from(block.childNodes)
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent)
    .join(' ');

  const name = normalizeWhitespace(lead).replace(/[•·|,\s]+$/, '').trim();
  return name.length > 0 ? name : null;
}

/** The listing's own URL, used to key what you have already dismissed. */
export function extractHref(element) {
  return element.querySelector(JOB_LINK_SELECTOR)?.getAttribute('href') ?? null;
}

/** Labels that mark where the salary value ends and the next field begins. */
const NEXT_FIELD =
  /(hours?\s*per\s*week|hrs?\s*\/?\s*week|job\s*type|type\s*of\s*work|date\s*posted|posted\s*on|id\s*proof|employer|apply\s*now|save\s*job)/i;

/**
 * How the search page actually marks the rate: a dollar icon in the <dt>, with
 * the value in the sibling <dd>. There is no "Salary:" text label anywhere.
 */
const RATE_ICON = '.icon-round-dollar, [class*="round-dollar"]';

/** The real field is labelled with a colon; prose only ever mentions the word. */
const SALARY_LABEL_STRICT = /salary\s*[:\-]\s*/i;
const SALARY_LABEL_LOOSE = /\bsalary\b\s*/i;

/** What a salary value can look like. Guards the loose label against prose. */
const LOOKS_LIKE_RATE = /[\d$₱]|not\s*specified|negotiable|tbd|doe/i;

const MIN_LISTINGS_FOR_SELECTOR = 3;

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Pull just the salary field out of a listing.
 *
 * Scoped deliberately: never hand the whole card to the parser, because "PHP"
 * on this site is as often the programming language as it is the peso.
 *
 * @returns {string|null} the salary snippet, or null when the card has no salary field
 */
export function extractRateText(element) {
  // Preferred path: the icon-marked definition list. When that anchor exists it
  // is authoritative - an empty value means "no rate given", not "look harder",
  // and looking harder would drag in the job description.
  const icon = element.querySelector(RATE_ICON);
  if (icon) {
    const value = normalizeWhitespace(
      (icon.closest('dt')?.nextElementSibling ?? icon.parentElement?.nextElementSibling)
        ?.textContent,
    );
    return value.length > 0 ? value : null;
  }

  const text = normalizeWhitespace(element.textContent);

  const strict = text.match(SALARY_LABEL_STRICT);
  const label = strict ?? text.match(SALARY_LABEL_LOOSE);
  if (!label) return null;

  const start = label.index + label[0].length;
  const after = text.slice(start, start + 64);
  const boundary = after.match(NEXT_FIELD);
  const value = normalizeWhitespace(boundary ? after.slice(0, boundary.index) : after);

  if (value.length === 0) return null;
  // Without the colon we only have the bare word "salary", which turns up in
  // prose too ("competitive salary offered"). Demand something rate-shaped.
  if (!strict && !LOOKS_LIKE_RATE.test(value)) return null;

  return value;
}

/** The job-type chip. Note "Any" and "Gig" share a CSS class, so read the text. */
const JOB_TYPE_BADGE = 'span.badge';

const JOB_TYPE_SLUGS = {
  'full time': 'full-time',
  'part time': 'part-time',
  gig: 'gig',
  gigs: 'gig',
  any: 'any',
};

/**
 * "Full Time" -> "full-time".
 *
 * Shared with the job page, which states the same four types under a heading
 * rather than in a chip - and which must agree with the list about them, since
 * the type decides how a bare rate is read.
 */
export function jobTypeSlug(label) {
  return JOB_TYPE_SLUGS[String(label ?? '').trim().toLowerCase()] ?? null;
}

export function extractTitle(element) {
  const heading = element.querySelector('h1, h2, h3, h4, h5');
  if (heading) {
    // The heading also contains the job-type chip; drop it so the title reads clean.
    const badge = normalizeWhitespace(heading.querySelector(JOB_TYPE_BADGE)?.textContent);
    let text = normalizeWhitespace(heading.textContent);
    if (badge && text.endsWith(badge)) text = normalizeWhitespace(text.slice(0, -badge.length));
    if (text) return text;
  }

  const text = normalizeWhitespace(element.querySelector(JOB_LINK_SELECTOR)?.textContent);
  return text || '(untitled listing)';
}

/**
 * The site's own rate line: the definition list holding the dollar icon and the
 * raw rate text. Returned so it can be hidden once our badge states the same
 * figure in one comparable unit.
 */
export function findRateBlock(element) {
  const icon = element.querySelector(RATE_ICON);
  return icon?.closest('dl') ?? null;
}

/**
 * The skill chips already printed on the card ("Real Estate", "Data Entry").
 *
 * Read from the DOM on purpose: the site's own skill filter is keyed by numeric
 * skill IDs, so matching client-side against these labels avoids needing them.
 */
export function extractSkills(element) {
  return Array.from(
    element.querySelectorAll('a[href*="/jobseekers/search/c/"]'),
    (link) => normalizeWhitespace(link.textContent),
  ).filter(Boolean);
}

/** @returns {'full-time'|'part-time'|'gig'|'any'|null} */
/**
 * "Hours per week", as the card states it.
 *
 * Matters more than it looks. An hourly rate is converted to a monthly figure
 * by multiplying by hours, and assuming full time turns "$5/hour, 20 hrs/week"
 * into $800/month when it is really $433 - so a part-time listing outranks a
 * full-time one that genuinely pays more.
 *
 * Two spellings on this site: a labelled field, and free text in the body.
 * Absent on plenty of cards, which is why the settings default remains.
 */
export function extractHoursPerWeek(element) {
  const text = normalizeWhitespace(element.textContent);

  const labelled = /hours?\s*per\s*week\s*:?\s*(\d{1,3})/i.exec(text);
  const inline = /(\d{1,3})\s*\+?\s*(?:hours?|hrs?)\s*(?:per|\/|a)\s*week/i.exec(text);

  const raw = labelled?.[1] ?? inline?.[1];
  if (raw === undefined) return null;

  const hours = Number(raw);
  // A week has 168 hours; anything at or beyond that is a misread, not a job.
  return Number.isFinite(hours) && hours > 0 && hours < 100 ? hours : null;
}

export function extractJobType(element) {
  const label = normalizeWhitespace(
    element.querySelector(JOB_TYPE_BADGE)?.textContent,
  ).toLowerCase();
  return JOB_TYPE_SLUGS[label] ?? null;
}

/**
 * When the listing was posted, as epoch milliseconds.
 *
 * The site ships a machine-readable "2026-08-17 16:50:36" in data-temp, which
 * beats parsing the human "Posted on ..." text. Every card carries one.
 */
export function extractPostedAt(element) {
  const raw = element.querySelector('[data-temp]')?.getAttribute('data-temp');
  if (!raw) return null;
  const parsed = Date.parse(raw.trim().replace(' ', 'T'));
  return Number.isFinite(parsed) ? parsed : null;
}

function bySelector(root) {
  for (const selector of CANDIDATE_SELECTORS) {
    let nodes;
    try {
      nodes = Array.from(root.querySelectorAll(selector));
    } catch {
      continue;
    }

    // Only trust a selector that finds a plausible number of cards, each of
    // which actually links to a job. Otherwise it matched a wrapper, not cards.
    const cards = nodes.filter((node) => node.querySelector(JOB_LINK_SELECTOR));
    if (cards.length >= MIN_LISTINGS_FOR_SELECTOR) return cards;
  }
  return [];
}

/**
 * Climb from each job link until the ancestor starts swallowing other listings,
 * then step back one. That ancestor is the card.
 */
function byStructure(root) {
  const links = Array.from(root.querySelectorAll(JOB_LINK_SELECTOR));
  const cards = new Set();

  for (const link of links) {
    let node = link;
    let best = link;

    for (let depth = 0; depth < 8; depth += 1) {
      const parent = node.parentElement;
      if (!parent || parent.tagName === 'BODY') break;
      if (parent.querySelectorAll(JOB_LINK_SELECTOR).length > 1) break;
      best = parent;
      node = parent;
    }

    if (best !== link) cards.add(best);
  }

  return Array.from(cards);
}

/**
 * @returns {{source: 'selector'|'structure'|'none', listings: Array, warning: string|null}}
 */
export function findListings(root = document) {
  let elements = bySelector(root);
  let source = elements.length > 0 ? 'selector' : 'none';

  if (elements.length === 0) {
    elements = byStructure(root);
    source = elements.length > 0 ? 'structure' : 'none';
  }

  const listings = elements.map((element) => {
    const href = extractHref(element);
    return {
      element,
      href,
      // Stable across title edits and across the pages a merge pulled it from.
      jobKey: jobKey(href),
      title: extractTitle(element),
      rateText: extractRateText(element),
      employer: extractEmployer(element),
      jobType: extractJobType(element),
      hoursPerWeek: extractHoursPerWeek(element),
      postedAt: extractPostedAt(element),
      rateBlock: findRateBlock(element),
      descBlock: element.querySelector('.desc'),
      // Second row - the "Posted on ..." line - rather than the title row, which
      // already carries the site's job-type chip.
      badgeHost: element.querySelector('[data-temp]') ?? null,
      skills: extractSkills(element),
      // The whole card, for matching search terms the way the site does - it
      // searches descriptions too, so title-only matching would drop real hits.
      searchText: normalizeWhitespace(element.textContent).toLowerCase().slice(0, 4000),
      // Set by a keyword merge on the listings that search returned. The card
      // is only an excerpt, so this attribute is the one place the site's own
      // verdict on the full post survives - see SEARCH_HIT_ATTR in prefetch.js.
      searchHit: element.hasAttribute('data-ojrf-search-hit'),
    };
  });

  let warning = null;
  if (listings.length === 0) {
    warning = 'No job listings found on this page - filtering is inactive.';
  } else {
    const withRate = listings.filter((listing) => listing.rateText !== null).length;
    if (withRate / listings.length < 0.1) {
      warning = 'Found listings but almost no salary fields - the parser may be out of date.';
    }
  }

  return { source, listings, warning };
}

/** Deepest element that contains every listing, used to place the control bar. */
export function findResultsContainer(listings) {
  if (listings.length === 0) return null;

  let container = listings[0].element.parentElement;
  while (container && !listings.every((listing) => container.contains(listing.element))) {
    container = container.parentElement;
  }
  return container;
}
