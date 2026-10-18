/**
 * The site's own search URL, built the way its form builds it.
 *
 * Lives in core rather than with the page code because two callers need it
 * that have no page: the service worker re-running a saved search for alerts,
 * and the popup opening one. Pure - nothing here fetches.
 */

export const SITE_ORIGIN = 'https://www.onlinejobs.ph';

/**
 * Mirrors what the site's own search form submits, including the job-type
 * flags and isFromJobsearchForm. skill_tags is left empty on purpose: the site
 * keys it by numeric skill IDs, which we deliberately do not depend on - skill
 * filtering happens in the page instead.
 *
 * @returns {string} a path, relative to the site origin
 */
export function searchUrl(keyword, offset = 0) {
  const query = new URLSearchParams({
    jobkeyword: keyword,
    skill_tags: '',
    gig: 'on',
    partTime: 'on',
    fullTime: 'on',
    isFromJobsearchForm: '1',
  });
  return `/jobseekers/jobsearch/${offset}?${query}`;
}

/** The same, absolute, for a context with no page to resolve against. */
export function absoluteSearchUrl(keyword, offset = 0) {
  return `${SITE_ORIGIN}${searchUrl(keyword, offset)}`;
}
