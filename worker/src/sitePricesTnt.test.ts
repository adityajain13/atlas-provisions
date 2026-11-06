// T&T is not read by the regular-price batch: its site blocks automated lookups, so no request ever goes to it, an
// enabled T&T store has no target and adds no price, and a Loblaw-family store in the same run is still read. No network.
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { defaultHousehold, type Household, type Store } from '@provisions/shared';
import { newTestDb } from './testing/d1';
import { siteStatus, siteTargets, runSitePrices } from './sitePrices';

const NOW = new Date('2026-11-04T15:00:00.000Z');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const TNT: Store = { id: 'tt-supermarket', name: 'T&T Supermarket', group: 'Other', enabled: true, priceMatches: false };
const NO_FRILLS: Store = {
  id: 'no-frills',
  name: 'No Frills',
  group: 'Loblaw',
  enabled: true,
  priceMatches: true,
  siteStore: { banner: 'nofrills', storeId: '1234', label: 'No Frills · 1000 Dixie Rd, Mississauga' },
};

function household(stores: Store[]): Household {
  return { ...defaultHousehold(), postalCode: 'M5T 1R5', stores };
}

function addHousehold(raw: DatabaseSync, id: string, doc: Household) {
  raw.prepare("INSERT INTO households (id, name, data, created_at, updated_at) VALUES (?, ?, ?, 'now', 'now')").run(id, id, JSON.stringify(doc));
}

/** A Loblaw-family fake that answers every search with no results. Any other host is a failure. */
function loblawFetch() {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('tntsupermarket.com')) throw new Error(`unexpected request to ${u}`);
    return json({ results: [] });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('siteTargets without T&T', () => {
  it('leaves out an enabled T&T store, with or without a location saved from before', () => {
    expect(siteTargets(household([TNT]))).toEqual([]);
    expect(siteTargets(household([{ ...TNT, siteStore: { banner: 'nofrills', storeId: '1', label: 'x' } } as Store]))).toEqual([]);
  });
});

describe('runSitePrices with T&T', () => {
  it('sends no request when T&T is the only store', async () => {
    const { raw, DB } = newTestDb();
    addHousehold(raw, 'h1', household([TNT]));
    const fetchImpl = loblawFetch();
    const got = await runSitePrices({ DB }, 'h1', fetchImpl, 40, NOW);
    expect(got).toMatchObject({ ok: false, lookups: 0, matched: 0 });
    expect(got.errors).toEqual(['Pick a store location for regular prices first.']);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads a Loblaw-family store in the same run, and never sends a request to T&T', async () => {
    const { raw, DB } = newTestDb();
    addHousehold(raw, 'h1', household([NO_FRILLS, TNT]));
    const fetchImpl = loblawFetch();
    await runSitePrices({ DB }, 'h1', fetchImpl, 40, NOW);
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.some((u) => u.includes('tntsupermarket.com'))).toBe(false);
    const stores = raw.prepare("SELECT DISTINCT store FROM price_history WHERE source = 'site'").all();
    expect(stores).toEqual([]);
  });

  it('counts no T&T price in the status', async () => {
    const { raw, DB } = newTestDb();
    const doc = household([TNT]);
    addHousehold(raw, 'h1', doc);
    expect(await siteStatus(DB, 'h1', doc, NOW, false)).toEqual({ lastRun: null, prices: 0 });
  });
});
