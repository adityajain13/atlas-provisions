// The Loblaw-family site client, against a fake fetch: the headers, the location list and its fallback, the error
// kinds, and the price shapes a search result can come back in. No network.
import { describe, expect, it, vi } from 'vitest';
import { beforeEach } from 'vitest';
import { listLocations, normaliseLocation, normaliseProduct, PCX_API_KEY, PCX_BANNER_IDS, resetAnsweringIds, searchIdsFor, searchLocations, searchProducts, siteHeaders } from './pcexpress';
import { comparisonPerBase, matchLocations, parseSiteSize, pickSiteResult, sitePackPrice } from './sitePrices';
import { INGREDIENT_BY_ID } from '@provisions/shared';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fetch that answers each request with the next response in `replies`, and records the calls. */
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

describe('siteHeaders', () => {
  it('sends the public web key and the banner, with no Authorization header', () => {
    const h = siteHeaders('nofrills');
    expect(h['x-apikey']).toBe(PCX_API_KEY);
    expect(h['Business-User-Agent']).toBe('PCXWEB');
    expect(h['Site-Banner']).toBe('nofrills');
    expect(h.baseSiteId).toBe('nofrills');
    expect(h['x-application-type']).toBe('Web');
    expect(h['x-loblaw-tenant-id']).toBe('ONLINE_GROCERIES');
    expect(h['Content-Type']).toBe('application/json');
    expect(h.Accept).toBe('application/json');
    expect(h['Accept-Language']).toBe('en');
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('authorization');
  });
});

describe('listLocations', () => {
  it('reads the locations of a banner and sends the headers', async () => {
    const { fn, calls } = fakeFetch(
      json({
        pickupLocations: [
          { storeId: '1234', name: 'No Frills Dixie', address: { line1: '1000 Dixie Rd', town: 'Mississauga', postalCode: 'L4Y 2A2' } },
          { storeId: 1235, name: 'No Frills Erin Mills', address: { line1: '2400 Erin Mills Pkwy', town: 'Mississauga', postalCode: 'l5l3t4' } },
        ],
      }),
    );
    const got = await listLocations('nofrills', fn);
    expect(got).toEqual({
      ok: true,
      value: [
        { storeId: '1234', name: 'No Frills Dixie', line1: '1000 Dixie Rd', city: 'Mississauga', postalCode: 'L4Y2A2' },
        { storeId: '1235', name: 'No Frills Erin Mills', line1: '2400 Erin Mills Pkwy', city: 'Mississauga', postalCode: 'L5L3T4' },
      ],
    });
    expect(calls[0]!.url).toBe('https://api.pcexpress.ca/pcx-bff/api/v1/pickup-locations?bannerIds=nofrills');
    expect((calls[0]!.init.headers as Record<string, string>)['x-apikey']).toBe(PCX_API_KEY);
  });

  it('tries bannerId when bannerIds is not found', async () => {
    const { fn, calls } = fakeFetch(new Response('nope', { status: 404 }), json([{ storeId: '9', name: 'Zehrs Hwy 8' }]));
    const got = await listLocations('zehrs', fn);
    expect(got.ok && got.value.map((l) => l.storeId)).toEqual(['9']);
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.pcexpress.ca/pcx-bff/api/v1/pickup-locations?bannerIds=zehrs',
      'https://api.pcexpress.ca/pcx-bff/api/v1/pickup-locations?bannerId=zehrs',
    ]);
  });

  it('reports a 401 or 403 as an auth error, which means a PC id sign-in is needed', async () => {
    for (const status of [401, 403]) {
      const { fn } = fakeFetch(new Response('denied', { status }));
      const got = await listLocations('loblaws', fn);
      expect(got).toMatchObject({ ok: false, error: { kind: 'auth', status } });
    }
  });

  it('reports a 429 as blocked, and an HTML page as blocked', async () => {
    const limited = await listLocations('loblaws', fakeFetch(new Response('slow', { status: 429 })).fn);
    expect(limited).toMatchObject({ ok: false, error: { kind: 'blocked', status: 429 } });
    const page = await listLocations('loblaws', fakeFetch(new Response('<html>check</html>', { status: 200 })).fn);
    expect(page).toMatchObject({ ok: false, error: { kind: 'blocked' } });
  });

  it('reports a 5xx as a network error and a rejected request as a network error', async () => {
    const server = await listLocations('loblaws', fakeFetch(new Response('x', { status: 503 })).fn);
    expect(server).toMatchObject({ ok: false, error: { kind: 'network', status: 503 } });
    const thrown = await listLocations(
      'loblaws',
      fakeFetch(() => {
        throw new Error('socket closed');
      }).fn,
    );
    expect(thrown).toMatchObject({ ok: false, error: { kind: 'network' } });
  });

  it('reports a body with no list of locations as a shape error, with a sample', async () => {
    const got = await listLocations('loblaws', fakeFetch(json({ message: 'hello' })).fn);
    expect(got).toMatchObject({ ok: false, error: { kind: 'shape' } });
    if (!got.ok) expect(got.error.sample).toContain('hello');
  });

  it('returns an empty list for a banner with no locations', async () => {
    expect(await listLocations('tandt', fakeFetch(json({ pickupLocations: [] })).fn)).toEqual({ ok: true, value: [] });
  });
});

describe('normaliseLocation', () => {
  it('needs a store id, and takes the id as a number too', () => {
    expect(normaliseLocation({ name: 'No name' })).toBeNull();
    expect(normaliseLocation({ storeId: 77 })?.storeId).toBe('77');
  });
});

const LOCATIONS = [
  { storeId: '1', name: 'No Frills Dixie', line1: '1000 Dixie Rd', city: 'Mississauga', postalCode: 'L4Y2A2' },
  { storeId: '2', name: 'No Frills Erin Mills', line1: '2400 Erin Mills Pkwy', city: 'Mississauga', postalCode: 'L5L3T4' },
  { storeId: '3', name: 'No Frills Yonge', line1: '55 Yonge St', city: 'Toronto', postalCode: 'M5E1J3' },
];

describe('matchLocations', () => {
  it('returns nothing for an empty query', () => {
    expect(matchLocations(LOCATIONS, 'nofrills', '   ')).toEqual([]);
  });

  it('matches every word of the query against the name, street, city or postal code', () => {
    expect(matchLocations(LOCATIONS, 'nofrills', 'mississauga').map((l) => l.storeId)).toEqual(['1', '2']);
    expect(matchLocations(LOCATIONS, 'nofrills', 'erin mills').map((l) => l.storeId)).toEqual(['2']);
    expect(matchLocations(LOCATIONS, 'nofrills', 'yonge toronto').map((l) => l.storeId)).toEqual(['3']);
  });

  it('ignores spaces in a postal code typed with them', () => {
    expect(matchLocations(LOCATIONS, 'nofrills', 'L5L 3T4').map((l) => l.storeId)).toEqual(['2']);
  });

  it('labels each result with the chain and the street and city', () => {
    expect(matchLocations(LOCATIONS, 'nofrills', 'dixie')[0]).toEqual({
      storeId: '1',
      label: 'No Frills · 1000 Dixie Rd, Mississauga',
      postalCode: 'L4Y2A2',
    });
  });

  it('caps the results at 25', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ storeId: String(i), name: `Store ${i}` }));
    expect(matchLocations(many, 'nofrills', 'store')).toHaveLength(25);
  });
});

describe('searchProducts and price shapes', () => {
  const search = async (product: unknown) => {
    const { fn, calls } = fakeFetch(json({ results: [product] }));
    const got = await searchProducts('nofrills', '1234', 'eggs', fn);
    return { got, call: calls[0]! };
  };

  it('posts the term, store and banner, and sends the headers', async () => {
    const { got, call } = await search({ name: 'Large Eggs', prices: { price: { value: 4.99 } } });
    expect(got.ok).toBe(true);
    expect(call.url).toBe('https://api.pcexpress.ca/pcx-bff/api/v1/products/search');
    expect(call.init.method).toBe('POST');
    expect(JSON.parse(String(call.init.body))).toEqual({
      lang: 'en',
      term: 'eggs',
      storeId: '1234',
      banner: 'nofrills',
      pagination: { from: 0, size: 24 },
    });
    expect((call.init.headers as Record<string, string>)['Site-Banner']).toBe('nofrills');
  });

  it('reads the shelf price under prices.price.value, with the package size', async () => {
    const { got } = await search({ code: '20', name: 'Large Eggs', brand: 'No Name', packageSize: '12 un', prices: { price: { value: 4.99 } } });
    expect(got).toEqual({
      ok: true,
      value: [{ code: '20', name: 'Large Eggs', brand: 'No Name', packageSize: '12 un', price: 4.99, onSale: false }],
    });
  });

  it('reads a plain number under prices.price, and a top-level price', async () => {
    expect((await search({ name: 'Milk', prices: { price: 3.49 } })).got).toMatchObject({ ok: true, value: [{ price: 3.49 }] });
    expect((await search({ name: 'Milk', price: 3.29 })).got).toMatchObject({ ok: true, value: [{ price: 3.29 }] });
  });

  it('falls back to the deal price when no shelf price is shown', () => {
    expect(normaliseProduct({ name: 'Milk', dealPrice: { value: 2.5 } })).toMatchObject({ price: 2.5, onSale: false });
  });

  it('is on sale when the was price is higher than the price, and records the was price', () => {
    expect(normaliseProduct({ name: 'Milk', prices: { price: { value: 2.99 }, wasPrice: { value: 3.99 } } })).toMatchObject({
      price: 2.99,
      wasPrice: 3.99,
      onSale: true,
    });
  });

  it('is on sale when the offer type says so', () => {
    expect(normaliseProduct({ name: 'Milk', prices: { price: { value: 2.99 } }, offerType: 'SALE' })).toMatchObject({ onSale: true });
    expect(normaliseProduct({ name: 'Milk', prices: { price: { value: 2.99 } }, offerType: 'NONE' })).toMatchObject({ onSale: false });
  });

  it('keeps the first comparison price as the unit price', () => {
    expect(
      normaliseProduct({ name: 'Chicken', prices: { price: { value: 9.8 } }, comparisonPrices: [{ value: 6.53, unit: 'kg', quantity: 1 }] }),
    ).toMatchObject({ unitPrice: { value: 6.53, unit: 'kg' } });
  });

  it('leaves out a result with no name or no price', () => {
    expect(normaliseProduct({ prices: { price: { value: 1 } } })).toBeNull();
    expect(normaliseProduct({ name: 'Free thing', prices: {} })).toBeNull();
  });

  it('returns an empty list for a search with no results', async () => {
    expect(await searchProducts('nofrills', '1', 'zzz', fakeFetch(json({ results: [] })).fn)).toEqual({ ok: true, value: [] });
  });

  it('reports results that have no usable name and price as a shape error', async () => {
    const got = await searchProducts('nofrills', '1', 'eggs', fakeFetch(json({ results: [{ foo: 1 }] })).fn);
    expect(got).toMatchObject({ ok: false, error: { kind: 'shape' } });
  });

  it('reports a body with no product list as a shape error', async () => {
    const got = await searchProducts('nofrills', '1', 'eggs', fakeFetch(json({ error: 'nope' })).fn);
    expect(got).toMatchObject({ ok: false, error: { kind: 'shape' } });
  });

  it('reports a 401 as an auth error', async () => {
    const got = await searchProducts('nofrills', '1', 'eggs', fakeFetch(new Response('', { status: 401 })).fn);
    expect(got).toMatchObject({ ok: false, error: { kind: 'auth', status: 401 } });
  });
});

describe('package size to unit price', () => {
  const kg = INGREDIENT_BY_ID['ground-beef']!;
  const each = INGREDIENT_BY_ID['eggs-large']!;
  const litre = INGREDIENT_BY_ID['milk-2-percent']!;

  it('reads a size the shared parser knows, and the "un" count the site uses for units', () => {
    expect(parseSiteSize('1.5 kg')).toEqual({ qty: 1.5, unit: 'kg' });
    expect(parseSiteSize('12 un')).toEqual({ qty: 12, unit: 'each' });
    expect(parseSiteSize('a bag')).toBeNull();
    expect(parseSiteSize(undefined)).toBeNull();
  });

  it('divides the price by the pack quantity in the base unit', () => {
    expect(sitePackPrice({ price: 12, packageSize: '1.5 kg' }, kg.baseUnit)).toEqual({ pricePerUnit: 8, packQty: 1.5 });
    expect(sitePackPrice({ price: 4.99, packageSize: '12 un' }, each.baseUnit)).toMatchObject({ packQty: 12 });
    expect(sitePackPrice({ price: 3.5, packageSize: '2 x 1 l' }, litre.baseUnit)).toMatchObject({ packQty: 2 });
  });

  it('uses the site unit price when there is no usable size, converted to the base unit', () => {
    expect(sitePackPrice({ price: 5, unitPrice: { value: 6.53, unit: 'kg' } }, kg.baseUnit)).toMatchObject({ pricePerUnit: 6.53 });
    expect(sitePackPrice({ price: 5, unitPrice: { value: 0.65, unit: '100 g' } }, kg.baseUnit)?.pricePerUnit).toBeCloseTo(6.5);
    expect(sitePackPrice({ price: 5, unitPrice: { value: 0.99, unit: 'L' } }, kg.baseUnit)).toBeNull();
  });

  it('converts comparison units by base unit', () => {
    expect(comparisonPerBase({ value: 2, unit: 'lb' }, 'kg')).toBeCloseTo(4.41, 1);
    expect(comparisonPerBase({ value: 0.25, unit: 'ml' }, 'l')).toBe(250);
    expect(comparisonPerBase({ value: 0.5, unit: 'each' }, 'each')).toBe(0.5);
  });

  it('picks the first result that is the ingredient and has a price in its unit', () => {
    const picked = pickSiteResult(
      [
        { code: '1', name: 'Ground beef pie', price: 4, onSale: false },
        { code: '2', name: 'Lean ground beef 500 g', packageSize: '500 g', price: 6, onSale: false },
        { code: '3', name: 'Ground beef 1 kg', packageSize: '1 kg', price: 8, onSale: false },
      ],
      kg,
    );
    expect(picked?.product.code).toBe('2');
    expect(picked?.pricePerUnit).toBeCloseTo(12);
  });
});

describe('banner ids', () => {
  beforeEach(() => resetAnsweringIds());

  it('sends Loblaws as loblaw, and the other banners under their own ids', () => {
    expect(PCX_BANNER_IDS.loblaws).toBe('loblaw');
    expect(searchIdsFor('loblaws')).toEqual(['loblaw', 'loblaws']);
    expect(searchIdsFor('tandt')).toEqual(['tandt']);
    expect(searchIdsFor('independent')).toEqual(['independent']);
  });

  it('lists the locations of Loblaws under loblaw', async () => {
    const { fn, calls } = fakeFetch(json({ pickupLocations: [{ storeId: '5', name: 'Loblaws Yonge' }] }));
    await listLocations('loblaws', fn);
    expect(calls[0]!.url).toBe('https://api.pcexpress.ca/pcx-bff/api/v1/pickup-locations?bannerIds=loblaw');
    expect((calls[0]!.init.headers as Record<string, string>)['Site-Banner']).toBe('loblaw');
  });

  it('retries a product search as loblaws after a 400, and keeps the id that answered', async () => {
    const product = { name: 'Large Eggs', prices: { price: { value: 4.99 } } };
    const { fn, calls } = fakeFetch(new Response('bad banner', { status: 400 }), json({ results: [product] }), json({ results: [product] }));
    const first = await searchProducts('loblaws', '1234', 'eggs', fn);
    expect(first.ok).toBe(true);
    expect(calls.map((c) => JSON.parse(String(c.init.body)).banner)).toEqual(['loblaw', 'loblaws']);
    await searchProducts('loblaws', '1234', 'eggs', fn);
    expect(JSON.parse(String(calls[2]!.init.body)).banner).toBe('loblaws');
    expect(calls).toHaveLength(3);
  });

  it('does not retry a product search on other errors', async () => {
    const { fn, calls } = fakeFetch(new Response('denied', { status: 401 }));
    expect(await searchProducts('loblaws', '1234', 'eggs', fn)).toMatchObject({ ok: false, error: { kind: 'auth' } });
    expect(calls).toHaveLength(1);
  });
});

describe('location listing fallbacks', () => {
  beforeEach(() => resetAnsweringIds());
  const LOC = { storeId: '77', name: 'T&T Mississauga' };

  it('goes on to bannerIds with isShoppable when the first two give nothing', async () => {
    const { fn, calls } = fakeFetch(new Response('bad', { status: 400 }), json({ pickupLocations: [] }), json({ locations: [LOC] }));
    const got = await listLocations('tandt', fn);
    expect(got).toEqual({ ok: true, value: [{ storeId: '77', name: 'T&T Mississauga' }] });
    expect(calls[2]!.url).toBe('https://api.pcexpress.ca/pcx-bff/api/v1/pickup-locations?bannerIds=tandt&isShoppable=true');
  });

  it('reads a root array, .pickupLocations, .locations and .results', async () => {
    for (const body of [[LOC], { pickupLocations: [LOC] }, { locations: [LOC] }, { results: [LOC] }]) {
      const got = await listLocations('tandt', fakeFetch(json(body)).fn);
      expect(got).toMatchObject({ ok: true, value: [{ storeId: '77' }] });
    }
  });

  it('returns the first failure when every request fails', async () => {
    const { fn, calls } = fakeFetch(
      new Response('bad', { status: 400 }),
      new Response('bad', { status: 400 }),
      new Response('bad', { status: 400 }),
    );
    expect(await listLocations('tandt', fn)).toMatchObject({ ok: false, error: { kind: 'network', status: 400 } });
    expect(calls).toHaveLength(3);
  });

  it('stops at once when the site asks for a sign-in', async () => {
    const { fn, calls } = fakeFetch(new Response('no', { status: 403 }));
    expect(await listLocations('loblaws', fn)).toMatchObject({ ok: false, error: { kind: 'auth' } });
    expect(calls).toHaveLength(1);
  });
});

describe('searchLocations', () => {
  const LOCS = [
    { storeId: '1', name: 'T&T Mississauga', line1: '3600 Hurontario St', city: 'Mississauga', postalCode: 'L5A3V7' },
    { storeId: '2', name: 'T&T Scarborough', line1: '3850 Finch Ave E', city: 'Scarborough', postalCode: 'M1S5H5' },
    { storeId: '3', name: 'T&T Markham', line1: '7161 Woodbine Ave', city: 'Markham', postalCode: 'L3R0Y3' },
  ];

  it('matches a postal code with or without the space, in any case', () => {
    expect(searchLocations(LOCS, 'tandt', 'M1S 5H5').map((r) => r.storeId)).toEqual(['2']);
    expect(searchLocations(LOCS, 'tandt', 'm1s5h5').map((r) => r.storeId)).toEqual(['2']);
    expect(searchLocations(LOCS, 'tandt', 'M1S5H').map((r) => r.storeId)).toEqual(['2']);
  });

  it('matches every word against the name, street, city or postal code', () => {
    expect(searchLocations(LOCS, 'tandt', 'finch scarborough').map((r) => r.storeId)).toEqual(['2']);
    expect(searchLocations(LOCS, 'tandt', 'hurontario').map((r) => r.storeId)).toEqual(['1']);
    expect(searchLocations(LOCS, 'tandt', 'toronto')).toEqual([]);
    expect(searchLocations(LOCS, 'tandt', '   ')).toEqual([]);
  });

  it('puts the postal code matches first when the query looks like a postal code', () => {
    const more = [{ storeId: '9', name: 'T&T M1S Pilot', postalCode: 'L3R0Y3' }, ...LOCS];
    expect(searchLocations(more, 'tandt', 'M1S').map((r) => r.storeId)).toEqual(['2', '9']);
  });

  it('labels each result with the chain, street and city', () => {
    expect(searchLocations(LOCS, 'tandt', 'markham')[0]).toEqual({
      storeId: '3',
      label: 'T&T Supermarket · 7161 Woodbine Ave, Markham',
      postalCode: 'L3R0Y3',
    });
  });
});
