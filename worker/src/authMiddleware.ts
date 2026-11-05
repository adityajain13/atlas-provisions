// Session check for every /provisions/api/* route except health and sign-in. Also resolves the household the
// address works in (joining it when an invite or the allow-list says so). No access: the session ends.
import type { MiddlewareHandler } from 'hono';
import type { HouseholdRole } from '@provisions/shared';
import { resolveAccess } from './access';
import { API } from './authCore';
import { endSession, getSession, type SessionEnv } from './session';

const PUBLIC_PATHS = new Set([`${API}/health`]);

/** Set on the request for routes behind sign-in: the signed-in address and the household it works in. */
export type SessionVars = { email: string; householdId: string; role: HouseholdRole };

export type AuthMiddlewareEnv = SessionEnv & { ALLOWED_EMAILS?: string };

export const requireSession: MiddlewareHandler<{ Bindings: AuthMiddlewareEnv; Variables: SessionVars }> = async (
  c,
  next,
) => {
  const { pathname } = new URL(c.req.url);
  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith(`${API}/auth/`)) return next();

  const s = await getSession(c.req.raw, c.env);
  if (!s) return c.json({ error: 'Sign in' }, 401, { 'Cache-Control': 'no-store' });

  const access = await resolveAccess(c.env.DB, c.env.ALLOWED_EMAILS, s.email);
  if (!access) {
    const cookie = await endSession(c.req.raw, c.env);
    return c.json({ error: 'Sign in' }, 401, { 'Cache-Control': 'no-store', 'Set-Cookie': cookie });
  }

  c.set('email', s.email);
  c.set('householdId', access.householdId);
  c.set('role', access.role);
  if (s.refreshCookie) c.header('Set-Cookie', s.refreshCookie, { append: true });
  return next();
};
