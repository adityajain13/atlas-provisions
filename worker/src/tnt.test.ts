// T&T's storefront search, with a fake fetch: the request it sends (no cookie), the province and store id from a postal
// code, the normalised products, and the typed errors (a block is never retried). No network.
import { describe, expect, it, vi } from 'vitest';
import {
  TNT_BLOCKED_MESSAGE,
  TNT_GRAPHQL_URL,
  TNT_QUERY,
  fsaOf,
  normaliseTntItem,
  searchTnt,
  tntHeaders,
  tntRegionOf,
  tntSearchUrl,
  tntStoreId,
} from './tnt';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ON = { region: 'ON' as const, postcode: 'M5T' };

/** A storefront reply with the given items. */
const reply = (items: unknown[]) => json({ data: { products: { items, total_count: items.length } } });

/** A fake fetch that answers each call with the next reply, and records the calls. */
function fakeFetch(...replies: Array<Response | (() => never)>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = replies.shift();
    if (!next) throw new Error(`unexpected request to ${String(url)}`);
    if (typeof next === 'function') next();
    return next as Response;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

/** An item the way the storefront sends it: the regular price, the final price, and the was price when there is one. */
function item(over: Record<string, unknown> & { name: string }) {
  return {
    id: 1,
    sku: 'SKU1',
    stock_status: 'IN_STOCK',
    price: { regularPrice: { amount: { currency: 'CAD', value: 3.49 } } },
    price_range: { minimum_price: { final_price: { currency: 'CAD', value: 3.49 } } },
    was_price: null,
    uom_type: null,
    weight_uom: null,
    ...over,
  };
}

describe('tntRegionOf and tntStoreId', () => {
  it('prices a delivery in the province of the postal code, Ontario by default', () => {
    expect(tntRegionOf('M5T 1R5')).toBe('ON');
    expect(tntRegionOf('K1A0B1')).toBe('ON');
    expect(tntRegionOf('l5l3t4')).toBe('ON');
    expect(tntRegionOf('V6B 1A1')).toBe('BC');
    expect(tntRegionOf('T2P 1J9')).toBe('AB');
    expect(tntRegionOf('G1R 4P5')).toBe('QC');
    expect(tntRegionOf('H2X 1Y4')).toBe('QC');
    expect(tntRegionOf('J4B 1A1')).toBe('QC');
    expect(tntRegionOf(undefined)).toBe('ON');
    expect(tntRegionOf('')).toBe('ON');
  });

  it('keys the rows by the province', () => {
    expect(tntStoreId('M5T 1R5')).toBe('tnt-ON');
    expect(tntStoreId('V6B 1A1')).toBe('tnt-BC');
    expect(tntStoreId(undefined)).toBe('tnt-ON');
  });

  it('takes the forward sortation area, and nothing when the code is not one', () => {
    expect(fsaOf('L5L 3T4')).toBe('L5L');
    expect(fsaOf('l5l3t4')).toBe('L5L');
    expect(fsaOf('')).toBeUndefined();
    expect(fsaOf('12345')).toBeUndefined();
    expect(fsaOf(undefined)).toBeUndefined();
  });
});

describe('tntSearchUrl and tntHeaders', () => {
  it('sends the search as a GraphQL query with the term as input text, URL-encoded', () => {
    const url = new URL(tntSearchUrl('tofu'));
    expect(`${url.origin}${url.pathname}`).toBe(TNT_GRAPHQL_URL);
    expect(url.searchParams.get('operationName')).toBe('ProductSearch');
    expect(url.searchParams.get('query')).toBe(TNT_QUERY);
    expect(JSON.parse(url.searchParams.get('variables') ?? '')).toEqual({
      currentPage: 1,
      pageSize: 35,
      filters: {},
      inputText: 'tofu',
      sort: { relevance: 'DESC' },
    });
  });

  it('sends the storefront headers for the province and the postal prefix, and no cookie', () => {
    const headers = tntHeaders('extra firm tofu', ON);
    expect(headers).toMatchObject({
      store: 'default',
      'x-current-region': 'ON',
      'x-postcode': 'M5T',
      'x-current-shipping-method': 'delivery',
      'content-currency': 'CAD',
      'Accept-Language': 'en-CA',
      Referer: 'https://www.tntsupermarket.com/eng/search.html?query=extra%20firm%20tofu',
    });
    expect(headers['User-Agent']).toMatch(/^Mozilla\/5\.0/);
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('cookie');
  });

  it('leaves out the postal prefix when the household has none', () => {
    expect(tntHeaders('tofu', { region: 'ON' })).not.toHaveProperty('x-postcode');
  });
});

describe('normaliseTntItem', () => {
  it('reads the final price and the regular price, and a sale when the final is below the regular', () => {
    const got = normaliseTntItem(
      item({
        name: 'Firm Tofu 454g',
        sku: 'TOFU1',
        price: { regularPrice: { amount: { value: 3.49 } } },
        price_range: { minimum_price: { final_price: { value: 2.99 } } },
      }),
    );
    expect(got).toEqual({ sku: 'TOFU1', name: 'Firm Tofu 454g', price: 2.99, regularPrice: 3.49, onSale: true, inStock: true });
  });

  it('takes the was price as the regular price when it is higher', () => {
    const got = normaliseTntItem(
      item({
        name: 'Tofu 340g',
        price_range: { minimum_price: { final_price: { value: 3.99 } } },
        was_price: 4.99,
      }),
    );
    expect(got).toMatchObject({ price: 3.99, regularPrice: 4.99, wasPrice: 4.99, onSale: true });
  });

  it('is not on sale when the final and the regular prices are the same', () => {
    expect(normaliseTntItem(item({ name: 'Tofu 340g' }))).toMatchObject({ price: 3.49, regularPrice: 3.49, onSale: false });
  });

  it('reads a product priced by the pound or the kilogram as weight-priced', () => {
    expect(normaliseTntItem(item({ name: 'Ground Beef', uom_type: 'WEIGHT', weight_uom: 'LB' }))).toMatchObject({ perWeight: 'lb' });
    expect(normaliseTntItem(item({ name: 'Bok Choy', uom_type: 'weight', weight_uom: 'KG' }))).toMatchObject({ perWeight: 'kg' });
    expect(normaliseTntItem(item({ name: 'Tofu 340g', uom_type: 'EACH' }))).not.toHaveProperty('perWeight');
  });

  it('marks an out-of-stock product', () => {
    expect(normaliseTntItem(item({ name: 'Tofu 340g', stock_status: 'OUT_OF_STOCK' }))).toMatchObject({ inStock: false });
  });

  it('drops a product with no name or no price', () => {
    expect(normaliseTntItem(item({ name: '' }))).toBeNull();
    expect(normaliseTntItem({ name: 'Tofu', price: null, price_range: null })).toBeNull();
    expect(normaliseTntItem(item({ name: 'Free Tofu', price_range: { minimum_price: { final_price: { value: 0 } } } }))).toBeNull();
    expect(normaliseTntItem('tofu')).toBeNull();
  });
});

describe('searchTnt', () => {
  it('sends one GET with the storefront headers and no cookie, and returns the products in the storefront order', async () => {
    const { fn, calls } = fakeFetch(
      reply([item({ name: 'Firm Tofu 454g', sku: 'A' }), item({ name: 'Silken Tofu 349g', sku: 'B', stock_status: 'OUT_OF_STOCK' })]),
    );
    const got = await searchTnt('firm tofu', ON, fn);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.value.map((p) => p.sku)).toEqual(['A', 'B']);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(tntSearchUrl('firm tofu'));
    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.init.headers).toMatchObject({ 'x-postcode': 'M5T', 'x-current-region': 'ON' });
    expect(Object.keys(calls[0]!.init.headers ?? {}).map((k) => k.toLowerCase())).not.toContain('cookie');
  });

  it('treats a 403 as a block, with the start of the page for the sample, and does not retry', async () => {
    const { fn, calls } = fakeFetch(new Response('<html>Access Denied</html>', { status: 403 }));
    const got = await searchTnt('tofu', ON, fn);
    expect(got).toEqual({ ok: false, error: { kind: 'blocked', message: TNT_BLOCKED_MESSAGE, status: 403, sample: '<html>Access Denied</html>' } });
    expect(calls).toHaveLength(1);
  });

  it('treats a 429 as a block', async () => {
    const { fn } = fakeFetch(new Response('slow down', { status: 429 }));
    expect(await searchTnt('tofu', ON, fn)).toMatchObject({ ok: false, error: { kind: 'blocked', status: 429 } });
  });

  it('treats a page that is not JSON, such as a challenge page, as a block', async () => {
    const { fn } = fakeFetch(new Response('<!doctype html><title>Just a moment</title>', { status: 200 }));
    const got = await searchTnt('tofu', ON, fn);
    expect(got).toMatchObject({ ok: false, error: { kind: 'blocked', message: TNT_BLOCKED_MESSAGE } });
    if (!got.ok) expect(got.error.sample).toMatch(/^<!doctype html>/);
  });

  it('reports a GraphQL error and a body with no product list as a shape error', async () => {
    const { fn: errs } = fakeFetch(json({ errors: [{ message: 'bad query' }], data: null }));
    expect(await searchTnt('tofu', ON, errs)).toMatchObject({ ok: false, error: { kind: 'shape' } });
    const { fn: none } = fakeFetch(json({ data: { products: null } }));
    expect(await searchTnt('tofu', ON, none)).toMatchObject({ ok: false, error: { kind: 'shape', message: 'No product list in the response' } });
  });

  it('reports items that have no name and price as a shape error', async () => {
    const { fn } = fakeFetch(reply([{ id: 2, name: 'Nameless' }]));
    expect(await searchTnt('tofu', ON, fn)).toMatchObject({ ok: false, error: { kind: 'shape' } });
  });

  it('reports other HTTP errors as network errors with the status, and a thrown fetch as a network error', async () => {
    const { fn: five } = fakeFetch(new Response('oops', { status: 500 }));
    expect(await searchTnt('tofu', ON, five)).toEqual({ ok: false, error: { kind: 'network', message: 'HTTP 500', status: 500 } });
    const { fn: thrown } = fakeFetch(() => {
      throw new Error('socket closed');
    });
    expect(await searchTnt('tofu', ON, thrown)).toEqual({ ok: false, error: { kind: 'network', message: 'socket closed' } });
  });

  it('returns an empty list for a search with no products', async () => {
    const { fn } = fakeFetch(reply([]));
    expect(await searchTnt('zzz', ON, fn)).toEqual({ ok: true, value: [] });
  });
});
