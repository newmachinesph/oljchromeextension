// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { normalizeImportedMarkdown, importFile } from '../src/options/import-file.js';

describe('normalizeImportedMarkdown', () => {
  it('trims, collapses blank runs, strips trailing spaces', () => {
    expect(normalizeImportedMarkdown('  hi   \n\n\n\nthere  \n')).toBe('hi\n\nthere');
  });

  it('caps very long text', () => {
    expect(normalizeImportedMarkdown('x'.repeat(50000)).length).toBeLessThanOrEqual(20000);
  });

  it('is empty for nothing', () => {
    expect(normalizeImportedMarkdown('')).toBe('');
    expect(normalizeImportedMarkdown(null)).toBe('');
  });
});

describe('importFile', () => {
  const fakes = {
    extractPdf: async () => 'pdf text',
    extractDocx: async () => 'docx text',
  };

  it('reads a text file directly', async () => {
    const file = new File(['hello there'], 'note.txt', { type: 'text/plain' });
    expect(await importFile(file, fakes)).toEqual({ markdown: 'hello there', source: 'text' });
  });

  it('reads a markdown file as text', async () => {
    const file = new File(['# Title'], 'cv.md', { type: '' });
    expect(await importFile(file, fakes)).toEqual({ markdown: '# Title', source: 'text' });
  });

  it('routes a PDF to extractPdf', async () => {
    const file = new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' });
    expect(await importFile(file, fakes)).toEqual({ markdown: 'pdf text', source: 'pdf' });
  });

  it('routes a DOCX to extractDocx', async () => {
    const file = new File(['PK'], 'cv.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(await importFile(file, fakes)).toEqual({ markdown: 'docx text', source: 'docx' });
  });

  it('refuses an unsupported type', async () => {
    const file = new File(['data'], 'photo.png', { type: 'image/png' });
    await expect(importFile(file, fakes)).rejects.toThrow(/unsupported/i);
  });

  it('normalizes what the extractor returns', async () => {
    const file = new File(['x'], 'cv.pdf', { type: 'application/pdf' });
    const result = await importFile(file, { extractPdf: async () => '  a  \n\n\n\nb  ' });
    expect(result.markdown).toBe('a\n\nb');
  });
});
