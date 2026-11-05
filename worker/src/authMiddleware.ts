// Session check for every /provisions/api/* route except health and sign-in.
import type { MiddlewareHandler } from 'hono';
import { API } from './authCore';
import { getSession, type SessionEnv } from './session';

const PUBLIC_PATHS = new Set([`${API}/health`]);

/** Set on the request for routes behind sign-in: the signed-in address. */
export type SessionVars = { email: string };

export const requireSession: MiddlewareHandler<{ Bindings: SessionEnv; Variables: SessionVars }> = async (c, next) => {
  const { pathname } = new URL(c.req.url);
  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith(`${API}/auth/`)) return next();

  const s = await getSession(c.req.raw, c.env);
  if (!s) return c.json({ error: 'Sign in' }, 401, { 'Cache-Control': 'no-store' });
  c.set('email', s.email);
  if (s.refreshCookie) c.header('Set-Cookie', s.refreshCookie, { append: true });
  return next();
};
