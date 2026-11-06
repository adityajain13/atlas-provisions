// The regular-price batch on a real in-memory database with a fake fetch: what it writes, the budget, the auth stop,
// the six-day skip, the household order, the location cache and what the offers read back. No network.
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { defaultHousehold, siteOffers, type Household, type Store } from '@provisions/shared';
import { newTestDb } from './testing/d1';
import { count } from './testing/app';
import { priceHistory, sitePriceRows } from './db';
import {
  STAPLE_IDS,
  cachedLocations,
  lookupOrder,
  nextSiteHousehold,
  runScheduledSite,
  runSitePrices,
  searchTermFor,
  siteStatus,
  siteTargets,
  siteWaitMinutes,
} from './sitePrices';
import { INGREDIENT_BY_ID } from '@provisions/shared';

const NOW = new Date('2026-11-04T15:00:00.000Z');
const BUDGET_STOP = 'Stopped early: the request budget for one run is used up.';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function store(over: Partial<Store> & { id: string; name: string }): Store {
  return { enabled: true, priceMatches: false, ...over };
}

const NO_FRILLS = store({ id: 'no-frills', name: 'No Frills', group: 'Loblaw', siteStore: { banner: 'nofrills', storeId: '1234', label: 'No Frills · 1000 Dixie Rd, Mississauga' } });
const SUPERSTORE = store({ id: 'real-canadian-superstore', name: 'Real Canadian Superstore', group: 'Loblaw', siteStore: { banner: 'superstore', storeId: '5678', label: 'Real Canadian Superstore · 2400 Erin Mills Pkwy, Mississauga' } });

function household(stores: Store[], over: Partial<Household> = {}): Household {
  return { ...defaultHousehold(), postalCode: 'L5L3T4', stores, ...over };
}

function addHousehold(raw: DatabaseSync, id: string, doc: Household) {
  raw.prepare("INSERT INTO households (id, name, data, created_at, updated_at) VALUES (?, ?, ?, 'now', 'now')").run(id, id, JSON.stringify(doc));
}

/** A search that finds the term itself as a 1 kg pack at the given price, for every term. */
function everythingAtOneKg(price = 8, extra: Record<string, unknown> = {}) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { term: string };
    return json({ results: [{ code: body.term, name: body.term, packageSize: '1 kg', prices: { price: { value: price } }, ...extra }] });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const termsOf = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).term as string);

describe('lookupOrder', () => {
  it('puts the list ingredients and the always-buy and pinned ones first, then the pantry, then the staples', () => {
    const doc = household([NO_FRILLS], {
      itemRules: [
        { id: 'a', name: 'Eggs', rule: 'always' },
        { id: 'p', name: 'Lemons', rule: 'pin', store: 'No Frills', ingredientId: 'cheddar' },
      ],
    });
    const plan = { list: [{ ingredientId: 'ground-beef' }] } as never;
    const order = lookupOrder({
      plans: [plan, null],
      household: doc,
      pantry: [{ ingredientId: 'rice-noodles' } as never],
    });
    expect(order.slice(0, 4)).toEqual(['ground-beef', 'eggs-large', 'cheddar', 'rice-noodles']);
    expect(order).toEqual([...new Set(order)]);
    expect(order).toEqual(expect.arrayContaining(STAPLE_IDS));
  });

  it('drops ids that are not in the catalogue', () => {
    const order = lookupOrder({ plans: [{ list: [{ ingredientId: 'not-a-food' }] } as never], household: household([]), pantry: [] });
    expect(order).not.toContain('not-a-food');
  });
});

describe('siteTargets', () => {
  it('keeps enabled stores with a location on a banner the app reads', () => {
    const doc = household([NO_FRILLS, { ...SUPERSTORE, enabled: false }, store({ id: 'metro', name: 'Metro', siteStore: { banner: 'nofrills', storeId: '1', label: 'x' } }), store({ id: 'no-frills', name: 'Old', enabled: true })]);
    expect(siteTargets(doc).map((t) => [t.store.name, t.banner, t.storeId])).toEqual([['No Frills', 'nofrills', '1234']]);
  });

  it('uses the first search term of an ingredient', () => {
    expect(searchTermFor(INGREDIENT_BY_ID['chicken-thigh-boneless']!)).toBe(INGREDIENT_BY_ID['chicken-thigh-boneless']!.aliases[0]);
  });
});

describe('runSitePrices', () => {
  it('writes a matched price as a site row for the location, with its regular price and pack size', async () => {
    const { raw, DB } = newTestDb();
    addHousehold(raw, 'h1', household([NO_FRILLS], { itemRules: [{ id: 'p', name: 'Ground beef', rule: 'pin', store: 'No Frills', ingredientId: 'ground-beef' }] }));
    const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { term: string };
      return json({ results: [{ name: body.term, packageSize: '1 kg', prices: { price: { value: 12 }, wasPrice: { value: 15 } } }] });
    }) as unknown as typeof fetch;

    const got = await runSitePrices({ DB }, 'h1', fetchImpl, 1, NOW);
    // More ingredients were wanted than the budget of one, so the batch says it stopped early.
    expect(got).toEqual({ ok: true, lookups: 1, matched: 1, errors: [BUDGET_STOP], authNeeded: false });
    expect(raw.prepare("SELECT ingredient_id, store, date, price_per_unit, on_sale, source, household_id, pack_qty, site_store_id, regular_price_per_unit FROM price_history WHERE source = 'site'").all()).toEqual([
      {
        ingredient_id: 'ground-beef',
        store: 'No Frills',
        date: '2026-11-04',
        price_per_unit: 12,
        on_sale: 1,
        source: 'site',
        household_id: '',
        pack_qty: 1,
        site_store_id: '1234',
        regular_price_per_unit: 15,
      },
    ]);
    expect(raw.prepare('SELECT banner, store_id, ingredient_id, matched FROM site_lookups').all()).toEqual([
      { banner: 'nofrills', store_id: '1234', ingredient_id: 'ground-beef', matched: 1 },
    ]);
    const runs = raw.prepare('SELECT ok, lookups, matched, auth_needed FROM site_price_runs').all();
    expect(runs).toEqual([{ ok: 1, lookups: 1, matched: 1, auth_needed: 0 }]);
  });

  it('does nothing and sends nothing when no store has a location', async () => {
    const { raw, DB } = newTestDb();
    addHousehold(raw, 'h1', household([store({ id: 'no-frills', name: 'No Frills', group: 'Loblaw' })]));
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const got = await runSitePrices({ DB }, 'h1', fetchImpl, 40, NOW);
    expect(got.ok).toBe(false);
    expect(got.errors[0]).toMatch(/location/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(count(raw, 'site_price_runs')).toBe(0);
  });

  it('stops a banner at the first sign-in error, sets authNeeded, and carries on with another banner', async () => {
    const { raw, DB } = newTestDb();
    addHousehold(raw, 'h1', household([NO_FRILLS, SUPERSTORE]));
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { banner?: string; term: string };
      if (body.banner === 'nofrills') return new Response('sign in', { status: 401 });
      return json({ results: [{ name: body.term, packageSize: '1 kg', prices: { price: { value: 9 } } }] });
    }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

    const got = await runSitePrices({ DB }, 'h1', fetchImpl, 40, NOW);
    expect(got.authNeeded).toBe(true);
    expect(got.ok).toBe(true);
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).banner);
    expect(calls.filter((b) => b === 'nofrills')).toHaveLength(1);
    expect(calls.filter((b) => b === 'superstore').length).toBeGreaterThan(1);
    expect(raw.prepare('SELECT auth_needed FROM site_price_runs').get()).toEqual({ auth_needed: 1 });
    expect(count(raw, 'price_history', "source = 'site' AND store = 'No Frills'")).toBe(0);
  });

  it('never sends more searches than its budget, and says so', async () => {
    const { raw, DB } = newTestDb();
    addHousehold(raw, 'h1', household([NO_FRILLS]));
    const fetchImpl = everythingAtOneKg();
    const got = await runSitePrices({ DB }, 'h1', fetchImpl, 3, NOW);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(got.lookups).toBe(3);
    expect(got.errors).toEqual([BUDGET_STOP]);
  });

  it('does not look up again a pair looked up in the last six days, and does after seven', async () => {
    const { raw, DB } = newTestDb();
    addHousehold(raw, 'h1', household([NO_FRILLS]));
    const first = everythingAtOneKg();
    await runSitePrices({ DB }, 'h1', first, 3, NOW);
    const firstTerms = termsOf(first);

    const second = everythingAtOneKg();
    await runSitePrices({ DB }, 'h1', second, 3, new Date(NOW.getTime() + 86_400_000));
    const secondTerms = termsOf(second);
    expect(secondTerms.filter((t) => firstTerms.includes(t))).toEqual([]);

    const third = everythingAtOneKg();
    await runSitePrices({ DB }, 'h1', third, 1, new Date(NOW.getTime() + 7 * 86_400_000));
    expect(termsOf(third)).toEqual([firstTerms[0]]);
  });

  it('stops a banner after a block (429) instead of sending more searches', async () => {
    const { raw, DB } = newTestDb();
    addHousehold(raw, 'h1', household([NO_FRILLS]));
    const fetchImpl = vi.fn(async () => new Response('', { status: 429 })) as unknown as typeof fetch;
    const got = await runSitePrices({ DB }, 'h1', fetchImpl, 40, NOW);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(got.ok).toBe(false);
    expect(got.authNeeded).toBe(false);
  });
});

describe('the Sunday choice of household and budget', () => {
  it('picks the household that has waited longest, and skips one with no location', async () => {
    const { raw, DB } = newTestDb();
    addHousehold(raw, 'h_never', household([NO_FRILLS]));
    addHousehold(raw, 'h_old', household([NO_FRILLS]));
    addHousehold(raw, 'h_plain', household([store({ id: 'no-frills', name: 'No Frills', group: 'Loblaw' })]));
    raw.prepare("INSERT INTO site_price_runs (id, household_id, started_at, finished_at, ok, lookups, matched, errors) VALUES ('r1', 'h_old', '2026-11-01T10:00:00Z', '2026-11-01T10:01:00Z', 1, 1, 1, '[]')").run();
    expect(await nextSiteHousehold(DB)).toBe('h_never');
    raw.prepare("INSERT INTO site_price_runs (id, household_id, started_at, finished_at, ok, lookups, matched, errors) VALUES ('r2', 'h_never', '2026-11-02T10:00:00Z', '2026-11-02T10:01:00Z', 1, 1, 1, '[]')").run();
    expect(await nextSiteHousehold(DB)).toBe('h_old');
  });

  it('runs nothing with no budget left', async () => {
    const { raw, DB } = newTestDb();
    addHousehold(raw, 'h1', household([NO_FRILLS]));
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await runScheduledSite({ DB }, NOW, fetchImpl, 0)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('the location cache', () => {
  const body = { pickupLocations: [{ storeId: '1234', name: 'No Frills Dixie', address: { line1: '1000 Dixie Rd', town: 'Mississauga', postalCode: 'L4Y2A2' } }] };

  it('reads the locations once a week, and asks again after that', async () => {
    const { DB } = newTestDb();
    const fetchImpl = vi.fn(async () => json(body)) as unknown as typeof fetch;
    await cachedLocations(DB, 'nofrills', fetchImpl, NOW);
    await cachedLocations(DB, 'nofrills', fetchImpl, new Date(NOW.getTime() + 6 * 86_400_000));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const later = await cachedLocations(DB, 'nofrills', fetchImpl, new Date(NOW.getTime() + 8 * 86_400_000));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(later.ok && later.value[0]?.storeId).toBe('1234');
  });

  it('does not keep an empty listing, so the next search asks again', async () => {
    const { DB } = newTestDb();
    const fetchImpl = vi.fn(async () => json({ pickupLocations: [] })) as unknown as typeof fetch;
    await cachedLocations(DB, 'zehrs', fetchImpl, NOW);
    await cachedLocations(DB, 'zehrs', fetchImpl, NOW);
    // An empty listing tries all three location endpoints each time, and none is cached.
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it('keeps a failed listing out of the cache', async () => {
    const { DB } = newTestDb();
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    const got = await cachedLocations(DB, 'loblaws', fetchImpl, NOW);
    expect(got).toMatchObject({ ok: false, error: { kind: 'auth' } });
  });
});

describe('what the batch leaves for the offers and the status', () => {
  it('reads the site rows back for the offers, and leaves them out of deal scoring history', async () => {
    const { raw, DB } = newTestDb();
    addHousehold(raw, 'h1', household([NO_FRILLS]));
    raw.prepare(
      `INSERT INTO price_history (ingredient_id, store, date, price_per_unit, on_sale, source, household_id, pack_qty, site_store_id, regular_price_per_unit)
       VALUES ('ground-beef', 'No Frills', '2026-11-03', 12, 0, 'site', '', 1, '1234', 15)`,
    ).run();
    raw.prepare(
      `INSERT INTO price_history (ingredient_id, store, date, price_per_unit, on_sale, source, household_id, pack_qty, site_store_id)
       VALUES ('cheddar', 'No Frills', '2026-11-03', 3, 1, 'site', '', 0.4, '1234')`,
    ).run();
    raw.prepare(
      `INSERT INTO price_history (ingredient_id, store, date, price_per_unit, on_sale, source, household_id, pack_qty, site_store_id)
       VALUES ('cheddar', 'No Frills', '2026-11-03', 3, 1, 'site', '', 0.4, '9999')`,
    ).run();

    const rows = await sitePriceRows(DB, [{ store: 'No Frills', storeId: '1234' }], '2026-10-21');
    expect(rows.map((r) => r.ingredientId).sort()).toEqual(['cheddar', 'ground-beef']);
    const offers = siteOffers(rows, '2026-10-21', '2026-11-04');
    // Ground beef's regular price is the offer. Cheddar was on sale with no regular price, so it is no offer.
    expect(offers).toEqual([
      { ingredientId: 'ground-beef', store: 'No Frills', pricePerUnit: 15, packQty: 1, packPrice: 15, estimate: { basis: 'site', date: '2026-11-03' } },
    ]);

    expect((await priceHistory(DB, 'h1', '2026-10-01')).map((h) => h.ingredientId)).not.toContain('ground-beef');
  });

  it('reports the latest run and the prices in the window, and waits ten minutes between hand refreshes', async () => {
    const { raw, DB } = newTestDb();
    const doc = household([NO_FRILLS], {
      itemRules: [
        { id: 'g', name: 'Ground beef', rule: 'pin', store: 'No Frills', ingredientId: 'ground-beef' },
        { id: 'c', name: 'Chicken thighs', rule: 'pin', store: 'No Frills', ingredientId: 'chicken-thigh-boneless' },
      ],
    });
    addHousehold(raw, 'h1', doc);
    await runSitePrices({ DB }, 'h1', everythingAtOneKg(), 2, NOW);
    const status = await siteStatus(DB, 'h1', doc, NOW, true);
    expect(status.lastRun).toMatchObject({ ok: true, lookups: 2, matched: 2, authNeeded: false });
    expect(status.lastRun?.sample).toBeDefined();
    expect(status.prices).toBe(2);
    expect(await siteWaitMinutes(DB, 'h1', new Date(NOW.getTime() + 2 * 60_000))).toBe(8);
    expect(await siteWaitMinutes(DB, 'h1', new Date(NOW.getTime() + 11 * 60_000))).toBe(0);
  });
});
