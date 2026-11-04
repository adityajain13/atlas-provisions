// Flipp search against a fake fetch. No network.
import { describe, expect, it } from 'vitest';
import { FLIPP_SEARCH_URL, fetchFlippItems, toFlyerItem, type FlippRawItem } from './flipp';

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
