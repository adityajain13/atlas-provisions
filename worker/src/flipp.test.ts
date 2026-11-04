// Flipp search against a fake fetch. No network.
import { describe, expect, it } from 'vitest';
import {
  FLIPP_FLYERS_URL,
  FLIPP_SEARCH_URL,
  createBudget,
  createFlippClient,
  fetchFlyerItems,
  fetchFlyerList,
  fetchFlippItems,
  flyerItemPriceText,
  selectFlyers,
  toFlyerInfo,
  toFlyerItem,
  toFlyerItemFromFlyer,
  type FlippRawItem,
  type FlyerInfo,
} from './flipp';

const STORES = ['No Frills', 'FreshCo'];
const noSleep = async () => {};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const chicken: FlippRawItem = {
  id: 1,
  flyer_item_id: 101,
  merchant_name: 'NOFRILLS',
  name: 'PC Boneless Skinless Chicken Thighs',
  current_price: 4.39,
  post_price_text: '/kg',
  valid_from: '2026-11-12T05:00:00Z',
  valid_to: '2026-11-18T05:00:00Z',
};

describe('toFlyerItem', () => {
  it('maps a Flipp item to a FlyerItem with the canonical store and date parts', () => {
    expect(toFlyerItem(chicken, STORES)).toEqual({
      id: 'flipp:101',
      store: 'No Frills',
      rawName: 'PC Boneless Skinless Chicken Thighs',
      priceText: '$4.39/kg',
      validFrom: '2026-11-12',
      validTo: '2026-11-18',
      source: 'flipp',
    });
  });

  it('uses the item id when there is no flyer_item_id', () => {
    expect(toFlyerItem({ ...chicken, flyer_item_id: undefined, id: 'abc' }, STORES)?.id).toBe('flipp:abc');
  });

  it('skips items without a merchant, name, price, dates, or a household store', () => {
    expect(toFlyerItem({ ...chicken, merchant_name: undefined }, STORES)).toBeNull();
    expect(toFlyerItem({ ...chicken, name: '  ' }, STORES)).toBeNull();
    expect(toFlyerItem({ ...chicken, current_price: null, post_price_text: '' }, STORES)).toBeNull();
    expect(toFlyerItem({ ...chicken, valid_to: undefined }, STORES)).toBeNull();
    expect(toFlyerItem({ ...chicken, merchant_name: 'Walmart' }, STORES)).toBeNull();
  });
});

describe('toFlyerItem with Flipp names', () => {
  it('stores the household store name when the merchant is one of its Flipp names', () => {
    const stores = [{ name: 'Real Canadian Superstore', flippNames: ['RCSS'] }];
    expect(toFlyerItem({ ...chicken, merchant_name: 'RCSS' }, stores)?.store).toBe('Real Canadian Superstore');
  });
});

describe('fetchFlippItems', () => {
  it('sends the postal code, term and browser-like headers, and maps the items', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return json({ items: [chicken] });
    }) as unknown as typeof fetch;

    const result = await fetchFlippItems('M5V2T6', ['chicken thigh'], fetchImpl, { stores: STORES, sleep: noSleep, spacingMs: 0 });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${FLIPP_SEARCH_URL}?locale=en-ca&postal_code=M5V2T6&q=chicken%20thigh`);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.accept).toBe('application/json');
    expect(headers['user-agent']).toMatch(/Mozilla/);
    expect(result.errors).toEqual([]);
    expect(result.found).toBe(1);
    expect(result.items.map((i) => i.id)).toEqual(['flipp:101']);
  });

  it('dedupes items that several terms return', async () => {
    const fetchImpl = (async () => json({ items: [chicken, chicken] })) as unknown as typeof fetch;
    const result = await fetchFlippItems('M5V2T6', ['a', 'b'], fetchImpl, { stores: STORES, sleep: noSleep, spacingMs: 0 });
    expect(result.found).toBe(1);
    expect(result.items).toHaveLength(1);
  });

  it('never has more than 4 requests in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = (async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return json({ items: [] });
    }) as unknown as typeof fetch;
    const terms = Array.from({ length: 12 }, (_, i) => `term${i}`);
    const result = await fetchFlippItems('M5V2T6', terms, fetchImpl, { stores: STORES, sleep: noSleep, spacingMs: 0 });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(result.errors).toEqual([]);
  });

  it('spaces request starts by the spacing, using the sleep it is given', async () => {
    const sleeps: number[] = [];
    const fetchImpl = (async () => json({ items: [] })) as unknown as typeof fetch;
    await fetchFlippItems('M5V2T6', ['a', 'b', 'c'], fetchImpl, {
      stores: STORES,
      concurrency: 1,
      spacingMs: 250,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    // The first start is free. Waits are measured from now, so the second start waits about 250 ms
    // and the third about 500 ms.
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBeGreaterThan(200);
    expect(sleeps[0]).toBeLessThanOrEqual(250);
    expect(sleeps[1]).toBeGreaterThan(450);
    expect(sleeps[1]).toBeLessThanOrEqual(500);
  });

  it('retries once on 429 and then succeeds', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return calls === 1 ? new Response('slow down', { status: 429 }) : json({ items: [chicken] });
    }) as unknown as typeof fetch;
    const result = await fetchFlippItems('M5V2T6', ['chicken'], fetchImpl, { stores: STORES, sleep: noSleep, spacingMs: 0 });
    expect(calls).toBe(2);
    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(1);
  });

  it('retries a 5xx once, then records one error for the term', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response('down', { status: 503 });
    }) as unknown as typeof fetch;
    const result = await fetchFlippItems('M5V2T6', ['chicken'], fetchImpl, { stores: STORES, sleep: noSleep, spacingMs: 0 });
    expect(calls).toBe(2);
    expect(result.errors).toEqual(['chicken: HTTP 503']);
    expect(result.items).toEqual([]);
  });

  it('does not retry a 404 and collects the error without throwing', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;
    const result = await fetchFlippItems('M5V2T6', ['x'], fetchImpl, { stores: STORES, sleep: noSleep, spacingMs: 0 });
    expect(calls).toBe(1);
    expect(result.errors).toEqual(['x: HTTP 404']);
  });

  it('keeps going after a term throws, and reports the failure for that term only', async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes('q=bad')) throw new TypeError('network down');
      return json({ items: [chicken] });
    }) as unknown as typeof fetch;
    const result = await fetchFlippItems('M5V2T6', ['bad', 'good'], fetchImpl, { stores: STORES, sleep: noSleep, spacingMs: 0 });
    expect(result.errors).toEqual(['bad: network down']);
    expect(result.items).toHaveLength(1);
  });

  it('records a body that is not JSON, or has no items array', async () => {
    const bodies = [new Response('<html>', { status: 200 }), json({ ecom_items: [] })];
    let i = 0;
    const fetchImpl = (async () => bodies[i++]!) as unknown as typeof fetch;
    const result = await fetchFlippItems('M5V2T6', ['a', 'b'], fetchImpl, { stores: STORES, sleep: noSleep, spacingMs: 0, concurrency: 1 });
    expect(result.errors).toEqual(['a: response was not JSON', 'b: response had no items array']);
  });
});

const TODAY = '2026-11-03';
const flyer = (over: Partial<FlyerInfo>): FlyerInfo => ({
  id: '1',
  merchant: 'NOFRILLS',
  name: 'Weekly',
  validFrom: '2026-10-29',
  validTo: '2026-11-11',
  categories: ['groceries'],
  ...over,
});

describe('selectFlyers', () => {
  it('keeps flyers of household stores that are still valid, grocery flyers first, at most 3 per store', () => {
    const flyers = [
      flyer({ id: 'a', categories: ['health'] }),
      flyer({ id: 'b', categories: ['Groceries'] }),
      flyer({ id: 'c', categories: ['groceries'] }),
      flyer({ id: 'd', categories: ['groceries'] }),
      flyer({ id: 'e', merchant: 'Walmart', categories: ['groceries'] }),
      flyer({ id: 'f', validTo: '2026-10-30' }),
      flyer({ id: 'g', validTo: null }),
    ];
    const picked = selectFlyers(flyers, ['No Frills'], TODAY);
    expect(picked.map((p) => p.flyer.id)).toEqual(['b', 'c', 'd']);
    expect(new Set(picked.map((p) => p.store))).toEqual(new Set(['No Frills']));
  });

  it('matches merchants through the Flipp names of a store', () => {
    const picked = selectFlyers([flyer({ id: 'x', merchant: 'RCSS' })], [{ name: 'Real Canadian Superstore', flippNames: ['RCSS'] }], TODAY);
    expect(picked).toEqual([{ flyer: expect.objectContaining({ id: 'x' }), store: 'Real Canadian Superstore' }]);
  });
});

describe('toFlyerInfo', () => {
  it('reads a flyer with string categories, or a merchant object', () => {
    expect(toFlyerInfo({ id: 9, merchant: 'FreshCo', name: 'Deals', valid_from: '2026-10-29T05:00:00Z', valid_to: '2026-11-11T05:00:00Z', categories: 'Groceries' })).toEqual({
      id: '9',
      merchant: 'FreshCo',
      name: 'Deals',
      validFrom: '2026-10-29',
      validTo: '2026-11-11',
      categories: ['groceries'],
    });
    expect(toFlyerInfo({ id: 'z', merchant: { name: 'No Frills' } })?.merchant).toBe('No Frills');
    expect(toFlyerInfo({ merchant: 'No id' })).toBeNull();
  });
});

describe('flyerItemPriceText', () => {
  it('uses current_price with its units when it is a number', () => {
    expect(flyerItemPriceText({ current_price: 4.39, post_price_text: '/kg' })).toBe('$4.39/kg');
  });

  it('uses the printed price string, such as "2/$5" or "4.99" with a unit', () => {
    expect(flyerItemPriceText({ price: '2/$5' })).toBe('2/$5');
    expect(flyerItemPriceText({ price: '4.99', post_price_text: 'lb' })).toBe('$4.99/lb');
  });

  it('falls back to the sale text', () => {
    expect(flyerItemPriceText({ sale_story: '$3.49' })).toBe('$3.49');
  });

  it('returns null when there is no price', () => {
    expect(flyerItemPriceText({ name: 'Nothing' })).toBeNull();
  });
});

describe('toFlyerItemFromFlyer', () => {
  it('maps a flyer item to the flyer store, taking dates from the flyer when the item has none', () => {
    const item = toFlyerItemFromFlyer(
      { id: 77, name: 'PC Pork Combo Chops', price: '4.99', post_price_text: '/kg', description: '1.5 kg' },
      'No Frills',
      { validFrom: '2026-10-29', validTo: '2026-11-11' },
    );
    expect(item).toEqual({
      id: 'flipp:77',
      store: 'No Frills',
      rawName: 'PC Pork Combo Chops',
      priceText: '$4.99/kg',
      sizeText: '1.5 kg',
      validFrom: '2026-10-29',
      validTo: '2026-11-11',
      source: 'flipp',
    });
  });

  it('reads the brand with the name when the name does not already have it', () => {
    const flyerDates = { validFrom: '2026-10-29', validTo: '2026-11-11' };
    expect(toFlyerItemFromFlyer({ id: 5, name: 'Drumstick', brand: 'Nestle', price: '3.00' }, 'No Frills', flyerDates)?.rawName).toBe('Nestle Drumstick');
    expect(toFlyerItemFromFlyer({ id: 6, name: 'PC Spaghetti', brand: 'PC', price: '3.00' }, 'No Frills', flyerDates)?.rawName).toBe('PC Spaghetti');
  });

  it('skips an item with no name or no price', () => {
    const flyerDates = { validFrom: '2026-10-29', validTo: '2026-11-11' };
    expect(toFlyerItemFromFlyer({ id: 1, price: '2.00' }, 'No Frills', flyerDates)).toBeNull();
    expect(toFlyerItemFromFlyer({ id: 2, name: 'Thing' }, 'No Frills', flyerDates)).toBeNull();
  });
});

describe('fetchFlyerList', () => {
  it('requests the flyer list for the postal code and reads the flyers array', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      return json({ flyers: [flyer({ id: 'f1' })].map((f) => ({ id: f.id, merchant: f.merchant, valid_to: f.validTo })) });
    }) as unknown as typeof fetch;
    const client = createFlippClient(fetchImpl, { sleep: noSleep, spacingMs: 0 });
    const out = await fetchFlyerList('M5V2T6', client);
    expect(calls).toEqual([`${FLIPP_FLYERS_URL}?locale=en-ca&postal_code=M5V2T6`]);
    expect(out).toEqual({ ok: true, flyers: [expect.objectContaining({ id: 'f1', merchant: 'NOFRILLS' })] });
  });

  it('reports a failed list without throwing', async () => {
    const fetchImpl = (async () => new Response('down', { status: 500 })) as unknown as typeof fetch;
    const client = createFlippClient(fetchImpl, { sleep: noSleep, spacingMs: 0, retryDelayMs: 0 });
    expect(await fetchFlyerList('M5V2T6', client)).toEqual({ ok: false, message: 'flyer list HTTP 500' });
  });
});

describe('fetchFlyerItems', () => {
  it('tries flyer_items first, then the flyer itself, until one returns items', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(String(url));
      if (url.includes('/flyer_items')) return json({ flyer_items: [] });
      return json({ items: [chicken] });
    }) as unknown as typeof fetch;
    const client = createFlippClient(fetchImpl, { sleep: noSleep, spacingMs: 0 });
    const out = await fetchFlyerItems('42', client);
    expect(urls).toEqual([
      `${FLIPP_FLYERS_URL}/42/flyer_items?locale=en-ca`,
      `${FLIPP_FLYERS_URL}/42?locale=en-ca`,
    ]);
    expect(out.items).toHaveLength(1);
  });

  it('takes a root array of items', async () => {
    const fetchImpl = (async () => json([chicken])) as unknown as typeof fetch;
    const client = createFlippClient(fetchImpl, { sleep: noSleep, spacingMs: 0 });
    expect((await fetchFlyerItems('42', client)).items).toHaveLength(1);
  });
});

describe('request budget', () => {
  it('refuses requests past the limit and never sends them', async () => {
    const budget = createBudget(2);
    let sent = 0;
    const fetchImpl = (async () => {
      sent++;
      return json({ items: [] });
    }) as unknown as typeof fetch;
    const client = createFlippClient(fetchImpl, { sleep: noSleep, spacingMs: 0, budget });
    expect((await client.get('https://x.test/a')).ok).toBe(true);
    expect((await client.get('https://x.test/b')).ok).toBe(true);
    const third = await client.get('https://x.test/c');
    expect(third.ok).toBe(false);
    expect(sent).toBe(2);
    expect(budget.used).toBe(2);
    expect(budget.exhausted).toBe(true);
  });

  it('counts a retried request as a second request', async () => {
    const budget = createBudget(10);
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return calls === 1 ? new Response('slow', { status: 429 }) : json({ items: [] });
    }) as unknown as typeof fetch;
    await fetchFlippItems('M5V2T6', ['a'], fetchImpl, { stores: STORES, sleep: noSleep, spacingMs: 0, budget });
    expect(budget.used).toBe(2);
  });
});
