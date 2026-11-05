// Flyer import against a real in-memory database and a URL-routed fake Flipp. No network.
import { describe, expect, it, vi } from 'vitest';
import { defaultHousehold, fallbackSearchTerms, type Household } from '@provisions/shared';
import worker from './index';
import { enabledStores, runIngest } from './ingest';
import { BUDGET_STOP_MESSAGE, FLIPP_FLYERS_URL, FLIPP_SEARCH_URL, SUBREQUEST_BUDGET } from './flipp';
import { API, OWNER, call, count, householdWith, rows, setup, withCookie } from './testing/app';

const noSleep = async () => {};
const POSTAL = 'M5V2T6';

function household(over: Partial<Household> = {}): Household {
  const h = defaultHousehold();
  return {
    ...h,
    postalCode: POSTAL,
    stores: h.stores.map((s) => ({ ...s, enabled: s.name === 'No Frills' })),
    ...over,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Far-future validity, so the tests do not depend on today's date.
const chicken = {
  id: 1,
  flyer_item_id: 101,
  merchant_name: 'No Frills',
  name: 'PC Boneless Skinless Chicken Thighs',
  current_price: 4.39,
  post_price_text: '/kg',
  valid_from: '2026-11-12',
  valid_to: '2099-11-18',
};
const tide = { ...chicken, flyer_item_id: 102, name: 'Tide Pods 81 ct', current_price: 12.99, post_price_text: '' };
const combo = { id: 3, flyer_item_id: 103, name: 'BROCCOLI CROWNS or BUNCH SPINACH', price: '2.99', post_price_text: '/kg', valid_from: '2026-11-12', valid_to: '2099-11-18' };

const flyerRow = (id: number, merchant: string, over: Record<string, unknown> = {}) => ({
  id,
  merchant,
  name: `${merchant} weekly`,
  valid_from: '2026-10-29',
  valid_to: '2099-11-11',
  categories: ['Groceries'],
  ...over,
});

/** A fake Flipp: answers the flyer list, each flyer's items and the search endpoint from the given tables. */
function fakeFlipp(opts: {
  flyers?: unknown[] | 'fail' | 'throw';
  items?: Record<string, unknown[] | 'fail' | 'throw'>;
  search?: unknown[] | 'fail' | 'throw';
}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith(`${FLIPP_FLYERS_URL}?`)) {
      if (opts.flyers === 'throw') throw new TypeError('Too many subrequests by single Worker invocation');
      if (opts.flyers === 'fail') return new Response('down', { status: 500 });
      return json({ flyers: opts.flyers ?? [] });
    }
    const flyerMatch = /\/flyers\/(\d+)(\/flyer_items)?\?/.exec(url);
    if (flyerMatch) {
      const table = opts.items?.[flyerMatch[1]!];
      if (table === 'throw') throw new TypeError('Too many subrequests by single Worker invocation');
      if (table === 'fail' || table === undefined) return new Response('nope', { status: 404 });
      return json({ items: table });
    }
    if (url.startsWith(FLIPP_SEARCH_URL)) {
      if (opts.search === 'throw') throw new TypeError('Too many subrequests by single Worker invocation');
      if (opts.search === 'fail') return new Response('nope', { status: 404 });
      return json({ items: opts.search ?? [] });
    }
    return new Response('unexpected', { status: 500 });
  });
}

const run = (db: D1Database, fetchMock: unknown, h: Household = household(), opts: Record<string, unknown> = {}) =>
  runIngest(
    { DB: db },
    POSTAL,
    enabledStores(h),
    fetchMock as unknown as typeof fetch,
    { sleep: noSleep, spacingMs: 0, retryDelayMs: 0, ...opts },
  );

const flyerIds = (raw: Parameters<typeof count>[0], postal = POSTAL) =>
  rows<{ id: string }>(raw, 'SELECT id FROM flyer_items WHERE postal_code = ? ORDER BY id', postal).map((r) => r.id);

describe('runIngest', () => {
  it('reads the flyers of the stores, stores and matches their items, and writes one run row for the postal code', async () => {
    const { DB, raw } = await setup([]);
    const fetchMock = fakeFlipp({
      flyers: [flyerRow(7, 'NOFRILLS'), flyerRow(8, 'Walmart')],
      items: { '7': [chicken, tide, combo] },
    });
    const result = await run(DB, fetchMock);

    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      `${FLIPP_FLYERS_URL}?locale=en-ca&postal_code=M5V2T6`,
      `${FLIPP_FLYERS_URL}/7/flyer_items?locale=en-ca`,
    ]);
    expect(result).toMatchObject({
      ok: true,
      mode: 'flyers',
      terms: 0,
      flyerCount: 1,
      items: 3,
      kept: 3,
      stored: 4, // the broccoli and spinach line is split in two
      matched: 3,
      storeCounts: [{ store: 'No Frills', count: 3 }],
      unmatchedSample: ['Tide Pods 81 ct'],
      errors: [],
    });

    expect(flyerIds(raw)).toEqual(['flipp:101', 'flipp:102', 'flipp:103#1', 'flipp:103#2']);
    expect(rows(raw, "SELECT store, raw_name, price_text, size_text, valid_from, valid_to, source FROM flyer_items WHERE id = 'flipp:101'")).toEqual([
      {
        store: 'No Frills',
        raw_name: 'PC Boneless Skinless Chicken Thighs',
        price_text: '$4.39/kg',
        size_text: null,
        valid_from: '2026-11-12',
        valid_to: '2099-11-18',
        source: 'flipp',
      },
    ]);
    expect(count(raw, 'price_history')).toBe(3);

    const runs = rows<Record<string, unknown>>(raw, 'SELECT * FROM ingest_runs');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ postal_code: POSTAL, ok: 1, mode: 'flyers', terms: 0, items: 3, kept: 3, stored: 4, matched: 3 });
    expect(JSON.parse(runs[0]!.flyers as string)).toEqual([
      { id: '7', merchant: 'NOFRILLS', name: 'NOFRILLS weekly', store: 'No Frills', items: 3 },
    ]);
    expect(JSON.parse(runs[0]!.errors as string)).toEqual([]);
    expect(JSON.parse(runs[0]!.sample as string)).toHaveLength(3); // sample, at most 3
  });

  it('keeps each postal code’s flyers apart, even when the same flyer item appears under both', async () => {
    const { DB, raw } = await setup([]);
    await run(DB, fakeFlipp({ flyers: [flyerRow(7, 'NOFRILLS')], items: { '7': [chicken] } }));
    await runIngest(
      { DB },
      'K1A0B1',
      [{ name: 'No Frills' }],
      fakeFlipp({ flyers: [flyerRow(7, 'NOFRILLS')], items: { '7': [chicken] } }) as unknown as typeof fetch,
      { sleep: noSleep, spacingMs: 0, retryDelayMs: 0 },
    );
    expect(flyerIds(raw)).toEqual(['flipp:101']);
    expect(flyerIds(raw, 'K1A0B1')).toEqual(['flipp:101']);
    expect(rows<{ postal_code: string }>(raw, 'SELECT postal_code FROM ingest_runs ORDER BY postal_code').map((r) => r.postal_code)).toEqual([
      'K1A0B1',
      POSTAL,
    ]);
  });

  it('falls back to a search by name, with at most 30 terms, when the flyer list fails', async () => {
    const { DB, raw } = await setup([]);
    const fetchMock = fakeFlipp({ flyers: 'fail', search: [chicken] });
    const result = await run(DB, fetchMock);

    const terms = fallbackSearchTerms();
    expect(terms.length).toBe(30);
    const searchCalls = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith(FLIPP_SEARCH_URL));
    expect(searchCalls).toHaveLength(30);
    expect(result).toMatchObject({ ok: true, mode: 'search', terms: 30, flyerCount: 0, items: 1, kept: 1, matched: 1 });
    expect(result.errors).toEqual(['flyer list HTTP 500']);
    expect(rows(raw, 'SELECT mode FROM ingest_runs')).toEqual([{ mode: 'search' }]);
  });

  it('falls back to a search when the flyers have no items', async () => {
    const { DB } = await setup([]);
    const fetchMock = fakeFlipp({ flyers: [flyerRow(7, 'No Frills')], items: { '7': [] }, search: [] });
    const result = await run(DB, fetchMock);
    expect(result).toMatchObject({ mode: 'search', flyerCount: 0, items: 0 });
  });

  it('collapses identical failures into one line with a count', async () => {
    const { DB } = await setup([]);
    const fetchMock = fakeFlipp({ flyers: 'throw', search: 'throw' });
    const result = await run(DB, fetchMock);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Too many subrequests by single Worker invocation (30 searches)');
    expect(result.errors.filter((e) => e.includes('Too many subrequests'))).toHaveLength(2);
  });

  it('stays within the request budget and says so', async () => {
    const { DB } = await setup([]);
    const h = household({ stores: household().stores.map((s) => ({ ...s, enabled: true })) });
    // Three flyers per store, all failing: the list, then two requests per flyer, then the search fallback.
    const flyers = h.stores.flatMap((s) => [1, 2, 3].map((n) => flyerRow(Number(`${s.name.length}${n}`), s.name)));
    const fetchMock = fakeFlipp({ flyers, items: {}, search: 'fail' });
    const result = await run(DB, fetchMock, h);

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(SUBREQUEST_BUDGET);
    expect(fetchMock.mock.calls.length).toBe(SUBREQUEST_BUDGET);
    expect(result.errors.at(-1)).toBe(BUDGET_STOP_MESSAGE);
    expect(result.mode).toBe('search');
  });
});

describe('POST /flyers/refresh (the household’s postal code)', () => {
  it('explains and stops without a postal code: no fetch, no run row', async () => {
    const { env, cookies, raw } = await setup();
    await householdWith(raw, env, cookies[OWNER]!, OWNER, household({ postalCode: undefined }));
    const fetchMock = vi.fn(async () => json([]));
    vi.stubGlobal('fetch', fetchMock);
    const res = await call(`${API}/flyers/refresh`, withCookie(cookies[OWNER]!, { method: 'POST' }), env);
    expect(await res.json()).toMatchObject({ ok: false, errors: ['Add a postal code in Household first.'] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(count(raw, 'ingest_runs')).toBe(0);
    vi.unstubAllGlobals();
  });

  it('explains and stops when no store is enabled', async () => {
    const { env, cookies, raw } = await setup();
    await householdWith(raw, env, cookies[OWNER]!, OWNER, household({ stores: household().stores.map((s) => ({ ...s, enabled: false })) }));
    const res = await call(`${API}/flyers/refresh`, withCookie(cookies[OWNER]!, { method: 'POST' }), env);
    expect(await res.json()).toMatchObject({ errors: ['Turn on at least one store in Household first.'] });
    expect(count(raw, 'ingest_runs')).toBe(0);
  });

  it('refuses a second refresh of the same postal code within ten minutes, and says when to try again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T12:00:00.000Z'));
    const { env, cookies, raw } = await setup();
    await householdWith(raw, env, cookies[OWNER]!, OWNER, household());
    vi.stubGlobal('fetch', fakeFlipp({ flyers: [flyerRow(7, 'NOFRILLS')], items: { '7': [chicken] } }));
    const cookie = cookies[OWNER]!;

    expect((await call(`${API}/flyers/refresh`, withCookie(cookie, { method: 'POST' }), env)).status).toBe(200);

    vi.setSystemTime(new Date('2026-11-05T12:04:00.000Z'));
    const again = await call(`${API}/flyers/refresh`, withCookie(cookie, { method: 'POST' }), env);
    expect(again.status).toBe(429);
    expect(await again.text()).toBe('Flyers for this postal code were refreshed a few minutes ago. Try again in 6 minutes.');

    vi.setSystemTime(new Date('2026-11-05T12:10:00.000Z'));
    expect((await call(`${API}/flyers/refresh`, withCookie(cookie, { method: 'POST' }), env)).status).toBe(200);
    expect(count(raw, 'ingest_runs')).toBe(2);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows the flyer status for the household’s postal code only', async () => {
    const { env, cookies, raw } = await setup();
    await householdWith(raw, env, cookies[OWNER]!, OWNER, household());
    raw
      .prepare(
        `INSERT INTO flyer_items (postal_code, id, store, raw_name, price_text, valid_from, valid_to, source, fetched_at)
         VALUES ('K1A0B1', 'elsewhere', 'Metro', 'Milk', '$3', '2000-01-01', '2099-01-01', 'flipp', 'now')`,
      )
      .run();
    const res = await call(`${API}/flyers/status`, { headers: { cookie: cookies[OWNER]! } }, env);
    expect(await res.json()).toEqual({ lastRun: null, currentItems: [] });
  });
});

describe('Worker default export', () => {
  it('still serves fetch through the Hono app', async () => {
    const { DB } = await setup([]);
    const res = await worker.fetch(new Request('https://x.test/provisions/api/health'), {
      DB,
      ASSETS: { fetch: async () => new Response('asset') },
      ALLOWED_EMAILS: '',
    } as never, {} as ExecutionContext);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});


