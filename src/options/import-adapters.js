/**
 * The real file extractors: pdfjs for PDFs, mammoth for Word.
 *
 * Kept apart from import-file.js so the dispatch logic can be unit-tested with
 * fakes without vitest trying to resolve these heavy, browser-only imports.
 * import-file.js loads this module lazily, only when a real import runs.
 */

/** Read every page's text out of a PDF, in the browser. */
export async function extractPdf(file) {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return pages.join('\n\n');
}

/** Word to plain text (mammoth's markdown mode is experimental; raw text is stable). */
export async function extractDocx(file) {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}
