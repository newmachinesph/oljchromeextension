import { describe, it, expect } from 'vitest';
import { parseAccountEmail } from '../src/core/olj-account.js';

describe('parseAccountEmail', () => {
  it('reads the value of an email input', () => {
    const html = `<form><input type="email" name="email" value="Jane.Doe@Example.co" /></form>`;
    expect(parseAccountEmail(html)).toBe('jane.doe@example.co');
  });

  it('reads an input identified by name/id even without type=email', () => {
    expect(parseAccountEmail(`<input id="account-email" value="worker@gmail.com">`)).toBe(
      'worker@gmail.com',
    );
    expect(parseAccountEmail(`<input name="user_email" value="a@b.io">`)).toBe('a@b.io');
  });

  it('handles single quotes and attribute order', () => {
    const html = `<input value='me@site.com' class='x' type='email'>`;
    expect(parseAccountEmail(html)).toBe('me@site.com');
  });

  it('reads a labelled value in a table row', () => {
    const html = `<tr><td>Email Address</td><td>hire.me@work.ph</td></tr>`;
    expect(parseAccountEmail(html)).toBe('hire.me@work.ph');
  });

  it('reads "Email: x@y.com" text', () => {
    expect(parseAccountEmail('<p>Email: contact.person@mail.com</p>')).toBe(
      'contact.person@mail.com',
    );
  });

  it('ignores the site support address in a footer and reads the account email', () => {
    const html = `
      <input type="email" name="email" value="real.user@gmail.com">
      <footer>Questions? support@onlinejobs.ph</footer>`;
    expect(parseAccountEmail(html)).toBe('real.user@gmail.com');
  });

  it('falls back to a single non-system candidate', () => {
    const html = `<div>Your address is only.one@domain.dev here</div>
      <footer>noreply@onlinejobs.ph</footer>`;
    expect(parseAccountEmail(html)).toBe('only.one@domain.dev');
  });

  it('returns empty when two different plausible emails leave it ambiguous', () => {
    const html = `<div>alice@a.com</div><div>bob@b.com</div>`;
    expect(parseAccountEmail(html)).toBe('');
  });

  it('returns empty when there is no email (e.g. the login page)', () => {
    expect(parseAccountEmail('<h1>Please log in</h1>')).toBe('');
    expect(parseAccountEmail('')).toBe('');
    expect(parseAccountEmail(null)).toBe('');
  });

  it('does not attest a system or placeholder address from an input', () => {
    expect(parseAccountEmail(`<input type="email" value="support@onlinejobs.ph">`)).toBe('');
    expect(parseAccountEmail(`<input type="email" value="you@example.com">`)).toBe('');
  });
});
