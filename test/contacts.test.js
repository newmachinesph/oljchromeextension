import { describe, it, expect } from 'vitest';
import { findEmails } from '../src/core/contacts.js';

describe('findEmails', () => {
  it('finds addresses in prose, once each, as written', () => {
    const text =
      'HOW TO APPLY: Email ari@godsounds.com with the subject line "New VA". ' +
      'Or send to Ari@GodSounds.com again, cc hiring+va@example.co.uk.';
    expect(findEmails(text)).toEqual(['ari@godsounds.com', 'hiring+va@example.co.uk']);
  });

  it('ignores things that only look like addresses', () => {
    expect(findEmails('see image@2x.png and user@localhost and @handle')).toEqual([]);
    expect(findEmails('price is 5@10 each')).toEqual([]);
  });

  it('strips trailing punctuation the sentence added', () => {
    expect(findEmails('Write to jobs@acme.io. Or jobs@acme.io, today (jobs@acme.io).')).toEqual([
      'jobs@acme.io',
    ]);
  });

  it('caps how many it returns', () => {
    const many = Array.from({ length: 10 }, (_, i) => `p${i}@acme.io`).join(' ');
    expect(findEmails(many)).toHaveLength(5);
  });

  it('is empty for nothing', () => {
    expect(findEmails('')).toEqual([]);
    expect(findEmails(null)).toEqual([]);
  });
});
