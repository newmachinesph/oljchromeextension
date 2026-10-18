/**
 * Turning an uploaded résumé into markdown, in the browser.
 *
 * A PDF, a Word document or a text file becomes the body of a profile without
 * ever leaving the machine: the extractors run here, on the options page, not
 * on a server. That keeps the promise the profile makes - the most personal
 * thing the extension holds, and it stays local.
 *
 * The heavy parsers (pdfjs, mammoth) are dynamic-imported so they load only
 * when a file is actually imported, not on every options page open. The
 * extractors are injectable, so the dispatch and normalisation are tested with
 * fakes and the real adapters are verified live.
 */

const BODY_MAX = 20000;

export const SUPPORTED_HINT = 'PDF, Word (.docx), or text (.txt, .md)';

/** Tidy extracted text into a body we can store. Pure. */
export function normalizeImportedMarkdown(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, BODY_MAX);
}

/** Read a text file's contents, in jsdom (no Blob.text) or the browser. */
function readText(file) {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function extensionOf(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name ?? ''));
  return match ? match[1].toLowerCase() : '';
}

/**
 * The real extractors, loaded lazily so pdfjs and mammoth stay out of the
 * options page's main bundle and out of the unit-test module graph.
 */
async function realDeps() {
  return import('./import-adapters.js');
}

/**
 * Convert a File to markdown.
 *
 * @param {File} file
 * @param {{extractPdf?: Function, extractDocx?: Function}} [deps]
 * @returns {Promise<{markdown: string, source: 'pdf'|'docx'|'text'}>}
 */
export async function importFile(file, deps) {
  const use = deps ?? (await realDeps());
  const type = file?.type ?? '';
  const ext = extensionOf(file?.name);

  if (type === 'application/pdf' || ext === 'pdf') {
    return { markdown: normalizeImportedMarkdown(await use.extractPdf(file)), source: 'pdf' };
  }
  if (
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    return { markdown: normalizeImportedMarkdown(await use.extractDocx(file)), source: 'docx' };
  }
  if (type.startsWith('text/') || ext === 'txt' || ext === 'md' || ext === 'markdown') {
    return { markdown: normalizeImportedMarkdown(await readText(file)), source: 'text' };
  }

  throw new Error(`Unsupported file type. Use ${SUPPORTED_HINT}.`);
}
