// Flyer import against an in-memory D1 stub and a fake Flipp fetch. No network, no real D1.
import { describe, expect, it, vi } from 'vitest';
import { buildSearchTerms, defaultHousehold, type Household } from '@provisions/shared';
import worker from './index';
import { runIngest } from './ingest';

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

const chicken = {
  id: 1,
  flyer_item_id: 101,
  merchant_name: 'No Frills',
  name: 'PC Boneless Skinless Chicken Thighs',
  current_price: 4.39,
  post_price_text: '/kg',
  valid_from: '2026-11-12',
  valid_to: '2026-11-18',
};
const tide = { ...chicken, flyer_item_id: 102, name: 'Tide Pods 81 ct', current_price: 12.99, post_price_text: '' };

function fakeFlipp(rows: unknown[], status = 200) {
  return vi.fn(async () => new Response(JSON.stringify({ items: rows }), { status, headers: { 'content-type': 'application/json' } }));
}

describe('runIngest', () => {
  it('explains and stops without a postal code: no fetch, no writes', async () => {
    const { db, writes } = fakeDb(household({ postalCode: undefined }));
    const fetchMock = fakeFlipp([chicken]);
    const result = await runIngest({ DB: db }, fetchMock as unknown as typeof fetch, { sleep: noSleep, spacingMs: 0 });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['Add a postal code in Household first.']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('explains and stops when no store is enabled', async () => {
    const h = household({ stores: household().stores.map((s) => ({ ...s, enabled: false })) });
    const { db, writes } = fakeDb(h);
    const fetchMock = fakeFlipp([chicken]);
    const result = await runIngest({ DB: db }, fetchMock as unknown as typeof fetch, { sleep: noSleep, spacingMs: 0 });
    expect(result.errors).toEqual(['Turn on at least one store in Household first.']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('stores the flyer items, records matched prices, and writes one ingest_runs row', async () => {
    const { db, writes } = fakeDb(household());
    const fetchMock = fakeFlipp([chicken, tide]);
    const result = await runIngest({ DB: db }, fetchMock as unknown as typeof fetch, { sleep: noSleep, spacingMs: 0 });

    const terms = buildSearchTerms();
    expect(fetchMock).toHaveBeenCalledTimes(terms.length);
    expect(result).toMatchObject({ ok: true, terms: terms.length, items: 2, stored: 2, matched: 1 });
    expect(result.errors).toEqual([]);
    expect(result.unmatchedSample).toEqual(['Tide Pods 81 ct']);

    const flyerWrites = writes.filter((w) => w.sql.startsWith('INSERT OR REPLACE INTO flyer_items'));
    expect(flyerWrites).toHaveLength(2);
    expect(flyerWrites[0]!.args).toEqual(['flipp:101', 'No Frills', 'PC Boneless Skinless Chicken Thighs', '$4.39/kg', null, '2026-11-12', '2026-11-18', 'flipp', expect.any(String)]);

    const priceWrites = writes.filter((w) => w.sql.startsWith('INSERT OR REPLACE INTO price_history'));
    expect(priceWrites).toHaveLength(1);
    expect(priceWrites[0]!.args[4]).toBe(1); // on sale

    const runWrite = writes.find((w) => w.sql.startsWith('INSERT INTO ingest_runs'));
    expect(runWrite).toBeDefined();
    const args = runWrite!.args as unknown[];
    expect(args[3]).toBe(1); // ok
    expect(args[4]).toBe(terms.length);
    expect(args[5]).toBe(2); // items found
    expect(args[6]).toBe(2); // stored
    expect(args[7]).toBe(1); // matched
    expect(JSON.parse(args[8] as string)).toEqual([]);
    expect(JSON.parse(args[9] as string)).toHaveLength(2); // sample, at most 3
  });

  it('reports ok false when every term fails, and keeps the errors', async () => {
    const { db, writes } = fakeDb(household());
    const fetchMock = vi.fn(async () => new Response('down', { status: 500 }));
    const result = await runIngest({ DB: db }, fetchMock as unknown as typeof fetch, { sleep: noSleep, spacingMs: 0 });
    expect(result.ok).toBe(false);
    expect(result.stored).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.length).toBeLessThanOrEqual(20);
    expect(writes.some((w) => w.sql.startsWith('INSERT INTO ingest_runs'))).toBe(true);
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
    expect(writes).toEqual([]);
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
