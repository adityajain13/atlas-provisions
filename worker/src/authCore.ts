// Pure sign-in helpers: no Worker bindings, so they can be unit tested.
// Ported from Atlas Journeys (worker/auth.ts, worker/util.ts).

export const API = '/provisions/api';
export const BASE = '/provisions';
export const COOKIE = 'ap_session';
/** Session length in seconds (cookie Max-Age). Stored expiry is this many ms from sign-in. */
export const SESSION_MAX_AGE = 365 * 24 * 60 * 60;
/** Sessions are pushed forward again once less than 335 days remain. */
export const ROLL_WHEN_LEFT_MS = 335 * 24 * 60 * 60 * 1000;
export const CODE_TTL_MS = 15 * 60 * 1000;
export const CODE_TTL_MINUTES = CODE_TTL_MS / 60000;
export const RESEND_AFTER_MS = 45 * 1000;
export const MAX_ATTEMPTS = 5;

const enc = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256(s: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Comma-separated ALLOWED_EMAILS, trimmed and lower-cased. */
export function parseAllowList(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export const isAllowed = (raw: string | undefined, email: string) => parseAllowList(raw).has(normEmail(email));

export const normEmail = (e: unknown): string => (typeof e === 'string' ? e.trim().toLowerCase() : '');

/** A fresh six-digit code, zero-padded. */
export function makeCode(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
}

export const codeHash = (email: string, code: string) => sha256(`${email}:${code}`);

export const isExpired = (expiresAt: number, now: number = Date.now()) => expiresAt < now;

/** Set-Cookie value for the session. Secure is added on https, as in Journeys, so http dev works. */
export function sessionCookie(token: string, url: URL, maxAge = SESSION_MAX_AGE): string {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=${BASE}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

/** The one-tap link in the sign-in email. The origin comes from the request, so local dev works. */
export function loginLink(origin: string, email: string, linkToken: string): string {
  return `${origin}${API}/auth/link?e=${encodeURIComponent(email)}&t=${linkToken}`;
}
