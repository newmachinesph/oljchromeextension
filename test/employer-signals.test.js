// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  NEW_ACCOUNT_DAYS,
  employerBlockText,
  readJoinedAt,
  newAccountWarning,
  describeNewAccount,
  hasCensoredContact,
  hasBlurredBlock,
  readTotalPosts,
  readEmployerSignals,
} from '../src/core/employer-signals.js';
import { isGone } from '../src/core/expired.js';

const NOW = Date.parse('2026-08-18T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function page(html) {
  return new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html');
}

describe('finding the employer block', () => {
  it('reads the section under its heading', () => {
    const doc = page(`
      <div><h3>About the employer</h3><p>Member since August 2026</p></div>
      <div><h3>Other</h3><p>Member since January 2019</p></div>`);

    expect(employerBlockText(doc)).toContain('August 2026');
    expect(employerBlockText(doc)).not.toContain('2019');
  });

  it('falls back to the page when the heading is not there', () => {
    // The heading has changed before; a date from too much text beats no date.
    const doc = page('<p>Joined 2026-08-01</p>');
    expect(employerBlockText(doc)).toContain('2026-08-01');
  });

  it('copes with nothing', () => {
    expect(employerBlockText(null)).toBe('');
  });
});

describe('reading when the account was made', () => {
  const withBlock = (text) => page(`<div><h3>About the employer</h3><p>${text}</p></div>`);

  it('reads the spellings the site uses', () => {
    expect(readJoinedAt(withBlock('Member since August 2026'))).toBe(Date.parse('August 2026'));
    expect(readJoinedAt(withBlock('Joined: 12 August 2026'))).toBe(Date.parse('12 August 2026'));
    expect(readJoinedAt(withBlock('Registered on Aug 1, 2026'))).toBe(Date.parse('Aug 1, 2026'));
    expect(readJoinedAt(withBlock('Member since 2026-08-01'))).toBe(Date.parse('2026-08-01'));
  });

  it('says nothing rather than guessing', () => {
    expect(readJoinedAt(withBlock('A great place to work'))).toBeNull();
    expect(readJoinedAt(withBlock('Member since forever'))).toBeNull();
    expect(readJoinedAt(null)).toBeNull();
  });
});

describe('deciding an account is new', () => {
  it('warns about one made this month', () => {
    const warning = newAccountWarning(NOW - 5 * DAY, NOW);
    expect(warning.days).toBe(5);
  });

  it('says nothing about an established account', () => {
    expect(newAccountWarning(NOW - (NEW_ACCOUNT_DAYS + 1) * DAY, NOW)).toBeNull();
  });

  it('treats a date in the future as a misread, not a very new account', () => {
    expect(newAccountWarning(NOW + 10 * DAY, NOW)).toBeNull();
  });

  it('says nothing when the page never said', () => {
    expect(newAccountWarning(null, NOW)).toBeNull();
    expect(newAccountWarning(NaN, NOW)).toBeNull();
  });

  it('states the fact without making the accusation', () => {
    // Everyone is new once. The wording has to inform, not convict.
    const words = describeNewAccount({ days: 3 });
    expect(words).toContain('3 days ago');
    expect(words).toContain('Everyone is new once');
    expect(words.toLowerCase()).not.toContain('scam');
  });

  it('says nothing when there is nothing to say', () => {
    expect(describeNewAccount(null)).toBe('');
  });
});

describe('spotting a post with its contact details stripped', () => {
  it('recognises an explicit removal notice', () => {
    expect(hasCensoredContact('Apply here [link removed]')).toBe(true);
    expect(hasCensoredContact('Send to [email hidden]')).toBe(true);
    expect(hasCensoredContact('Contact details removed')).toBe(true);
  });

  it('leaves an ordinary post alone', () => {
    expect(hasCensoredContact('We removed the old process last year.')).toBe(false);
    expect(hasCensoredContact('Send your CV through the apply button.')).toBe(false);
    expect(hasCensoredContact('')).toBe(false);
    expect(hasCensoredContact(null)).toBe(false);
  });
});

describe('reading everything at once', () => {
  it('gathers both notes', () => {
    const doc = page(`
      <div><h3>About the employer</h3><p>Member since 2026-08-14</p></div>
      <p>Portfolio at [link removed]</p>`);

    const signals = readEmployerSignals(doc, NOW);
    expect(signals.censored).toBe(true);
    expect(signals.newAccount.days).toBe(4);
    expect(signals.notes).toHaveLength(2);
  });

  it('says nothing about an ordinary posting', () => {
    const doc = page('<div><h3>About the employer</h3><p>Member since March 2019</p></div>');
    const signals = readEmployerSignals(doc, NOW);

    expect(signals.newAccount).toBeNull();
    expect(signals.censored).toBe(false);
    expect(signals.notes).toHaveLength(0);
  });
});

describe('a job that has been taken down', () => {
  it('recognises the wording the site actually uses', () => {
    // https://www.onlinejobs.ph/jobseekers/job/training-specialist-966107
    expect(isGone(page('<h1>This job has been closed.</h1>'))).toBe(true);
  });
});

describe('against the live page, verbatim', () => {
  /**
   * Everything below was copied off a real posting. Both of the first two were
   * bugs the unit tests could not have found, because the tests and the code
   * shared my guess about the wording.
   */
  const REAL = `
    <div><h3>ABOUT THE EMPLOYER</h3>
      <p>Business or Contact Name: Jessica</p>
      <p>Member since: July 27, 2026</p>
      <p>Total Job Posts: 1</p>
    </div>
    <div class="div-blurred-text">Why is this blurred? Job posts from free employer
      accounts are not allowed to show external links.</div>`;

  it('reads a date written with a colon after "since"', () => {
    // The first version allowed "since" OR ":", never both, so the account age
    // was never read and the warning never fired on any real page.
    expect(readJoinedAt(page(REAL))).toBe(Date.parse('July 27, 2026'));
  });

  it('does not call a paid posting censored', () => {
    // The regression that matters. The site ships its "Why is this blurred?"
    // explainer in the markup of every job page and only renders it for free
    // accounts, so matching on that text warned about a posting whose email
    // and links were plainly visible - accusing a legitimate employer.
    expect(hasCensoredContact('Why is this blurred? Job posts from free employer accounts')).toBe(
      false,
    );
    expect(readEmployerSignals(page(REAL), Date.parse('2026-08-18T12:00:00Z')).censored).toBe(
      false,
    );
  });

  it('will not judge blurring without layout to judge it by', () => {
    // A DOMParser document has no layout, so the one reliable signal is not
    // available. Saying nothing beats guessing when the false positive
    // accuses someone.
    expect(hasBlurredBlock(page(REAL))).toBe(false);
  });

  it('reads how many jobs this employer has ever posted', () => {
    expect(readTotalPosts(page(REAL))).toBe(1);
  });

  it('reports the account age, which is the part it can be sure of', () => {
    const signals = readEmployerSignals(page(REAL), Date.parse('2026-08-18T12:00:00Z'));

    expect(signals.newAccount.days).toBe(22);
    expect(signals.totalPosts).toBe(1);
    expect(signals.notes[0]).toContain('first job post');
    expect(signals.notes).toHaveLength(1);
  });
});
