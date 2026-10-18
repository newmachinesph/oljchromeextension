import { describe, it, expect } from 'vitest';
import { isResumeUrl, bytesToBase64, base64ToBytes, resumeFilename } from '../src/core/resume.js';

describe('isResumeUrl', () => {
  it('accepts only https OnlineJobs links', () => {
    expect(isResumeUrl('https://v2.onlinejobs.ph/resume/123.pdf')).toBe(true);
    expect(isResumeUrl('https://www.onlinejobs.ph/files/r.pdf')).toBe(true);
    expect(isResumeUrl('http://onlinejobs.ph/r.pdf')).toBe(false); // not https
    expect(isResumeUrl('https://evil.com/onlinejobs.ph/r.pdf')).toBe(false);
    expect(isResumeUrl('javascript:alert(1)')).toBe(false);
    expect(isResumeUrl('')).toBe(false);
  });
});

describe('base64 round trip', () => {
  it('survives a round trip', () => {
    const original = new Uint8Array([0, 1, 2, 250, 128, 255]);
    const restored = base64ToBytes(bytesToBase64(original.buffer));
    expect([...restored]).toEqual([...original]);
  });
});

describe('resumeFilename', () => {
  it('picks an extension the importer can read', () => {
    expect(resumeFilename('https://onlinejobs.ph/x', 'application/pdf')).toBe('resume.pdf');
    expect(resumeFilename('https://onlinejobs.ph/x', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('resume.docx');
    expect(resumeFilename('https://onlinejobs.ph/my-cv.docx', '')).toBe('my-cv.docx');
    expect(resumeFilename('https://onlinejobs.ph/blob', '')).toBe('resume.pdf');
  });
});
