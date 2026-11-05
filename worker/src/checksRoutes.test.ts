// Shopping and prep tick routes against an in-memory D1 stub. No network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from './index';
import { sha256 } from './authCore';

type Stored = { week_of: string; kind: string; item_id: string; checked: number; updated_at: string; updated_by: string };
type Stmt = { sql: string; args: unknown[] };

/**
 * A D1 stub for the session lookup and the checks table. It recognises the statements the routes send:
 * the upsert (ON CONFLICT), INSERT OR IGNORE, and the week select.
 */
function fakeDb() {
  const sessions = new Map<string, { email: string; expires_at: number }>();
  const checks = new Map<string, Stored>();
  const batches: number[] = [];

  const exec = (sql: string, a: unknown[]): { row?: unknown; rows?: unknown[] } => {
    if (sql === 'SELECT email, expires_at FROM sessions WHERE id_hash = ?') {
      const s = sessions.get(a[0] as string);
      return { row: s ?? null };
    }
    if (sql.startsWith('SELECT kind, item_id, checked, updated_at FROM checks WHERE week_of = ?')) {
      const rows = [...checks.values()].filter((r) => r.week_of === a[0]);
      return { rows };
    }
    if (sql.startsWith('INSERT INTO checks') && sql.includes('ON CONFLICT(week_of, kind, item_id)')) {
      const [week_of, kind, item_id, checked, updated_at, updated_by] = a as [string, string, string, number, string, string];
      checks.set([week_of, kind, item_id].join('|'), { week_of, kind, item_id, checked, updated_at, updated_by });
      return {};
    }
    if (sql.startsWith('INSERT OR IGNORE INTO checks')) {
      const [week_of, kind, item_id, checked, updated_at, updated_by] = a as [string, string, string, number, string, string];
      const k = [week_of, kind, item_id].join('|');
      if (!checks.has(k)) checks.set(k, { week_of, kind, item_id, checked, updated_at, updated_by });
      return {};
    }
    throw new Error(`fake D1 does not know: ${sql}`);
  };

  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        _stmt: { sql, args: [] as unknown[] } as Stmt,
        bind(...values: unknown[]) {
          args = values;
          stmt._stmt = { sql, args };
          return stmt;
        },
        async first() {
          return (exec(sql, args).row ?? null) as unknown;
        },
        async run() {
          exec(sql, args);
          return { meta: { changes: 1 } };
        },
        async all() {
          return { results: exec(sql, args).rows ?? [] };
        },
      };
      return stmt;
    },
    async batch(stmts: { _stmt: Stmt }[]) {
      batches.push(stmts.length);
      for (const s of stmts) exec(s._stmt.sql, s._stmt.args);
      return [];
    },
  };

  async function signIn(token: string, email: string) {
    // A year out, so the session is not rolled forward during these tests.
    sessions.set(await sha256(token), { email, expires_at: Date.now() + 365 * 86_400_000 });
  }
  return { db, checks, batches, signIn };
}

const ENV_BASE = { ALLOWED_EMAILS: 'owner@example.com', ASSETS: { fetch: async () => new Response('asset') }, DEV: '0' };
const makeEnv = (db: unknown) => ({ ...ENV_BASE, DB: db }) as never;
const call = (path: string, init: RequestInit, env: unknown) => app.request(path, init, env as never);
const H = '/provisions/api/checks';
const SUNDAY = '2026-11-01';
const COOKIE = { cookie: 'ap_session=tok' };
const put = (body: unknown): RequestInit => ({
  method: 'PUT',
  headers: { ...COOKIE, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { ...COOKIE, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

async function setup() {
  const fake = fakeDb();
  await fake.signIn('tok', 'owner@example.com');
  return { ...fake, env: makeEnv(fake.db) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /checks/:weekOf', () => {
  it('returns 401 without a session', async () => {
    const { env } = await setup();
    const res = await call(`${H}/${SUNDAY}`, {}, env);
    expect(res.status).toBe(401);
  });

  it('returns empty records and a null updatedAt when nothing is saved', async () => {
    const { env } = await setup();
    const res = await call(`${H}/${SUNDAY}`, { headers: COOKIE }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ list: {}, prep: {}, updatedAt: null });
  });

  it('rejects a weekOf that is not a Sunday', async () => {
    const { env } = await setup();
    const res = await call(`${H}/2026-10-28`, { headers: COOKIE }, env);
    expect(res.status).toBe(400);
  });
});

describe('PUT /checks/:weekOf', () => {
  it('returns 401 without a session', async () => {
    const { env } = await setup();
    const res = await call(`${H}/${SUNDAY}`, { method: 'PUT', body: '{}' }, env);
    expect(res.status).toBe(401);
  });

  it('stores a tick and returns it on the next read, with explicit false for an unticked item', async () => {
    const { env } = await setup();
    await call(`${H}/${SUNDAY}`, put({ kind: 'list', itemId: 'spinach', checked: true }), env);
    await call(`${H}/${SUNDAY}`, put({ kind: 'prep', itemId: 'prep-1', checked: true }), env);
    await call(`${H}/${SUNDAY}`, put({ kind: 'prep', itemId: 'prep-1', checked: false }), env);

    const res = await call(`${H}/${SUNDAY}`, { headers: COOKIE }, env);
    const body = (await res.json()) as { list: Record<string, boolean>; prep: Record<string, boolean>; updatedAt: string };
    expect(body.list).toEqual({ spinach: true });
    expect(body.prep).toEqual({ 'prep-1': false });
    expect(body.updatedAt).toEqual(expect.any(String));
  });

  it('is last write wins, and records the signed-in address and the time', async () => {
    vi.useFakeTimers();
    const { env, checks } = await setup();
    vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
    await call(`${H}/${SUNDAY}`, put({ kind: 'list', itemId: 'milk', checked: true }), env);
    vi.setSystemTime(new Date('2026-11-01T12:05:00.000Z'));
    const second = await call(`${H}/${SUNDAY}`, put({ kind: 'list', itemId: 'milk', checked: false }), env);

    expect(await second.json()).toEqual({ updatedAt: '2026-11-01T12:05:00.000Z' });
    const row = checks.get(`${SUNDAY}|list|milk`);
    expect(row).toEqual({
      week_of: SUNDAY,
      kind: 'list',
      item_id: 'milk',
      checked: 0,
      updated_at: '2026-11-01T12:05:00.000Z',
      updated_by: 'owner@example.com',
    });
  });

  it.each([
    ['an unknown kind', { kind: 'plan', itemId: 'x', checked: true }],
    ['an empty item id', { kind: 'list', itemId: '', checked: true }],
    ['an item id over 200 characters', { kind: 'list', itemId: 'x'.repeat(201), checked: true }],
    ['a non-boolean checked', { kind: 'list', itemId: 'x', checked: 'yes' }],
  ])('rejects %s with 400', async (_name, body) => {
    const { env, checks } = await setup();
    const res = await call(`${H}/${SUNDAY}`, put(body), env);
    expect(res.status).toBe(400);
    expect(checks.size).toBe(0);
  });

  it('accepts an item id of exactly 200 characters', async () => {
    const { env } = await setup();
    const res = await call(`${H}/${SUNDAY}`, put({ kind: 'list', itemId: 'x'.repeat(200), checked: true }), env);
    expect(res.status).toBe(200);
  });

  it('rejects a weekOf that is not a Sunday', async () => {
    const { env, checks } = await setup();
    const res = await call(`${H}/2026-11-04`, put({ kind: 'list', itemId: 'x', checked: true }), env);
    expect(res.status).toBe(400);
    expect(checks.size).toBe(0);
  });
});

describe('POST /checks/:weekOf/bulk', () => {
  it('returns 401 without a session', async () => {
    const { env } = await setup();
    const res = await call(`${H}/${SUNDAY}/bulk`, { method: 'POST', body: '{}' }, env);
    expect(res.status).toBe(401);
  });

  it('inserts missing rows and leaves rows that already exist alone', async () => {
    const { env, checks, batches } = await setup();
    await call(`${H}/${SUNDAY}`, put({ kind: 'list', itemId: 'eggs', checked: false }), env);

    const res = await call(
      `${H}/${SUNDAY}/bulk`,
      post({ list: { eggs: true, milk: true }, prep: { 'prep-1': true } }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 3 });

    expect(checks.get(`${SUNDAY}|list|eggs`)?.checked).toBe(0);
    expect(checks.get(`${SUNDAY}|list|milk`)?.checked).toBe(1);
    expect(checks.get(`${SUNDAY}|prep|prep-1`)?.checked).toBe(1);
    expect(checks.get(`${SUNDAY}|list|milk`)?.updated_by).toBe('owner@example.com');
    expect(batches).toEqual([3]);
  });

  it('accepts an empty body as nothing to move', async () => {
    const { env, checks } = await setup();
    const res = await call(`${H}/${SUNDAY}/bulk`, post({}), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 0 });
    expect(checks.size).toBe(0);
  });

  it('rejects more than 500 items for one kind', async () => {
    const { env, checks } = await setup();
    const list = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`item-${i}`, true]));
    const res = await call(`${H}/${SUNDAY}/bulk`, post({ list }), env);
    expect(res.status).toBe(400);
    expect(checks.size).toBe(0);
  });

  it('rejects a weekOf that is not a Sunday', async () => {
    const { env } = await setup();
    const res = await call(`${H}/2026-11-04/bulk`, post({ list: { a: true } }), env);
    expect(res.status).toBe(400);
  });
});
