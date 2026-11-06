// The browser sync's routes through the Worker app: sync keys (made, rotated, revoked), Bearer auth on the plan and the
// results, CORS for the T&T site and the extensions only, the caps, and what a browser run writes. No network.
import { describe, expect, it } from 'vitest';
import { defaultHousehold, type Household, type Store } from '@provisions/shared';
import { API, OWNER, call, count, householdWith, json, rows, setup, withCookie } from './testing/app';

const TNT: Store = { id: 'tt-supermarket', name: 'T&T Supermarket', group: 'Other', enabled: true, priceMatches: false };
const TOFU_TERM = 'Firm tofu';

const TNT_ORIGIN = 'https://www.tntsupermarket.com';

function doc(over: Partial<Household> = {}): Household {
  return { ...defaultHousehold(), postalCode: 'L5L 3T4', stores: [TNT], ...over };
}

/** A storefront item, the way the search sends it. */
function tntItem(name: string, price: number, over: Record<string, unknown> = {}) {
  return {
    id: 1,
    sku: `SKU-${name}`,
    name,
    stock_status: 'IN_STOCK',
    price: { regularPrice: { amount: { currency: 'CAD', value: price } } },
    price_range: { minimum_price: { final_price: { currency: 'CAD', value: price } } },
    was_price: null,
    uom_type: null,
    weight_uom: null,
    ...over,
  };
}

/** Makes a sync key through the session route. */
async function makeKey(env: unknown, cookie: string, label: string) {
  const got = await call(`${API}/sync-keys`, withCookie(cookie, json('POST', { label })), env);
  return { status: got.status, body: (await got.json().catch(() => null)) as { id: string; label: string; key: string } | null };
}

/** A household with T&T enabled, signed in, and one sync key made through the session route. */
async function withKey(over: Partial<Household> = {}) {
  const ctx = await setup();
  const cookie = ctx.cookies[OWNER]!;
  await householdWith(ctx.raw, ctx.env, cookie, OWNER, doc(over));
  const made = await makeKey(ctx.env, cookie, 'Test device');
  return { ...ctx, cookie, key: made.body!.key, keyId: made.body!.id };
}

const bearer = (key: string, origin = TNT_ORIGIN): RequestInit => ({
  headers: { authorization: `Bearer ${key}`, origin },
});

describe('sync keys', () => {
  it('makes a key with a label, shows it once, and lists the keys without theirs', async () => {
    const { env, cookie, key, raw } = await withKey();
    expect(key.length).toBeGreaterThanOrEqual(40);
    const list = (await (await call(`${API}/sync-keys`, withCookie(cookie), env)).json()) as { id: string; label: string; createdAt: string; lastUsedAt: string | null }[];
    expect(list).toEqual([{ id: expect.any(String), label: 'Test device', createdAt: expect.any(String), lastUsedAt: null }]);
    expect(JSON.stringify(list)).not.toContain(key);
    const stored = rows<{ key_hash: string }>(raw, 'SELECT key_hash FROM sync_keys');
    expect(stored[0]!.key_hash).not.toContain(key);
  });

  it('makes another key without changing the first, and both work', async () => {
    const { env, cookie, key } = await withKey();
    const second = await makeKey(env, cookie, 'iPhone bookmark');
    expect(second.status).toBe(200);
    expect(second.body!.key).not.toBe(key);
    expect((await call(`${API}/tnt-sync/plan`, bearer(key), env)).status).toBe(200);
    expect((await call(`${API}/tnt-sync/plan`, bearer(second.body!.key), env)).status).toBe(200);
  });

  it('revokes one key: that key is refused and the others keep working', async () => {
    const { env, cookie, key, keyId } = await withKey();
    const other = await makeKey(env, cookie, 'Chrome on Windows');
    expect((await call(`${API}/sync-keys/${keyId}`, withCookie(cookie, { method: 'DELETE' }), env)).status).toBe(200);
    expect((await call(`${API}/tnt-sync/plan`, bearer(key), env)).status).toBe(401);
    expect((await call(`${API}/tnt-sync/plan`, bearer(other.body!.key), env)).status).toBe(200);
    const labels = ((await (await call(`${API}/sync-keys`, withCookie(cookie), env)).json()) as { label: string }[]).map((k) => k.label);
    expect(labels).toEqual(['Chrome on Windows']);
  });

  it('answers 404 when revoking a key that is not there, and twice', async () => {
    const { env, cookie, keyId } = await withKey();
    expect((await call(`${API}/sync-keys/nope`, withCookie(cookie, { method: 'DELETE' }), env)).status).toBe(404);
    expect((await call(`${API}/sync-keys/${keyId}`, withCookie(cookie, { method: 'DELETE' }), env)).status).toBe(200);
    expect((await call(`${API}/sync-keys/${keyId}`, withCookie(cookie, { method: 'DELETE' }), env)).status).toBe(404);
  });

  it('caps a household at ten keys, and answers 409 with the way out for the eleventh', async () => {
    const { env, cookie } = await withKey();
    for (let i = 2; i <= 10; i++) expect((await makeKey(env, cookie, `Device ${i}`)).status).toBe(200);
    const over = await makeKey(env, cookie, 'One too many');
    expect(over.status).toBe(409);
    const text = await (await call(`${API}/sync-keys`, withCookie(cookie, json('POST', { label: 'x' })), env)).text();
    expect(text).toMatch(/already have 10 sync keys/);
    expect(((await (await call(`${API}/sync-keys`, withCookie(cookie), env)).json()) as unknown[]).length).toBe(10);
  });

  it('needs a label of 1 to 40 characters', async () => {
    const { env, cookie } = await withKey();
    expect((await makeKey(env, cookie, '   ')).status).toBe(400);
    expect((await makeKey(env, cookie, 'x'.repeat(41))).status).toBe(400);
  });

  it('refuses a wrong key, a missing key and a key that is not Bearer', async () => {
    const { env } = await withKey();
    expect((await call(`${API}/tnt-sync/plan`, bearer('not-the-key'), env)).status).toBe(401);
    expect((await call(`${API}/tnt-sync/plan`, { headers: {} }, env)).status).toBe(401);
    expect((await call(`${API}/tnt-sync/plan`, { headers: { authorization: 'Basic abc' } }, env)).status).toBe(401);
  });

  it('does not take a sync key for a session: the session routes still need the cookie', async () => {
    const { env, key } = await withKey();
    expect((await call(`${API}/sync-keys`, { headers: { authorization: `Bearer ${key}` } }, env)).status).toBe(401);
  });
});

describe('CORS for the sync', () => {
  it('echoes the T&T site and both extension origins, and sends no credentials header', async () => {
    const { env, key } = await withKey();
    for (const origin of [TNT_ORIGIN, 'moz-extension://6f1c2a9e-0000-4000-8000-000000000000', 'chrome-extension://abcdefghijklmnop']) {
      const got = await call(`${API}/tnt-sync/plan`, bearer(key, origin), env);
      expect(got.status).toBe(200);
      expect(got.headers.get('access-control-allow-origin')).toBe(origin);
      expect(got.headers.get('access-control-allow-credentials')).toBeNull();
    }
  });

  it('answers a preflight for an allowed origin with the methods and headers, and a stranger with none', async () => {
    const { env, key } = await withKey();
    const ok = await call(
      `${API}/tnt-sync/results`,
      { method: 'OPTIONS', headers: { origin: TNT_ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' } },
      env,
    );
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe(TNT_ORIGIN);
    expect(ok.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
    expect(ok.headers.get('access-control-allow-headers')).toBe('Authorization, Content-Type');

    const planPre = await call(`${API}/tnt-sync/plan`, { method: 'OPTIONS', headers: { origin: TNT_ORIGIN } }, env);
    expect(planPre.status).toBe(204);
    expect(planPre.headers.get('access-control-allow-origin')).toBe(TNT_ORIGIN);

    const stranger = await call(`${API}/tnt-sync/results`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }, env);
    expect(stranger.headers.get('access-control-allow-origin')).toBeNull();
    const strangerPlan = await call(`${API}/tnt-sync/plan`, bearer(key, 'https://evil.example'), env);
    expect(strangerPlan.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('the plan', () => {
  it('lists ingredients to search for T&T, with the region, the postal prefix, the query and the pacing', async () => {
    const { env, key } = await withKey();
    const plan = (await (await call(`${API}/tnt-sync/plan`, bearer(key), env)).json()) as {
      region: string;
      postcode: string;
      query: string;
      operationName: string;
      pageSize: number;
      delayMs: number;
      terms: { ingredientId: string; term: string }[];
    };
    expect(plan).toMatchObject({ region: 'ON', postcode: 'L5L', operationName: 'ProductSearch', pageSize: 24, delayMs: 800 });
    expect(plan.query).toContain('query ProductSearch');
    expect(plan.terms.length).toBeGreaterThan(0);
    expect(plan.terms.length).toBeLessThanOrEqual(40);
    expect(plan.terms.some((t) => t.ingredientId === 'eggs-large')).toBe(true);
    expect(new Set(plan.terms.map((t) => t.ingredientId)).size).toBe(plan.terms.length);
  });

  it('gives no terms, and the reason, when T&T is not one of the household\'s stores', async () => {
    const { env, key } = await withKey({ stores: [{ ...TNT, enabled: false }] });
    expect(await (await call(`${API}/tnt-sync/plan`, bearer(key), env)).json()).toEqual({
      terms: [],
      reason: "T&T isn't one of your stores",
    });
  });

  it('gives no terms when the postal code is not in a covered province', async () => {
    const { env, key } = await withKey({ postalCode: 'B3H 1A1' });
    const got = (await (await call(`${API}/tnt-sync/plan`, bearer(key), env)).json()) as { terms: unknown[]; reason: string };
    expect(got.terms).toEqual([]);
    expect(got.reason).toMatch(/postal code/);
  });
});

describe('the results', () => {
  it('stores the matched price for the region, records the lookups, and writes one browser run', async () => {
    const { env, key, raw } = await withKey();
    const body = {
      results: [
        { ingredientId: 'tofu-firm', term: TOFU_TERM, items: [tntItem('Firm Tofu 454g', 3.99, { price_range: { minimum_price: { final_price: { value: 2.99 } } }, was_price: 3.99 })] },
        { ingredientId: 'eggs-large', term: 'Large eggs', items: [tntItem('Free Range Eggs', 5.49)] },
      ],
    };
    const got = await call(`${API}/tnt-sync/results`, { method: 'POST', headers: { authorization: `Bearer ${key}`, origin: TNT_ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env);
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual({ stored: 1, matched: 1, skipped: 1 });

    const prices = rows<{ ingredient_id: string; store: string; site_store_id: string; price_per_unit: number; on_sale: number; regular_price_per_unit: number | null; source: string }>(
      raw,
      "SELECT ingredient_id, store, site_store_id, price_per_unit, on_sale, regular_price_per_unit, source FROM price_history WHERE source = 'site'",
    );
    expect(prices).toHaveLength(1);
    expect(prices[0]).toMatchObject({ ingredient_id: 'tofu-firm', store: 'T&T Supermarket', site_store_id: 'tnt-ON', on_sale: 1, source: 'site' });
    expect(prices[0]!.price_per_unit).toBeCloseTo(2.99 / 454 * 1000, 6);
    expect(prices[0]!.regular_price_per_unit).toBeCloseTo(3.99 / 454 * 1000, 6);

    const runs = rows<{ mode: string; lookups: number; matched: number; ok: number }>(raw, 'SELECT mode, lookups, matched, ok FROM site_price_runs');
    expect(runs).toEqual([{ mode: 'browser', lookups: 2, matched: 1, ok: 1 }]);
    expect(count(raw, 'site_lookups', "banner = 'tnt' AND store_id = 'tnt-ON'")).toBe(2);
    expect(rows<{ last_used_at: string | null }>(raw, 'SELECT last_used_at FROM sync_keys')[0]!.last_used_at).not.toBeNull();
  });

  it('leaves an ingredient out of the next plan for six days after it was searched, matched or not', async () => {
    const { env, key } = await withKey();
    const before = (await (await call(`${API}/tnt-sync/plan`, bearer(key), env)).json()) as { terms: { ingredientId: string }[] };
    expect(before.terms.some((t) => t.ingredientId === 'eggs-large')).toBe(true);
    await call(
      `${API}/tnt-sync/results`,
      { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ results: [{ ingredientId: 'eggs-large', term: 'eggs', items: [] }] }) },
      env,
    );
    const after = (await (await call(`${API}/tnt-sync/plan`, bearer(key), env)).json()) as { terms: { ingredientId: string }[] };
    expect(after.terms.some((t) => t.ingredientId === 'eggs-large')).toBe(false);
  });

  it('refuses a body over 1 MB, more than 40 results, more than 50 items, and bad JSON', async () => {
    const { env, key } = await withKey();
    const post = (body: string) => call(`${API}/tnt-sync/results`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body }, env);
    expect((await post('x'.repeat(1_000_001))).status).toBe(413);
    expect((await post('{not json')).status).toBe(400);
    const many = Array.from({ length: 41 }, () => ({ ingredientId: 'eggs-large', term: 'eggs', items: [] }));
    expect((await post(JSON.stringify({ results: many }))).status).toBe(413);
    const items = Array.from({ length: 51 }, () => tntItem('Eggs 12 un', 5));
    expect((await post(JSON.stringify({ results: [{ ingredientId: 'eggs-large', term: 'eggs', items }] }))).status).toBe(413);
    expect((await post(JSON.stringify({ nope: true }))).status).toBe(400);
  });

  it('refuses results when T&T is no longer one of the stores', async () => {
    const { env, key, raw } = await withKey({ stores: [{ ...TNT, enabled: false }] });
    const got = await call(`${API}/tnt-sync/results`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ results: [] }) }, env);
    expect(got.status).toBe(409);
    expect(count(raw, 'site_price_runs')).toBe(0);
  });
});

describe('browser runs and the server runs', () => {
  it('reports the last browser sync on the status, and keeps it out of the regular-price status', async () => {
    const { env, cookie, key } = await withKey();
    await call(
      `${API}/tnt-sync/results`,
      { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ results: [{ ingredientId: 'tofu-firm', term: TOFU_TERM, items: [tntItem('Firm Tofu 454g', 3.99)] }] }) },
      env,
    );
    const status = (await (await call(`${API}/tnt-sync/status`, withCookie(cookie), env)).json()) as { enabled: boolean; lastRun: { ok: boolean; matched: number } | null; prices: number };
    expect(status).toMatchObject({ enabled: true, lastRun: { ok: true, matched: 1 }, prices: 1 });
    const regular = (await (await call(`${API}/site-prices/status`, withCookie(cookie), env)).json()) as { lastRun: unknown };
    expect(regular.lastRun).toBeNull();
  });
});
