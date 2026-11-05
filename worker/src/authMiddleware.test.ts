// Runs the real Worker app against an in-memory database and a stub mailer. No network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from './authCore';
import { API, OWNER, call, count, json, signIn, send, setup, testEnv, withCookie } from './testing/app';

const H = API;

afterEach(() => {
  send.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('session middleware', () => {
  it('returns 401 "Sign in" for an API route with no cookie', async () => {
    const { env } = await setup();
    const res = await call(`${H}/household`, {}, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Sign in' });
  });

  it('returns 200 for an API route with a valid session', async () => {
    const { env, cookies } = await setup();
    const res = await call(`${H}/household`, withCookie(cookies[OWNER]!), env);
    expect(res.status).toBe(200);
  });

  it('returns 401 for an expired session', async () => {
    const { env, raw } = await setup([]);
    raw
      .prepare('INSERT INTO sessions (id_hash, email, created_at, expires_at, user_agent) VALUES (?, ?, 0, ?, NULL)')
      .run(await sha256('old'), OWNER, Date.now() - 1);
    const res = await call(`${H}/household`, { headers: { cookie: 'ap_session=old' } }, env);
    expect(res.status).toBe(401);
  });

  it('returns 401, ends the session, and clears the cookie once the address may no longer use the app', async () => {
    const { env, raw } = await setup([]);
    const { cookie } = await signIn(raw, 'former@example.com');
    const res = await call(`${H}/household`, { headers: { cookie } }, env);
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(count(raw, 'sessions', 'email = ?', 'former@example.com')).toBe(0);
  });

  it('guards writes too', async () => {
    const { env } = await setup();
    const res = await call(`${H}/household`, { method: 'PUT', body: '{}' }, env);
    expect(res.status).toBe(401);
  });

  it('leaves health and the auth routes open', async () => {
    const { env } = await setup();
    const health = await call(`${H}/health`, {}, env);
    expect(health.status).toBe(200);
    const me = await call(`${H}/auth/me`, {}, env);
    expect(me.status).toBe(401);
    expect(await me.json()).toEqual({ error: 'Sign in' });
  });

  it('keeps the dev fixture route behind DEV=1 as well as a session', async () => {
    const { env, cookies, raw } = await setup();
    const res = await call(`${H}/dev/load-fixtures`, withCookie(cookies[OWNER]!, { method: 'POST' }), env);
    expect(res.status).toBe(404);
    expect(count(raw, 'flyer_items')).toBe(0);
  });
});

describe('sign-in flow (dev mode: code is logged, nothing sent)', () => {
  it('requests a code, verifies it, uses the session, then signs out', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });
    const { DB } = await setup([]);
    const env = testEnv(DB, { DEV: '1', DEV_AUTH_EMAIL: OWNER });

    const req = await call(`${H}/auth/request`, json('POST', { email: '  Owner@Example.com ' }), env);
    expect(req.status).toBe(200);
    expect(send).not.toHaveBeenCalled();

    const code = logs.find((l) => l.includes('sign-in code'))?.match(/(\d{6})$/)?.[1];
    expect(code).toMatch(/^\d{6}$/);

    const verify = await call(`${H}/auth/verify`, json('POST', { email: OWNER, code }), env);
    expect(verify.status).toBe(200);
    expect(await verify.json()).toEqual({ email: OWNER });
    const setCookie = verify.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^ap_session=[A-Za-z0-9_-]+; Path=\/provisions; Max-Age=31536000; HttpOnly; SameSite=Lax/);
    const cookie = setCookie.split(';')[0]!;

    const me = await call(`${H}/auth/me`, { headers: { cookie } }, env);
    expect(await me.json()).toEqual({ email: OWNER });
    const household = await call(`${H}/household`, { headers: { cookie } }, env);
    expect(household.status).toBe(200);

    const out = await call(`${H}/auth/logout`, { method: 'POST', headers: { cookie } }, env);
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
    const after = await call(`${H}/household`, { headers: { cookie } }, env);
    expect(after.status).toBe(401);
  });

  it('answers the same for a stranger, and sends nothing', async () => {
    const { env, raw } = await setup([]);
    const res = await call(`${H}/auth/request`, json('POST', { email: 'stranger@example.com' }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(send).not.toHaveBeenCalled();
    expect(count(raw, 'login_codes')).toBe(0);
  });

  it('rejects a wrong code, and a second request within 45 seconds', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { DB } = await setup([]);
    const env = testEnv(DB, { DEV: '1', DEV_AUTH_EMAIL: OWNER });
    expect((await call(`${H}/auth/request`, json('POST', { email: OWNER }), env)).status).toBe(200);

    const again = await call(`${H}/auth/request`, json('POST', { email: OWNER }), env);
    expect(again.status).toBe(429);

    const wrong = await call(`${H}/auth/verify`, json('POST', { email: OWNER, code: '000000' }), env);
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: 'Wrong code' });
  });

  it('sends the mail through the send_email binding when not in dev mode', async () => {
    const { env } = await setup([]);
    const res = await call(`${H}/auth/request`, json('POST', { email: OWNER }), env);
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0]![0] as unknown as { from: string; to: string; raw: string };
    expect(message.from).toBe('provisions@adityajain.ca');
    expect(message.to).toBe(OWNER);
    expect(message.raw).toContain('From: Atlas Provisions <provisions@adityajain.ca>');
    expect(message.raw).toContain('Subject: Your Atlas Provisions sign-in code');
  });

  it('sends a code to an invited address that is not on the allow-list', async () => {
    const { env, raw } = await setup([]);
    const { cookie } = await signIn(raw, OWNER);
    const created = await call(`${H}/invites`, json('POST', { email: 'friend@example.com' }, cookie), env);
    expect(created.status).toBe(201);
    const res = await call(`${H}/auth/request`, json('POST', { email: 'friend@example.com' }), env);
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0]![0] as unknown as { to: string }).to).toBe('friend@example.com');
  });

  it('sends through Resend when RESEND_API_KEY is set, and not through send_email', async () => {
    const fetchStub = vi.fn(async () => new Response('{"id":"abc"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);
    const { DB } = await setup([]);
    const res = await call(`${H}/auth/request`, json('POST', { email: OWNER }), testEnv(DB, { RESEND_API_KEY: 're_test_123' }));
    expect(res.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(JSON.parse(init.body as string).to).toEqual([OWNER]);
  });

  it('returns the usual mail error and logs the detail when Resend fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('domain not verified', { status: 403 })));
    const errors: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const { DB, raw } = await setup([]);
    const res = await call(`${H}/auth/request`, json('POST', { email: OWNER }), testEnv(DB, { RESEND_API_KEY: 're_test_123' }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't send the email" });
    expect(errors.some((args) => String(args[1]).includes('Resend 403: domain not verified'))).toBe(true);
    expect(count(raw, 'login_codes')).toBe(1);
  });

  it('keeps dev mode log-only even when RESEND_API_KEY is set', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    const { DB } = await setup([]);
    const env = testEnv(DB, { DEV: '1', DEV_AUTH_EMAIL: OWNER, RESEND_API_KEY: 're_test_123' });
    const res = await call(`${H}/auth/request`, json('POST', { email: OWNER }), env);
    expect(res.status).toBe(200);
    expect(fetchStub).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes(`sign-in code for ${OWNER}`))).toBe(true);
  });
});
