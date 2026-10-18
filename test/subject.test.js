import { describe, it, expect } from 'vitest';
import { DEFAULT_SUBJECT_PATTERN, fillPattern, resolveSubject } from '../src/core/subject.js';

describe('fillPattern', () => {
  it('replaces known placeholders', () => {
    expect(fillPattern('Application: {jobTitle} — {name}', { jobTitle: 'VA', name: 'Maria' })).toBe(
      'Application: VA — Maria',
    );
  });

  it('drops an unknown placeholder and tidies the dangling separator', () => {
    expect(fillPattern('Application: {jobTitle} — {missing}', { jobTitle: 'VA' })).toBe(
      'Application: VA',
    );
    expect(fillPattern('{missing} — {name}', { name: 'Maria' })).toBe('Maria');
  });

  it('is empty when nothing fills it', () => {
    expect(fillPattern('{a} — {b}', {})).toBe('');
    expect(fillPattern('', { name: 'Maria' })).toBe('');
  });
});

describe('resolveSubject', () => {
  it('uses the employer instruction when there is one', () => {
    expect(
      resolveSubject({
        instruction: 'New VA Applicant',
        pattern: 'Application: {jobTitle}',
        values: { jobTitle: 'VA' },
      }),
    ).toBe('New VA Applicant');
  });

  it('falls back to the pattern when there is no instruction', () => {
    expect(
      resolveSubject({
        instruction: '',
        pattern: 'Application: {jobTitle} — {name}',
        values: { jobTitle: 'Virtual Assistant', name: 'Maria' },
      }),
    ).toBe('Application: Virtual Assistant — Maria');
  });

  it('falls back to the default pattern when none is given', () => {
    expect(resolveSubject({ values: { jobTitle: 'VA', name: 'Maria' } })).toBe(
      fillPattern(DEFAULT_SUBJECT_PATTERN, { jobTitle: 'VA', name: 'Maria' }),
    );
  });

  it('is empty when nothing resolves', () => {
    expect(resolveSubject({ instruction: '', pattern: '{jobTitle}', values: {} })).toBe('');
  });
});
