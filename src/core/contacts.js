/**
 * Contact details an employer wrote into the description.
 *
 * Plenty of postings say "email us at hiring@acme.com" rather than using the
 * site's apply button, and copying that address out of a paragraph by hand is
 * the kind of small friction worth removing. Read from the text you are
 * already looking at; never from anywhere else.
 *
 * Conservative: a real-looking domain with a dot and a plausible top-level
 * part. "image@2x.png" and "user@localhost" are not addresses anyone applies
 * to. Deduplicated case-insensitively, returned as first written.
 */

const MAX_EMAILS = 5;

const EMAIL =
  /(?<![\w.+-])([A-Za-z0-9][A-Za-z0-9._%+-]{0,63})@([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24})\b/g;

/** File-ish suffixes that look like a domain but are not. */
const NOT_A_DOMAIN = /\.(png|jpe?g|gif|webp|svg|pdf|docx?|xlsx?|zip|mp4|mov)$/i;

/**
 * @param {string} text
 * @returns {string[]}
 */
export function findEmails(text) {
  const source = String(text ?? '');
  if (source.length === 0) return [];

  const seen = new Set();
  const found = [];

  for (const match of source.matchAll(EMAIL)) {
    const address = match[0].replace(/[.,;:!?)]+$/, '');
    const domain = address.slice(address.indexOf('@') + 1);
    if (NOT_A_DOMAIN.test(domain)) continue;

    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(address);
    if (found.length >= MAX_EMAILS) break;
  }

  return found;
}
