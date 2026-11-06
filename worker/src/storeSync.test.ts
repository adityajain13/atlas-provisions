// The per-store sync readings on a real in-memory database: the flyers of the household's postal code, the regular
// prices at each location, the T&T browser sync, and what is left out. No network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultHousehold, type Household, type Store } from '@provisions/shared';
import { API, OWNER, call, householdWith, setup, withCookie } from './testing/app';

const NOW = new Date('2026-11-06T15:00:00.000Z');

const NO_FRILLS: Store = {
  id: 'no-frills',
  name: 'No Frills',
  group: 'Loblaw',
  enabled: true,
  priceMatches: true,
  siteStore: { banner: 'nofrills', storeId: '1234', label: 'No Frills · 1000 Dixie Rd' },
};
const METRO: Store = { id: 'metro', name: 'Metro', group: 'Metro', enabled: true, priceMatches: false };
const TNT: Store = { id: 'tt-supermarket', name: 'T&T Supermarket', group: 'Other', enabled: true, priceMatches: false };

function doc(stores: Store[], over: Partial<Household> = {}): Household {
  return { ...defaultHousehold(), postalCode: 'L5L 3T4', stores, ...over };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /stores/sync', () => {
  it('needs a signed-in session', async () => {
    const { env } = await setup();
    expect((await call(`${API}/stores/sync`, {}, env)).status).toBe(401);
  });

  it('reports nothing for a household that has read no prices', async () => {
    const { env, cookies, raw } = await setup();
    await householdWith(raw, env, cookies[OWNER]!, OWNER, doc([NO_FRILLS, METRO, TNT]));
    const res = await call(`${API}/stores/sync`, withCookie(cookies[OWNER]!), env);
    expect(await res.json()).toEqual({ stores: {} });
  });

  it('reports a store\'s flyer: the newest fetch, the items still valid, and the newest valid day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { env, cookies, raw } = await setup();
    await householdWith(raw, env, cookies[OWNER]!, OWNER, doc([METRO]));
    const insert = raw.prepare(
      `INSERT INTO flyer_items (postal_code, id, store, raw_name, price_text, valid_from, valid_to, source, fetched_at)
       VALUES ('L5L3T4', ?, 'Metro', ?, '$3', '2026-11-05', ?, 'flipp', ?)`,
    );
    insert.run('old', 'Old milk', '2026-10-30', '2026-10-29T12:00:00.000Z');
    insert.run('a', 'Milk', '2026-11-12', '2026-11-05T12:00:00.000Z');
    insert.run('b', 'Eggs', '2026-11-12', '2026-11-05T12:00:00.000Z');
    const res = await call(`${API}/stores/sync`, withCookie(cookies[OWNER]!), env);
    expect(await res.json()).toEqual({
      stores: { metro: { flyer: { at: '2026-11-05T12:00:00.000Z', count: 2, validTo: '2026-11-12' } } },
    });
  });

  it('reports an expired flyer with a count of zero', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { env, cookies, raw } = await setup();
    await householdWith(raw, env, cookies[OWNER]!, OWNER, doc([METRO]));
    raw
      .prepare(
        `INSERT INTO flyer_items (postal_code, id, store, raw_name, price_text, valid_from, valid_to, source, fetched_at)
         VALUES ('L5L3T4', 'a', 'Metro', 'Milk', '$3', '2026-10-23', '2026-10-30', 'flipp', '2026-10-23T12:00:00.000Z')`,
      )
      .run();
    const res = await call(`${API}/stores/sync`, withCookie(cookies[OWNER]!), env);
    expect(await res.json()).toEqual({
      stores: { metro: { flyer: { at: '2026-10-23T12:00:00.000Z', count: 0, validTo: '2026-10-30' } } },
    });
  });

  it('reports the regular prices at a location from its last matched lookup and the ingredients priced there', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { env, cookies, raw } = await setup();
    await householdWith(raw, env, cookies[OWNER]!, OWNER, doc([NO_FRILLS]));
    const lookup = raw.prepare(
      'INSERT INTO site_lookups (banner, store_id, ingredient_id, looked_up_at, matched) VALUES (?, ?, ?, ?, ?)',
    );
    lookup.run('nofrills', '1234', 'eggs', '2026-11-04T10:00:00.000Z', 1);
    lookup.run('nofrills', '1234', 'milk', '2026-11-05T10:00:00.000Z', 1);
    lookup.run('nofrills', '1234', 'rice', '2026-11-05T11:00:00.000Z', 0); // not matched: not a read of the shelf
    lookup.run('nofrills', '9999', 'milk', '2026-11-06T09:00:00.000Z', 1); // another location
    const price = raw.prepare(
      `INSERT INTO price_history (ingredient_id, store, date, price_per_unit, on_sale, source, household_id, site_store_id)
       VALUES (?, 'No Frills', '2026-11-04', 2.5, 0, 'site', '', '1234')`,
    );
    price.run('eggs');
    price.run('milk');
    const res = await call(`${API}/stores/sync`, withCookie(cookies[OWNER]!), env);
    expect(await res.json()).toEqual({
      stores: { 'no-frills': { shelf: { at: '2026-11-05T10:00:00.000Z', count: 2 } } },
    });
  });

  it('leaves a disabled store out of the regular prices', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { env, cookies, raw } = await setup();
    await householdWith(raw, env, cookies[OWNER]!, OWNER, doc([{ ...NO_FRILLS, enabled: false }]));
    raw
      .prepare(
        "INSERT INTO site_lookups (banner, store_id, ingredient_id, looked_up_at, matched) VALUES ('nofrills', '1234', 'eggs', '2026-11-05T10:00:00.000Z', 1)",
      )
      .run();
    const res = await call(`${API}/stores/sync`, withCookie(cookies[OWNER]!), env);
    expect(await res.json()).toEqual({ stores: {} });
  });

  it('reports the T&T browser sync from the household\'s last browser run, with its prices in the region', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { env, cookies, raw } = await setup();
    await householdWith(raw, env, cookies[OWNER]!, OWNER, doc([TNT]));
    raw
      .prepare(
        `INSERT INTO site_price_runs (id, household_id, started_at, finished_at, ok, lookups, matched, errors, mode)
         VALUES ('r1', (SELECT id FROM households), '2026-11-05T09:00:00.000Z', '2026-11-05T09:02:00.000Z', 1, 4, 3, '[]', 'browser')`,
      )
      .run();
    raw
      .prepare(
        `INSERT INTO site_price_runs (id, household_id, started_at, finished_at, ok, lookups, matched, errors, mode)
         VALUES ('r2', (SELECT id FROM households), '2026-11-06T09:00:00.000Z', '2026-11-06T09:01:00.000Z', 1, 4, 3, '[]', 'browser')`,
      )
      .run();
    const price = raw.prepare(
      `INSERT INTO price_history (ingredient_id, store, date, price_per_unit, on_sale, source, household_id, site_store_id)
       VALUES (?, 'T&T Supermarket', '2026-11-05', 3.1, 0, 'site', '', 'tnt-ON')`,
    );
    price.run('tofu');
    price.run('bok-choy');
    price.run('ginger');
    const res = await call(`${API}/stores/sync`, withCookie(cookies[OWNER]!), env);
    expect(await res.json()).toEqual({
      stores: { 'tt-supermarket': { tnt: { at: '2026-11-06T09:01:00.000Z', count: 3 } } },
    });
  });

  it('keeps one household\'s reads to its own stores and postal code', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { env, cookies, raw } = await setup();
    await householdWith(raw, env, cookies[OWNER]!, OWNER, doc([METRO], { postalCode: 'K1A 0B1' }));
    raw
      .prepare(
        `INSERT INTO flyer_items (postal_code, id, store, raw_name, price_text, valid_from, valid_to, source, fetched_at)
         VALUES ('L5L3T4', 'a', 'Metro', 'Milk', '$3', '2026-11-05', '2026-11-12', 'flipp', '2026-11-05T12:00:00.000Z')`,
      )
      .run();
    const res = await call(`${API}/stores/sync`, withCookie(cookies[OWNER]!), env);
    expect(await res.json()).toEqual({ stores: {} });
  });
});
