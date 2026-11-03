import { describe, expect, it } from 'vitest';
import {
  codeHash,
  isAllowed,
  isExpired,
  loginLink,
  makeCode,
  normEmail,
  parseAllowList,
  parseCookies,
  safeEqual,
  sessionCookie,
  sha256,
} from './authCore';

describe('makeCode', () => {
  it('always gives six digits, zero-padded', () => {
    for (let i = 0; i < 500; i++) expect(makeCode()).toMatch(/^\d{6}$/);
  });
});

describe('hashing', () => {
  it('matches a known SHA-256 (base64url)', async () => {
    expect(await sha256('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  });

  it('binds the code hash to the email, and never stores the plain code', async () => {
    const h = await codeHash('owner@example.com', '123456');
    expect(h).toBe(await sha256('owner@example.com:123456'));
    expect(h).not.toContain('123456');
    expect(h).not.toBe(await codeHash('other@example.com', '123456'));
    expect(h).not.toBe(await codeHash('owner@example.com', '654321'));
  });

  it('compares in constant time, and returns false on any difference', () => {
    expect(safeEqual('abcd', 'abcd')).toBe(true);
    expect(safeEqual('abcd', 'abce')).toBe(false);
    expect(safeEqual('abcd', 'abc')).toBe(false);
  });
});

describe('allow-list', () => {
  it('parses ALLOWED_EMAILS case-insensitively, ignoring spaces and blanks', () => {
    const set = parseAllowList(' Owner@Example.com , ,other@example.com,');
    expect([...set].sort()).toEqual(['other@example.com', 'owner@example.com']);
  });

  it('checks membership against the normalised email', () => {
    const raw = 'owner@example.com';
    expect(isAllowed(raw, '  OWNER@example.COM ')).toBe(true);
    expect(isAllowed(raw, 'stranger@example.com')).toBe(false);
    expect(isAllowed(undefined, 'owner@example.com')).toBe(false);
  });

  it('normalises emails and rejects non-strings', () => {
    expect(normEmail(' A@B.com ')).toBe('a@b.com');
    expect(normEmail(42)).toBe('');
  });
});

describe('expiry', () => {
  it('is expired only once the stored time has passed', () => {
    expect(isExpired(1_000, 1_001)).toBe(true);
    expect(isExpired(1_000, 1_000)).toBe(false);
    expect(isExpired(2_000, 1_000)).toBe(false);
  });
});

describe('session cookie', () => {
  it('is HttpOnly, scoped to /provisions, one year, SameSite=Lax, Secure on https', () => {
    expect(sessionCookie('tok', new URL('https://adityajain.ca/provisions/api/auth/verify'))).toBe(
      'ap_session=tok; Path=/provisions; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure',
    );
  });

  it('drops Secure on plain http so local dev works', () => {
    expect(sessionCookie('tok', new URL('http://localhost:8787/provisions/'))).toBe(
      'ap_session=tok; Path=/provisions; Max-Age=31536000; HttpOnly; SameSite=Lax',
    );
  });

  it('expires the cookie when signing out', () => {
    expect(sessionCookie('', new URL('https://adityajain.ca/provisions/'), 0)).toBe(
      'ap_session=; Path=/provisions; Max-Age=0; HttpOnly; SameSite=Lax; Secure',
    );
  });

  it('reads the session cookie back out of a request', () => {
    const req = new Request('https://x.test/', { headers: { cookie: 'a=1; ap_session=abc%2Bdef; b=2' } });
    expect(parseCookies(req).ap_session).toBe('abc+def');
  });
});

describe('one-tap link', () => {
  it('points at the auth link route on the request origin', () => {
    expect(loginLink('https://adityajain.ca', 'a+b@x.com', 'TOK')).toBe(
      'https://adityajain.ca/provisions/api/auth/link?e=a%2Bb%40x.com&t=TOK',
    );
  });
});
