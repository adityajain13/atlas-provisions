// Session storage in D1. Only a SHA-256 of the cookie token is stored.
import {
  COOKIE,
  ROLL_WHEN_LEFT_MS,
  SESSION_MAX_AGE,
  isExpired,
  parseCookies,
  randomToken,
  sessionCookie,
  sha256,
} from './authCore';

export interface SessionEnv {
  DB: D1Database;
}

export interface Session {
  email: string;
  /** Set when the session was pushed forward; send it back as Set-Cookie. */
  refreshCookie?: string;
}

/**
 * Resolves the session from the cookie. Rolls expiry forward when under 11 months remain. This does not check
 * that the address may still use the app: that is access.ts, on every request.
 */
export async function getSession(req: Request, env: SessionEnv): Promise<Session | null> {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const idHash = await sha256(token);
  const row = await env.DB.prepare('SELECT email, expires_at FROM sessions WHERE id_hash = ?')
    .bind(idHash)
    .first<{ email: string; expires_at: number }>();
  if (!row || isExpired(row.expires_at)) return null;

  const s: Session = { email: row.email };
  if (row.expires_at - Date.now() < ROLL_WHEN_LEFT_MS) {
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?')
      .bind(Date.now() + SESSION_MAX_AGE * 1000, idHash)
      .run();
    s.refreshCookie = sessionCookie(token, new URL(req.url));
  }
  return s;
}

/** Creates a session for the email, clears its pending login codes, and returns the Set-Cookie value. */
export async function createSession(req: Request, env: SessionEnv, email: string): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (id_hash, email, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), email, now, now + SESSION_MAX_AGE * 1000, (req.headers.get('user-agent') ?? '').slice(0, 200))
    .run();
  await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();
  return sessionCookie(token, new URL(req.url));
}

/** Deletes the session behind the request's cookie and returns the expiring Set-Cookie value. */
export async function endSession(req: Request, env: SessionEnv): Promise<string> {
  const token = parseCookies(req)[COOKIE];
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256(token)).run();
  return sessionCookie('', new URL(req.url), 0);
}
