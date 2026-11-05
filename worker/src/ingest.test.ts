// Flyer import against an in-memory D1 stub and a URL-routed fake Flipp. No network, no real D1.
import { describe, expect, it, vi } from 'vitest';
import { defaultHousehold, fallbackSearchTerms, type Household } from '@provisions/shared';
import worker from './index';
import { runIngest } from './ingest';
import { BUDGET_STOP_MESSAGE, FLIPP_FLYERS_URL, FLIPP_SEARCH_URL, SUBREQUEST_BUDGET } from './flipp';

const noSleep = async () => {};

type Write = { sql: string; args: unknown[] };

function fakeDb(household: Household | null) {
  const writes: Write[] = [];
  const stmt = (sql: string, args: unknown[] = []) => ({
    sql,
    args,
    bind: (...values: unknown[]) => stmt(sql, values),
    async first() {
      if (sql.startsWith('SELECT data FROM household')) return household ? { data: JSON.stringify(household) } : null;
      return null;
    },
    async all() {
      return { results: [] };
    },
    async run() {
      writes.push({ sql, args });
      return { meta: { changes: 1 } };
    },
  });
  const db = {
    prepare: (sql: string) => stmt(sql),
    async batch(statements: { sql: string; args: unknown[] }[]) {
      for (const s of statements) writes.push({ sql: s.sql, args: s.args });
      return [];
    },
  };
  return { db: db as unknown as D1Database, writes };
}

function household(over: Partial<Household> = {}): Household {
  const h = defaultHousehold();
  return {
    ...h,
    postalCode: 'M5V2T6',
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

const run = (db: D1Database, fetchMock: unknown, opts: Record<string, unknown> = {}) =>
  runIngest({ DB: db }, fetchMock as unknown as typeof fetch, { sleep: noSleep, spacingMs: 0, retryDelayMs: 0, ...opts });

describe('runIngest', () => {
  it('explains and stops without a postal code: no fetch, no writes', async () => {
    const { db, writes } = fakeDb(household({ postalCode: undefined }));
    const fetchMock = fakeFlipp({ flyers: [flyerRow(1, 'No Frills')] });
    const result = await run(db, fetchMock);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['Add a postal code in Household first.']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('explains and stops when no store is enabled', async () => {
    const h = household({ stores: household().stores.map((s) => ({ ...s, enabled: false })) });
    const { db, writes } = fakeDb(h);
    const fetchMock = fakeFlipp({ flyers: [flyerRow(1, 'No Frills')] });
    const result = await run(db, fetchMock);
    expect(result.errors).toEqual(['Turn on at least one store in Household first.']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('reads the flyers of household stores, stores and matches their items, and writes one run row', async () => {
    const { db, writes } = fakeDb(household());
    const fetchMock = fakeFlipp({
      flyers: [flyerRow(7, 'NOFRILLS'), flyerRow(8, 'Walmart')],
      items: { '7': [chicken, tide, combo] },
    });
    const result = await run(db, fetchMock);

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

    const flyerWrites = writes.filter((w) => w.sql.startsWith('INSERT OR REPLACE INTO flyer_items'));
    expect(flyerWrites.map((w) => w.args[0])).toEqual(['flipp:101', 'flipp:102', 'flipp:103#1', 'flipp:103#2']);
    expect(flyerWrites[0]!.args).toEqual(['flipp:101', 'No Frills', 'PC Boneless Skinless Chicken Thighs', '$4.39/kg', null, '2026-11-12', '2099-11-18', 'flipp', expect.any(String)]);

    const priceWrites = writes.filter((w) => w.sql.startsWith('INSERT OR REPLACE INTO price_history'));
    expect(priceWrites).toHaveLength(3);

    const runWrite = writes.find((w) => w.sql.startsWith('INSERT INTO ingest_runs'));
    expect(runWrite).toBeDefined();
    const args = runWrite!.args as unknown[];
    expect(args.slice(3, 11)).toEqual([1, 'flyers', 0, expect.any(String), 3, 3, 4, 3]); // ok, mode, terms, flyers, items, kept, stored, matched
    expect(JSON.parse(args[6] as string)).toEqual([
      { id: '7', merchant: 'NOFRILLS', name: 'NOFRILLS weekly', store: 'No Frills', items: 3 },
    ]);
    expect(JSON.parse(args[11] as string)).toEqual([]);
    expect(JSON.parse(args[12] as string)).toHaveLength(3); // sample, at most 3
  });

  it('falls back to a search by name, with at most 30 terms, when the flyer list fails', async () => {
    const { db, writes } = fakeDb(household());
    const fetchMock = fakeFlipp({ flyers: 'fail', search: [chicken] });
    const result = await run(db, fetchMock);

    const terms = fallbackSearchTerms();
    expect(terms.length).toBe(30);
    const searchCalls = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith(FLIPP_SEARCH_URL));
    expect(searchCalls).toHaveLength(30);
    expect(result).toMatchObject({ ok: true, mode: 'search', terms: 30, flyerCount: 0, items: 1, kept: 1, matched: 1 });
    expect(result.errors).toEqual(['flyer list HTTP 500']);
    const args = writes.find((w) => w.sql.startsWith('INSERT INTO ingest_runs'))!.args;
    expect(args[4]).toBe('search');
  });

  it('falls back to a search when the flyers have no items', async () => {
    const { db } = fakeDb(household());
    const fetchMock = fakeFlipp({ flyers: [flyerRow(7, 'No Frills')], items: { '7': [] }, search: [] });
    const result = await run(db, fetchMock);
    expect(result).toMatchObject({ mode: 'search', flyerCount: 0, items: 0 });
  });

  it('collapses identical failures into one line with a count', async () => {
    const { db } = fakeDb(household());
    const fetchMock = fakeFlipp({ flyers: 'throw', search: 'throw' });
    const result = await run(db, fetchMock);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Too many subrequests by single Worker invocation (30 searches)');
    expect(result.errors.filter((e) => e.includes('Too many subrequests'))).toHaveLength(2);
  });

  it('stays within the request budget and says so', async () => {
    const h = household({ stores: household().stores.map((s) => ({ ...s, enabled: true })) });
    const { db } = fakeDb(h);
    // Three flyers per store, all failing: the list, then two requests per flyer, then the search fallback.
    const flyers = h.stores.flatMap((s) => [1, 2, 3].map((n) => flyerRow(Number(`${s.name.length}${n}`), s.name)));
    const fetchMock = fakeFlipp({ flyers, items: {}, search: 'fail' });
    const result = await run(db, fetchMock);

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(SUBREQUEST_BUDGET);
    expect(fetchMock.mock.calls.length).toBe(SUBREQUEST_BUDGET);
    expect(result.errors.at(-1)).toBe(BUDGET_STOP_MESSAGE);
    expect(result.mode).toBe('search');
  });
});

describe('Worker default export', () => {
  it('runs the import from the scheduled handler', async () => {
    const { db, writes } = fakeDb(household({ postalCode: undefined }));
    const waitUntil = vi.fn();
    const ctx = { waitUntil, passThroughOnException: vi.fn() };
    const env = { DB: db } as never;

    worker.scheduled({} as ScheduledEvent, env, ctx as unknown as ExecutionContext);

    expect(waitUntil).toHaveBeenCalledTimes(1);
    const promise = waitUntil.mock.calls[0]![0] as Promise<{ ok: boolean; errors: string[] }>;
    await expect(promise).resolves.toMatchObject({ ok: false, errors: ['Add a postal code in Household first.'] });
    // The import writes nothing; the same job then deletes the plans and ticks past retention.
    expect(writes.map((w) => w.sql)).toEqual(['DELETE FROM meal_plans WHERE week_of < ?', 'DELETE FROM checks WHERE week_of < ?']);
  });

  it('still serves fetch through the Hono app', async () => {
    const { db } = fakeDb(household());
    const res = await worker.fetch(new Request('https://x.test/provisions/api/health'), {
      DB: db,
      ASSETS: { fetch: async () => new Response('asset') },
      ALLOWED_EMAILS: '',
    } as never, {} as ExecutionContext);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
