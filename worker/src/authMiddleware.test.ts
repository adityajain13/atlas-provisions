// Runs the real Worker app with an in-memory D1 stub and a stub mailer. No network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from './index';
import { sha256 } from './authCore';
import { EmailMessage } from './testing/cloudflare-email';

type SessionRow = { id_hash: string; email: string; created_at: number; expires_at: number; user_agent: string | null };
type CodeRow = { email: string; code_hash: string; link_hash: string; created_at: number; expires_at: number; attempts: number };

/** A tiny D1 stub: answers only the statements the auth code runs. Unknown statements return nothing. */
function fakeDb() {
  const sessions = new Map<string, SessionRow>();
  const codes = new Map<string, CodeRow>();

  const run = (sql: string, a: unknown[]): { row?: Record<string, unknown> | null } => {
    switch (sql) {
      case 'SELECT email, expires_at FROM sessions WHERE id_hash = ?': {
        const r = sessions.get(a[0] as string);
        return { row: r && { email: r.email, expires_at: r.expires_at } };
      }
      case 'UPDATE sessions SET expires_at = ? WHERE id_hash = ?': {
        const r = sessions.get(a[1] as string);
        if (r) r.expires_at = a[0] as number;
        return {};
      }
      case 'INSERT INTO sessions (id_hash, email, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)': {
        const [id_hash, email, created_at, expires_at, user_agent] = a as [string, string, number, number, string];
        sessions.set(id_hash, { id_hash, email, created_at, expires_at, user_agent });
        return {};
      }
      case 'DELETE FROM sessions WHERE id_hash = ?':
        sessions.delete(a[0] as string);
        return {};
      case 'DELETE FROM login_codes WHERE email = ?':
        codes.delete(a[0] as string);
        return {};
      case 'SELECT created_at FROM login_codes WHERE email = ?':
        return { row: codes.get(a[0] as string) && { created_at: codes.get(a[0] as string)!.created_at } };
      case 'INSERT OR REPLACE INTO login_codes (email, code_hash, link_hash, created_at, expires_at, attempts) VALUES (?, ?, ?, ?, ?, 0)': {
        const [email, code_hash, link_hash, created_at, expires_at] = a as [string, string, string, number, number];
        codes.set(email, { email, code_hash, link_hash, created_at, expires_at, attempts: 0 });
        return {};
      }
      case 'SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?': {
        const r = codes.get(a[0] as string);
        return { row: r && { code_hash: r.code_hash, expires_at: r.expires_at, attempts: r.attempts } };
      }
      case 'UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?': {
        const r = codes.get(a[0] as string);
        if (r) r.attempts++;
        return {};
      }
      case 'SELECT link_hash, expires_at FROM login_codes WHERE email = ?': {
        const r = codes.get(a[0] as string);
        return { row: r && { link_hash: r.link_hash, expires_at: r.expires_at } };
      }
      default:
        return {};
    }
  };

  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) {
          args = values;
          return stmt;
        },
        async first() {
          return run(sql, args).row ?? null;
        },
        async run() {
          run(sql, args);
          return { meta: { changes: 0 } };
        },
        async all() {
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  return { db, sessions, codes };
}

const send = vi.fn(async (_message: EmailMessage) => {});

function makeEnv(db: unknown, extra: Record<string, string> = {}) {
  return {
    DB: db,
    ALLOWED_EMAILS: 'owner@example.com',
    MAIL_FROM: 'provisions@adityajain.ca',
    EMAIL: { send },
    ASSETS: { fetch: async () => new Response('asset') },
    DEV: '0',
    ...extra,
  } as never;
}

const call = (path: string, init: RequestInit, env: unknown) => app.request(path, init, env as never);
const H = '/provisions/api';
const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

afterEach(() => {
  send.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('session middleware', () => {
  it('returns 401 "Sign in" for an API route with no cookie', async () => {
    const { db } = fakeDb();
    const res = await call(`${H}/household`, {}, makeEnv(db));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Sign in' });
  });

  it('returns 200 for an API route with a valid session', async () => {
    const { db, sessions } = fakeDb();
    const token = 'valid-token';
    sessions.set(await sha256(token), {
      id_hash: await sha256(token),
      email: 'owner@example.com',
      created_at: Date.now(),
      expires_at: Date.now() + 86_400_000,
      user_agent: null,
    });
    const res = await call(`${H}/household`, { headers: { cookie: `ap_session=${token}` } }, makeEnv(db));
    expect(res.status).toBe(200);
  });

  it('returns 401 for an expired session', async () => {
    const { db, sessions } = fakeDb();
    sessions.set(await sha256('old'), {
      id_hash: await sha256('old'),
      email: 'owner@example.com',
      created_at: 0,
      expires_at: Date.now() - 1,
      user_agent: null,
    });
    const res = await call(`${H}/household`, { headers: { cookie: 'ap_session=old' } }, makeEnv(db));
    expect(res.status).toBe(401);
  });

  it('returns 401 once the address is removed from ALLOWED_EMAILS', async () => {
    const { db, sessions } = fakeDb();
    sessions.set(await sha256('t'), {
      id_hash: await sha256('t'),
      email: 'former@example.com',
      created_at: Date.now(),
      expires_at: Date.now() + 86_400_000,
      user_agent: null,
    });
    const res = await call(`${H}/household`, { headers: { cookie: 'ap_session=t' } }, makeEnv(db));
    expect(res.status).toBe(401);
  });

  it('guards writes too', async () => {
    const { db } = fakeDb();
    const res = await call(`${H}/household`, { method: 'PUT', body: '{}' }, makeEnv(db));
    expect(res.status).toBe(401);
  });

  it('leaves health and the auth routes open', async () => {
    const { db } = fakeDb();
    const health = await call(`${H}/health`, {}, makeEnv(db));
    expect(health.status).toBe(200);
    const me = await call(`${H}/auth/me`, {}, makeEnv(db));
    expect(me.status).toBe(401);
    expect(await me.json()).toEqual({ error: 'Sign in' });
  });

  it('keeps the dev fixture route behind DEV=1 as well as a session', async () => {
    const { db, sessions } = fakeDb();
    const res = await call(`${H}/dev/load-fixtures`, { method: 'POST' }, makeEnv(db));
    expect(res.status).toBe(401);
    expect(sessions.size).toBe(0);
  });
});

describe('sign-in flow (dev mode: code is logged, nothing sent)', () => {
  it('requests a code, verifies it, uses the session, then signs out', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });
    const { db } = fakeDb();
    const env = makeEnv(db, { DEV: '1', DEV_AUTH_EMAIL: 'owner@example.com' });

    const req = await call(`${H}/auth/request`, json({ email: '  Owner@Example.com ' }), env);
    expect(req.status).toBe(200);
    expect(send).not.toHaveBeenCalled();

    const code = logs.find((l) => l.includes('sign-in code'))?.match(/(\d{6})$/)?.[1];
    expect(code).toMatch(/^\d{6}$/);

    const verify = await call(`${H}/auth/verify`, json({ email: 'owner@example.com', code }), env);
    expect(verify.status).toBe(200);
    expect(await verify.json()).toEqual({ email: 'owner@example.com' });
    const setCookie = verify.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^ap_session=[A-Za-z0-9_-]+; Path=\/provisions; Max-Age=31536000; HttpOnly; SameSite=Lax/);
    const cookie = setCookie.split(';')[0];

    const me = await call(`${H}/auth/me`, { headers: { cookie } }, env);
    expect(await me.json()).toEqual({ email: 'owner@example.com' });
    const household = await call(`${H}/household`, { headers: { cookie } }, env);
    expect(household.status).toBe(200);

    const out = await call(`${H}/auth/logout`, { method: 'POST', headers: { cookie } }, env);
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
    const after = await call(`${H}/household`, { headers: { cookie } }, env);
    expect(after.status).toBe(401);
  });

  it('answers the same for a stranger, and sends nothing', async () => {
    const { db, codes } = fakeDb();
    const res = await call(`${H}/auth/request`, json({ email: 'stranger@example.com' }), makeEnv(db));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(send).not.toHaveBeenCalled();
    expect(codes.size).toBe(0);
  });

  it('rejects a wrong code, and a second request within 45 seconds', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { db } = fakeDb();
    const env = makeEnv(db, { DEV: '1', DEV_AUTH_EMAIL: 'owner@example.com' });
    expect((await call(`${H}/auth/request`, json({ email: 'owner@example.com' }), env)).status).toBe(200);

    const again = await call(`${H}/auth/request`, json({ email: 'owner@example.com' }), env);
    expect(again.status).toBe(429);

    const wrong = await call(`${H}/auth/verify`, json({ email: 'owner@example.com', code: '000000' }), env);
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: 'Wrong code' });
  });

  it('sends the mail through the send_email binding when not in dev mode', async () => {
    const { db } = fakeDb();
    const res = await call(`${H}/auth/request`, json({ email: 'owner@example.com' }), makeEnv(db));
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0][0] as unknown as { from: string; to: string; raw: string };
    expect(message.from).toBe('provisions@adityajain.ca');
    expect(message.to).toBe('owner@example.com');
    expect(message.raw).toContain('From: Atlas Provisions <provisions@adityajain.ca>');
    expect(message.raw).toContain('Subject: Your Atlas Provisions sign-in code');
  });
  it('sends through Resend when RESEND_API_KEY is set, and not through send_email', async () => {
    const fetchStub = vi.fn(async () => new Response('{"id":"abc"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);
    const { db } = fakeDb();
    const res = await call(
      `${H}/auth/request`,
      json({ email: 'owner@example.com' }),
      makeEnv(db, { RESEND_API_KEY: 're_test_123' }),
    );
    expect(res.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(JSON.parse(init.body as string).to).toEqual(['owner@example.com']);
  });

  it('returns the usual mail error and logs the detail when Resend fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('domain not verified', { status: 403 })));
    const errors: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const { db, codes } = fakeDb();
    const res = await call(
      `${H}/auth/request`,
      json({ email: 'owner@example.com' }),
      makeEnv(db, { RESEND_API_KEY: 're_test_123' }),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't send the email" });
    expect(errors.some((args) => String(args[1]).includes('Resend 403: domain not verified'))).toBe(true);
    expect(codes.size).toBe(1);
  });

  it('keeps dev mode log-only even when RESEND_API_KEY is set', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    const { db } = fakeDb();
    const env = makeEnv(db, { DEV: '1', DEV_AUTH_EMAIL: 'owner@example.com', RESEND_API_KEY: 're_test_123' });
    const res = await call(`${H}/auth/request`, json({ email: 'owner@example.com' }), env);
    expect(res.status).toBe(200);
    expect(fetchStub).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes('sign-in code for owner@example.com'))).toBe(true);
  });
});
