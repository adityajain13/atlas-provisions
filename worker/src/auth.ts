// Passwordless sign-in, mounted at /provisions/api/auth:
//   POST /request {email}      emails a 6-digit code + one-tap link (only if the email is allowed)
//   POST /verify {email,code}  session cookie
//   GET  /link?e=&t=           session cookie, redirect into the app
//   GET  /me                   {email} or 401 (also rolls the session forward)
//   POST /logout
// Ported from Atlas Journeys (worker/auth.ts). Behaviour is unchanged except as noted in the README.
import { Hono } from 'hono';
import {
  BASE,
  CODE_TTL_MINUTES,
  MAX_ATTEMPTS,
  RESEND_AFTER_MS,
  CODE_TTL_MS,
  codeHash,
  isAllowed,
  isExpired,
  loginLink,
  makeCode,
  normEmail,
  randomToken,
  safeEqual,
  sha256,
} from './authCore';
import { createSession, endSession, getSession, type SessionEnv } from './session';
import { sendMail, type MailEnv } from './mail';

export type AuthEnv = SessionEnv &
  MailEnv & {
    /** Local dev only: with DEV=1 and DEV_AUTH_EMAIL set, codes are logged instead of emailed. */
    DEV?: string;
    DEV_AUTH_EMAIL?: string;
  };

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Local-only mode: codes and links go to the console, nothing is sent. */
export const isDevLogin = (env: AuthEnv) => env.DEV === '1' && !!env.DEV_AUTH_EMAIL;

export const authRoutes = new Hono<{ Bindings: AuthEnv }>();

authRoutes.post('/request', async (c) => {
  const { email: raw } = (await c.req.json().catch(() => ({}))) as { email?: unknown };
  const email = normEmail(raw);
  if (!email.includes('@')) return c.json({ error: 'Enter a valid email' }, 400, NO_STORE);
  // Same response either way, so the endpoint does not reveal who is allowed
  if (!isAllowed(c.env.ALLOWED_EMAILS, email)) return c.json({ ok: true }, 200, NO_STORE);

  const prev = await c.env.DB.prepare('SELECT created_at FROM login_codes WHERE email = ?')
    .bind(email)
    .first<{ created_at: number }>();
  if (prev && Date.now() - prev.created_at < RESEND_AFTER_MS) {
    return c.json({ error: 'Code just sent — check your inbox' }, 429, NO_STORE);
  }

  const { code, linkToken } = await storeLoginCode(c.env, email);
  const link = loginLink(new URL(c.req.url).origin, email, linkToken);
  if (isDevLogin(c.env)) {
    console.log(`[dev] sign-in code for ${email}: ${code}`);
    console.log(`[dev] one-tap link for ${email}: ${link}`);
    return c.json({ ok: true }, 200, NO_STORE);
  }
  try {
    await sendLoginMail(c.env, email, code, link);
  } catch (e) {
    console.error('send failed', e);
    return c.json({ error: "Couldn't send the email" }, 502, NO_STORE);
  }
  return c.json({ ok: true }, 200, NO_STORE);
});

authRoutes.post('/verify', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { email?: unknown; code?: unknown };
  const email = normEmail(body.email);
  const code = String(body.code ?? '').replace(/\D/g, '');
  const row = await c.env.DB.prepare('SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?')
    .bind(email)
    .first<{ code_hash: string; expires_at: number; attempts: number }>();
  if (!row || isExpired(row.expires_at) || row.attempts >= MAX_ATTEMPTS) {
    return c.json({ error: 'Code expired — request a new one' }, 400, NO_STORE);
  }
  if (!safeEqual(row.code_hash, await codeHash(email, code))) {
    await c.env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?').bind(email).run();
    return c.json({ error: 'Wrong code' }, 400, NO_STORE);
  }
  const cookie = await createSession(c.req.raw, c.env, email);
  return c.json({ email }, 200, { ...NO_STORE, 'Set-Cookie': cookie });
});

authRoutes.get('/link', async (c) => {
  const url = new URL(c.req.url);
  const email = normEmail(url.searchParams.get('e'));
  const t = url.searchParams.get('t') ?? '';
  const row = await c.env.DB.prepare('SELECT link_hash, expires_at FROM login_codes WHERE email = ?')
    .bind(email)
    .first<{ link_hash: string; expires_at: number }>();
  if (!row || isExpired(row.expires_at) || !safeEqual(row.link_hash, await sha256(t))) {
    return Response.redirect(`${url.origin}${BASE}/login?expired=1`, 302);
  }
  const cookie = await createSession(c.req.raw, c.env, email);
  return new Response(null, { status: 302, headers: { Location: `${BASE}/`, 'Set-Cookie': cookie, ...NO_STORE } });
});

authRoutes.get('/me', async (c) => {
  const s = await getSession(c.req.raw, c.env);
  if (!s) return c.json({ error: 'Sign in' }, 401, NO_STORE);
  return c.json({ email: s.email }, 200, s.refreshCookie ? { ...NO_STORE, 'Set-Cookie': s.refreshCookie } : NO_STORE);
});

authRoutes.post('/logout', async (c) => {
  const cookie = await endSession(c.req.raw, c.env);
  return c.json({ ok: true }, 200, { ...NO_STORE, 'Set-Cookie': cookie });
});

/** Makes a fresh code and one-tap link token, and saves their hashes (replacing any earlier ones). */
async function storeLoginCode(env: AuthEnv, email: string): Promise<{ code: string; linkToken: string }> {
  const code = makeCode();
  const linkToken = randomToken(24);
  const now = Date.now();
  await env.DB.prepare(
    'INSERT OR REPLACE INTO login_codes (email, code_hash, link_hash, created_at, expires_at, attempts) VALUES (?, ?, ?, ?, ?, 0)',
  )
    .bind(email, await codeHash(email, code), await sha256(linkToken), now, now + CODE_TTL_MS)
    .run();
  return { code, linkToken };
}

async function sendLoginMail(env: AuthEnv, email: string, code: string, link: string): Promise<void> {
  const href = link.replace(/&/g, '&amp;');
  await sendMail(env, {
    fromName: 'Atlas Provisions',
    to: email,
    subject: 'Your Atlas Provisions sign-in code',
    text: `Your login code is ${code}\n\nOr sign in on this device with one tap:\n${link}\n\nThe code expires in ${CODE_TTL_MINUTES} minutes. If you didn't ask for this, ignore it.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:420px;color:#1c1f1d">
<p style="margin:0 0 8px">Your login code:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:8px 0;color:#1c1f1d">${code}</p>
<p style="margin:16px 0"><a href="${href}" style="display:inline-block;background:#1c1f1d;color:#ffffff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600">Sign in on this device</a></p>
<p style="color:#6b716d;font-size:13px;margin:0">Expires in ${CODE_TTL_MINUTES} minutes. If you didn't ask for this, ignore it.</p></div>`,
  });
}
