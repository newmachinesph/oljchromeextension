import { describe, it, expect } from 'vitest';
import { cleanUrl } from '../src/core/safe-url.js';

describe('cleanUrl', () => {
  it('keeps http(s) and site-relative links', () => {
    expect(cleanUrl('https://www.onlinejobs.ph/jobseekers/job/x-123')).toBe(
      'https://www.onlinejobs.ph/jobseekers/job/x-123',
    );
    expect(cleanUrl('/jobseekers/job/x-123')).toBe('/jobseekers/job/x-123');
    expect(cleanUrl('http://example.com')).toBe('http://example.com');
  });

  it('drops dangerous or unusable schemes', () => {
    expect(cleanUrl('javascript:alert(1)')).toBe('');
    expect(cleanUrl('data:text/html,<script>1</script>')).toBe('');
    expect(cleanUrl('file:///etc/passwd')).toBe('');
    expect(cleanUrl('  JavaScript:alert(1)  ')).toBe('');
  });

  it('is empty for blank input and caps length', () => {
    expect(cleanUrl('')).toBe('');
    expect(cleanUrl(null)).toBe('');
    expect(cleanUrl('https://a.com/' + 'x'.repeat(500)).length).toBe(300);
  });
});
