// Shopping and prep tick routes, against a real in-memory database. No network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API, OWNER, SUNDAY, call, count, householdOf, json, rows, setup, withCookie } from './testing/app';

const H = `${API}/checks`;
const put = (body: unknown, cookie?: string) => json('PUT', body, cookie);
const post = (body: unknown, cookie?: string) => json('POST', body, cookie);

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
    const { env, cookies } = await setup();
    const res = await call(`${H}/${SUNDAY}`, withCookie(cookies[OWNER]!), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ list: {}, prep: {}, updatedAt: null });
  });

  it('rejects a weekOf that is not a Sunday', async () => {
    const { env, cookies } = await setup();
    const res = await call(`${H}/2026-10-28`, withCookie(cookies[OWNER]!), env);
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
    const { env, cookies } = await setup();
    const c = withCookie(cookies[OWNER]!);
    await call(`${H}/${SUNDAY}`, put({ kind: 'list', itemId: 'spinach', checked: true }, cookies[OWNER]), env);
    await call(`${H}/${SUNDAY}`, put({ kind: 'prep', itemId: 'prep-1', checked: true }, cookies[OWNER]), env);
    await call(`${H}/${SUNDAY}`, put({ kind: 'prep', itemId: 'prep-1', checked: false }, cookies[OWNER]), env);

    const res = await call(`${H}/${SUNDAY}`, c, env);
    const body = (await res.json()) as { list: Record<string, boolean>; prep: Record<string, boolean>; updatedAt: string };
    expect(body.list).toEqual({ spinach: true });
    expect(body.prep).toEqual({ 'prep-1': false });
    expect(body.updatedAt).toEqual(expect.any(String));
  });

  it('is last write wins, and records the signed-in address and the time', async () => {
    vi.useFakeTimers();
    const { env, cookies, raw } = await setup();
    vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
    await call(`${H}/${SUNDAY}`, put({ kind: 'list', itemId: 'milk', checked: true }, cookies[OWNER]), env);
    vi.setSystemTime(new Date('2026-11-01T12:05:00.000Z'));
    const second = await call(`${H}/${SUNDAY}`, put({ kind: 'list', itemId: 'milk', checked: false }, cookies[OWNER]), env);

    expect(await second.json()).toEqual({ updatedAt: '2026-11-01T12:05:00.000Z' });
    expect(rows(raw, 'SELECT * FROM checks WHERE item_id = ?', 'milk')).toEqual([
      {
        household_id: householdOf(raw, OWNER),
        week_of: SUNDAY,
        kind: 'list',
        item_id: 'milk',
        checked: 0,
        updated_at: '2026-11-01T12:05:00.000Z',
        updated_by: OWNER,
      },
    ]);
  });

  it.each([
    ['an unknown kind', { kind: 'plan', itemId: 'x', checked: true }],
    ['an empty item id', { kind: 'list', itemId: '', checked: true }],
    ['an item id over 200 characters', { kind: 'list', itemId: 'x'.repeat(201), checked: true }],
    ['a non-boolean checked', { kind: 'list', itemId: 'x', checked: 'yes' }],
  ])('rejects %s with 400', async (_name, body) => {
    const { env, cookies, raw } = await setup();
    const res = await call(`${H}/${SUNDAY}`, put(body, cookies[OWNER]), env);
    expect(res.status).toBe(400);
    expect(count(raw, 'checks')).toBe(0);
  });

  it('accepts an item id of exactly 200 characters', async () => {
    const { env, cookies } = await setup();
    const res = await call(`${H}/${SUNDAY}`, put({ kind: 'list', itemId: 'x'.repeat(200), checked: true }, cookies[OWNER]), env);
    expect(res.status).toBe(200);
  });

  it('rejects a weekOf that is not a Sunday', async () => {
    const { env, cookies, raw } = await setup();
    const res = await call(`${H}/2026-11-04`, put({ kind: 'list', itemId: 'x', checked: true }, cookies[OWNER]), env);
    expect(res.status).toBe(400);
    expect(count(raw, 'checks')).toBe(0);
  });
});

describe('POST /checks/:weekOf/bulk', () => {
  it('returns 401 without a session', async () => {
    const { env } = await setup();
    const res = await call(`${H}/${SUNDAY}/bulk`, { method: 'POST', body: '{}' }, env);
    expect(res.status).toBe(401);
  });

  it('inserts missing rows and leaves rows that already exist alone', async () => {
    const { env, cookies, raw } = await setup();
    await call(`${H}/${SUNDAY}`, put({ kind: 'list', itemId: 'eggs', checked: false }, cookies[OWNER]), env);

    const res = await call(
      `${H}/${SUNDAY}/bulk`,
      post({ list: { eggs: true, milk: true }, prep: { 'prep-1': true } }, cookies[OWNER]),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 3 });

    const saved = Object.fromEntries(
      rows<{ kind: string; item_id: string; checked: number; updated_by: string }>(raw, 'SELECT kind, item_id, checked, updated_by FROM checks').map(
        (r) => [`${r.kind}|${r.item_id}`, r],
      ),
    );
    expect(saved['list|eggs']?.checked).toBe(0);
    expect(saved['list|milk']?.checked).toBe(1);
    expect(saved['prep|prep-1']?.checked).toBe(1);
    expect(saved['list|milk']?.updated_by).toBe(OWNER);
  });

  it('accepts an empty body as nothing to move', async () => {
    const { env, cookies, raw } = await setup();
    const res = await call(`${H}/${SUNDAY}/bulk`, post({}, cookies[OWNER]), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 0 });
    expect(count(raw, 'checks')).toBe(0);
  });

  it('rejects more than 500 items for one kind', async () => {
    const { env, cookies, raw } = await setup();
    const list = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`item-${i}`, true]));
    const res = await call(`${H}/${SUNDAY}/bulk`, post({ list }, cookies[OWNER]), env);
    expect(res.status).toBe(400);
    expect(count(raw, 'checks')).toBe(0);
  });

  it('rejects a weekOf that is not a Sunday', async () => {
    const { env, cookies } = await setup();
    const res = await call(`${H}/2026-11-04/bulk`, post({ list: { a: true } }, cookies[OWNER]), env);
    expect(res.status).toBe(400);
  });
});
