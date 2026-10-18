import { describe, it, expect } from 'vitest';
import { connectAuthFromMessage } from '../src/core/account.js';

/**
 * The gate on the connect handoff: a token is accepted into storage only when
 * the message came from our own site's origin and looks like the connect page
 * sent it. Anything else must be refused - onMessageExternal is reachable by
 * any page an externally_connectable pattern matches, and the sender origin is
 * the one thing a page cannot fake.
 */
describe('connectAuthFromMessage', () => {
  const API = 'https://oljextension.site';
  const good = {
    type: 'connect-token',
    token: 'tok_abc123',
    email: 'me@example.com',
    expiresAt: '2026-11-27T00:00:00.000Z',
  };

  it('accepts a well-formed message from the API origin', () => {
    expect(connectAuthFromMessage(good, 'https://oljextension.site', API)).toEqual({
      token: 'tok_abc123',
      email: 'me@example.com',
      expiresAt: '2026-11-27T00:00:00.000Z',
    });
  });

  it('refuses any other origin, however close', () => {
    expect(connectAuthFromMessage(good, 'https://oljextension.site.evil.example', API)).toBeNull();
    expect(connectAuthFromMessage(good, 'https://evil.example', API)).toBeNull();
    expect(connectAuthFromMessage(good, undefined, API)).toBeNull();
  });

  it('refuses a message that is not a connect-token', () => {
    expect(connectAuthFromMessage({ ...good, type: 'other' }, API, API)).toBeNull();
    expect(connectAuthFromMessage(null, API, API)).toBeNull();
  });

  it('refuses an empty or missing token', () => {
    expect(connectAuthFromMessage({ ...good, token: '' }, API, API)).toBeNull();
    expect(connectAuthFromMessage({ type: 'connect-token' }, API, API)).toBeNull();
  });

  it('tolerates missing email and expiry, as sanitizeAuth does', () => {
    expect(connectAuthFromMessage({ type: 'connect-token', token: 't' }, API, API)).toEqual({
      token: 't',
      email: '',
      expiresAt: null,
    });
  });

  it('matches the origin of the api base, not its full url', () => {
    expect(connectAuthFromMessage(good, 'http://localhost:3100', 'http://localhost:3100')).toEqual({
      token: 'tok_abc123',
      email: 'me@example.com',
      expiresAt: '2026-11-27T00:00:00.000Z',
    });
  });
});
