/**
 * Keep only a link we would let someone click.
 *
 * A stored url is not always ours: a backup file is a text file a person can
 * edit, and a manually added job takes a link the user typed. So a javascript:,
 * data:, or file: scheme must never survive to become a clickable href in the
 * options page, where it would run in the extension's own context.
 *
 * Relative links (the site's own "/jobseekers/job/…") resolve against the site
 * and pass; anything that resolves to a non-http(s) scheme is dropped to empty.
 */

const BASE = 'https://www.onlinejobs.ph';

export function cleanUrl(raw, max = 300) {
  const value = String(raw ?? '').trim().slice(0, max);
  if (!value) return '';
  try {
    const { protocol } = new URL(value, BASE);
    return protocol === 'http:' || protocol === 'https:' ? value : '';
  } catch {
    return '';
  }
}
