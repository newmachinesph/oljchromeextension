/**
 * Bringing your OnlineJobs résumé into a profile, by its link.
 *
 * The site keeps the résumé you uploaded; rather than make you download it and
 * import the file, the extension can fetch it straight from its link and run it
 * through the same in-browser converter. The fetch happens in the service
 * worker (the extension's own origin) and is fenced to OnlineJobs links only,
 * so nothing else can be pulled through this path.
 *
 * If the link needs your login and the worker cannot reach it, the import fails
 * cleanly and the plain "import from a file" path is always there as a fallback.
 */

/** Where the v2 helper stashes the résumé link it spots, for the editor to use. */
export const RESUME_URL_KEY = 'ojRateFilterResumeUrl';

/** Only an https OnlineJobs link may be fetched through the worker. */
export function isResumeUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && /(^|\.)onlinejobs\.ph$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** ArrayBuffer -> base64, chunked so a large file does not blow the call stack. */
export function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** base64 -> Uint8Array, to rebuild the file on the options page. */
export function base64ToBytes(base64) {
  const binary = atob(String(base64));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * A filename the importer can dispatch on, from the link and the content type.
 * A résumé is almost always a PDF, so that is the fallback.
 */
export function resumeFilename(url, contentType = '') {
  const type = String(contentType).toLowerCase();
  if (type.includes('wordprocessingml')) return 'resume.docx';
  if (type.startsWith('text/')) return 'resume.txt';
  if (type.includes('pdf')) return 'resume.pdf';
  const name = (() => {
    try {
      return new URL(String(url)).pathname.split('/').pop() || '';
    } catch {
      return '';
    }
  })();
  return /\.(pdf|docx|txt|md)$/i.test(name) ? name : 'resume.pdf';
}
