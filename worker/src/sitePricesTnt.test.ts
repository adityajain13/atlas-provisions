// T&T in the regular-price batch: the store is read without a location, its rows are keyed by province, a block stops
// it, its prices reach the offers, and its pack and weight prices are per base unit. A fake fetch answers both sites.
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { INGREDIENT_BY_ID, defaultHousehold, siteOffers, type Household, type Store } from '@provisions/shared';
import { newTestDb } from './testing/d1';
import { sitePriceRows } from './db';
import { siteStatus, siteTargets, runSitePrices, tntOptionsOf, tntPackPrice, pickTntResult } from './sitePrices';
import { TNT_BLOCKED_MESSAGE, TNT_GRAPHQL_URL, type TntProduct } from './tnt';

const NOW = new Date('2026-11-04T15:00:00.000Z');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const LB = 1 / 0.4536;

const TNT: Store = { id: 'tt-supermarket', name: 'T&T Supermarket', group: 'Other', enabled: true, priceMatches: false };
const NO_FRILLS: Store = {
  id: 'no-frills',
  name: 'No Frills',
  group: 'Loblaw',
  enabled: true,
  priceMatches: true,
  siteStore: { banner: 'nofrills', storeId: '1234', label: 'No Frills · 1000 Dixie Rd, Mississauga' },
};

function household(stores: Store[], over: Partial<Household> = {}): Household {
  return { ...defaultHousehold(), postalCode: 'M5T 1R5', stores, ...over };
}

function addHousehold(raw: DatabaseSync, id: string, doc: Household) {
  raw.prepare("INSERT INTO households (id, name, data, created_at, updated_at) VALUES (?, ?, ?, 'now', 'now')").run(id, id, JSON.stringify(doc));
}

/** A storefront item the way the search sends it. */
function tntItem(name: string, price: number, regular = price, over: Record<string, unknown> = {}) {
  return {
    id: 1,
    sku: `SKU-${name}`,
    name,
    stock_status: 'IN_STOCK',
    price: { regularPrice: { amount: { currency: 'CAD', value: regular } } },
    price_range: { minimum_price: { final_price: { currency: 'CAD', value: price } } },
    was_price: null,
    uom_type: null,
    weight_uom: null,
    ...over,
  };
}

/** A storefront fake: the items answering each search term (matched on the input text), and no items for other terms. */
function tntFetch(byTerm: Record<string, unknown[]>) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (!u.startsWith(TNT_GRAPHQL_URL)) throw new Error(`unexpected request to ${u}`);
    const term = (JSON.parse(new URL(u).searchParams.get('variables') ?? '{}') as { inputText: string }).inputText;
    return json({ data: { products: { items: byTerm[term] ?? [], total_count: 0 } } });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const TOFU_PIN = [{ id: 'p', name: 'Firm tofu', rule: 'pin' as const, store: 'T&T Supermarket', ingredientId: 'tofu-firm' }];
const TOFU_TERM = INGREDIENT_BY_ID['tofu-firm']!.aliases[0]!;

describe('siteTargets with T&T', () => {
  it('reads an enabled T&T store with no location, keyed by its province', () => {
    expect(siteTargets(household([TNT])).map((t) => [t.store.name, t.banner, t.storeId])).toEqual([['T&T Supermarket', 'tandt', 'tnt-ON']]);
    expect(siteTargets(household([TNT], { postalCode: 'V6B 1A1' })).map((t) => t.storeId)).toEqual(['tnt-BC']);
  });

  it('leaves out a disabled T&T store', () => {
    expect(siteTargets(household([{ ...TNT, enabled: false }]))).toEqual([]);
  });

  it('gives the search its province and the postal prefix', () => {
    expect(tntOptionsOf(household([TNT]))).toEqual({ region: 'ON', postcode: 'M5T' });
    expect(tntOptionsOf(household([TNT], { postalCode: undefined }))).toEqual({ region: 'ON' });
    expect(tntOptionsOf(household([TNT], { postalCode: 'T2P 1J9' }))).toEqual({ region: 'AB', postcode: 'T2P' });
  });
});

describe('runSitePrices for T&T', () => {
  it('writes the sale as a site row keyed by the province, with the per-kilogram price and the regular price', async () => {
    const { raw, DB } = newTestDb();
    addHousehold(raw, 'h1', household([TNT], { itemRules: TOFU_PIN }));
    const fetchImpl = tntFetch({ [TOFU_TERM]: [tntItem('Firm Tofu 454g', 2.99, 3.49)] });

    const got = await runSitePrices({ DB }, 'h1', fetchImpl, 40, NOW);
    expect(got.ok).toBe(true);
    expect(got.matched).toBe(1);

    const first = fetchImpl.mock.calls[0]![0] as string;
    expect(first.startsWith(TNT_GRAPHQL_URL)).toBe(true);
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ headers: { 'x-postcode': 'M5T', 'x-current-region': 'ON' } });

    const row = raw
      .prepare("SELECT ingredient_id, store, price_per_unit, on_sale, source, pack_qty, site_store_id, regular_price_per_unit FROM price_history WHERE source = 'site'")
      .get() as Record<string, unknown>;
    expect(row).toMatchObject({ ingredient_id: 'tofu-firm', store: 'T&T Supermarket', on_sale: 1, source: 'site', site_store_id: 'tnt-ON' });
    expect(row.pack_qty as number).toBeCloseTo(0.454, 6);
    expect(row.price_per_unit as number).toBeCloseTo(2.99 / 0.454, 6);
    expect(row.regular_price_per_unit as number).toBeCloseTo(3.49 / 0.454, 6);
    expect(raw.prepare('SELECT banner, store_id, matched FROM site_lookups WHERE ingredient_id = ?').get('tofu-firm')).toEqual({
      banner: 'tandt',
      store_id: 'tnt-ON',
      matched: 1,
    });
  });

  it('reports a block once, in the words the Regular prices row shows, and sends no more T&T searches', async () => {
    const { raw, DB } = newTestDb();
    addHousehold(raw, 'h1', household([TNT]));
    const fetchImpl = vi.fn(async () => new Response('<html>Access Denied</html>', { status: 403 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

    const got = await runSitePrices({ DB }, 'h1', fetchImpl, 40, NOW);
    expect(got.errors).toEqual([TNT_BLOCKED_MESSAGE]);
    expect(got.ok).toBe(false);
    expect(got.authNeeded).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(raw.prepare('SELECT errors FROM site_price_runs').get()).toEqual({ errors: JSON.stringify([TNT_BLOCKED_MESSAGE]) });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM price_history WHERE source = 'site'").get()).toEqual({ n: 0 });
  });

  it('reads T&T and a Loblaw-family store in one run, and their rows reach the offers', async () => {
    const { raw, DB } = newTestDb();
    addHousehold(raw, 'h1', household([NO_FRILLS, TNT], { itemRules: TOFU_PIN }));
    const tnt = tntFetch({ [TOFU_TERM]: [tntItem('Firm Tofu 454g', 3.49)] });
    const loblaw = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { term: string };
      return json({ results: body.term === TOFU_TERM ? [{ name: 'Firm Tofu 454g', packageSize: '454 g', prices: { price: { value: 4.99 } } }] : [] });
    });
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
      String(url).startsWith(TNT_GRAPHQL_URL) ? tnt(url) : loblaw(url, init),
    ) as unknown as typeof fetch;

    await runSitePrices({ DB }, 'h1', fetchImpl, 40, NOW);
    const stores = raw.prepare("SELECT store, site_store_id FROM price_history WHERE source = 'site' AND ingredient_id = 'tofu-firm' ORDER BY store").all();
    expect(stores).toEqual([
      { store: 'No Frills', site_store_id: '1234' },
      { store: 'T&T Supermarket', site_store_id: 'tnt-ON' },
    ]);

    const rows = await sitePriceRows(DB, [{ store: 'T&T Supermarket', storeId: 'tnt-ON' }], '2026-10-01');
    const offers = siteOffers(rows, '2026-10-01', '2026-11-04');
    expect(offers).toEqual([
      expect.objectContaining({ ingredientId: 'tofu-firm', store: 'T&T Supermarket', estimate: { basis: 'site', date: '2026-11-04' } }),
    ]);
    expect(offers[0]!.pricePerUnit).toBeCloseTo(3.49 / 0.454, 6);
  });

  it('counts T&T as a store in the status, with the prices read there', async () => {
    const { raw, DB } = newTestDb();
    const doc = household([TNT], { itemRules: TOFU_PIN });
    addHousehold(raw, 'h1', doc);
    await runSitePrices({ DB }, 'h1', tntFetch({ [TOFU_TERM]: [tntItem('Firm Tofu 454g', 2.99)] }), 40, NOW);
    const status = await siteStatus(DB, 'h1', doc, NOW, false);
    expect(status.prices).toBe(1);
  });
});

describe('tntPackPrice and pickTntResult', () => {
  const base = (over: Partial<TntProduct>): TntProduct => ({ sku: 's', name: 'x', price: 1, regularPrice: 1, onSale: false, inStock: true, ...over });

  it('prices a pack by the size in its name, per base unit', () => {
    const hit = tntPackPrice(base({ name: 'Firm Tofu 454g', price: 2.99, regularPrice: 3.49, onSale: true }), 'kg');
    expect(hit).toEqual({ pricePerUnit: 2.99 / 0.454, packQty: 0.454, onSale: true, regularPerUnit: 3.49 / 0.454 });
  });

  it('prices a weight-priced item per kilogram, converting pounds', () => {
    expect(tntPackPrice(base({ name: 'Ground Beef', price: 4.99, regularPrice: 4.99, perWeight: 'lb' }), 'kg')).toEqual({
      pricePerUnit: 4.99 * LB,
      packQty: 1,
      onSale: false,
      regularPerUnit: null,
    });
    expect(tntPackPrice(base({ name: 'Bok Choy', price: 3, regularPrice: 3, perWeight: 'kg' }), 'kg')).toMatchObject({ pricePerUnit: 3 });
  });

  it('gives nothing when the unit does not fit the ingredient, or there is no size', () => {
    expect(tntPackPrice(base({ name: 'Ground Beef', perWeight: 'lb' }), 'each')).toBeNull();
    expect(tntPackPrice(base({ name: 'Firm Tofu' }), 'kg')).toBeNull();
  });

  it('skips an out-of-stock product and takes the next match', () => {
    const products = [
      base({ name: 'Firm Tofu 340g', price: 1, regularPrice: 1, inStock: false }),
      base({ name: 'Firm Tofu 454g', price: 2.99, regularPrice: 2.99 }),
    ];
    expect(pickTntResult(products, INGREDIENT_BY_ID['tofu-firm']!)).toMatchObject({ packQty: 0.454 });
  });
});
