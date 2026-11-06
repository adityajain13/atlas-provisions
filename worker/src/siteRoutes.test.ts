// The regular-price routes through the Worker app, with an in-memory database and a stubbed global fetch (the routes
// call fetch by name). No network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultHousehold, type Household } from '@provisions/shared';
import { API, OWNER, call, householdWith, setup, withCookie } from './testing/app';

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const NO_FRILLS_LOCATION = {
  storeId: '1234',
  name: 'No Frills Dixie',
  address: { line1: '1000 Dixie Rd', town: 'Mississauga', postalCode: 'L4Y2A2' },
};

/** Answers the location list with one store, and every product search with a 1 kg pack of the term at $8. */
function siteFetch(overrides: { locations?: Response; search?: Response } = {}) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/pickup-locations')) return overrides.locations ?? reply({ pickupLocations: [NO_FRILLS_LOCATION] });
    if (u.includes('/products/search')) {
      if (overrides.search) return overrides.search;
      const body = JSON.parse(String(init?.body ?? '{}')) as { term: string };
      return reply({ results: [{ name: body.term, packageSize: '1 kg', prices: { price: { value: 8 } } }] });
    }
    throw new Error(`unexpected request ${u}`);
  });
}

const NO_FRILLS = {
  id: 'no-frills',
  name: 'No Frills',
  enabled: true,
  priceMatches: true,
  group: 'Loblaw' as const,
  siteStore: { banner: 'nofrills' as const, storeId: '1234', label: 'No Frills · 1000 Dixie Rd, Mississauga' },
};

function doc(over: Partial<Household> = {}): Household {
  return { ...defaultHousehold(), postalCode: 'L5L3T4', stores: [NO_FRILLS], ...over };
}

describe('site store locations', () => {
  let fetchMock: ReturnType<typeof siteFetch>;
  beforeEach(() => {
    fetchMock = siteFetch();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists the locations that match the search, and caches the listing for a week', async () => {
    const { DB, env, cookies } = await setup();
    const cookie = cookies[OWNER]!;
    const got = await call(`${API}/site-stores/nofrills/locations?q=dixie`, withCookie(cookie), env);
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual({
      locations: [{ storeId: '1234', label: 'No Frills · 1000 Dixie Rd, Mississauga', postalCode: 'L4Y2A2' }],
    });
    await call(`${API}/site-stores/nofrills/locations?q=mississauga`, withCookie(cookie), env);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(DB).toBeDefined();
  });

  it('returns no locations for an empty search, and refuses a banner the app does not read', async () => {
    const { env, cookies } = await setup();
    const cookie = cookies[OWNER]!;
    expect(await (await call(`${API}/site-stores/nofrills/locations?q=`, withCookie(cookie), env)).json()).toEqual({ locations: [] });
    expect((await call(`${API}/site-stores/metro/locations?q=x`, withCookie(cookie), env)).status).toBe(400);
  });

  it('says a PC id sign-in is needed when the site refuses the search', async () => {
    vi.stubGlobal('fetch', siteFetch({ locations: new Response('no', { status: 403 }) }));
    const { env, cookies } = await setup();
    const got = await call(`${API}/site-stores/loblaws/locations?q=x`, withCookie(cookies[OWNER]!), env);
    expect(got.status).toBe(409);
    expect(await got.text()).toMatch(/PC id sign-in/);
  });

  it('answers 200 with unsupported, and the site status, when the site refuses the listing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ message: 'not available' }, 400)));
    const { env, cookies } = await setup();
    const got = await call(`${API}/site-stores/valumart/locations?q=mississauga`, withCookie(cookies[OWNER]!), env);
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual({ locations: [], unsupported: true, status: 400 });
  });

  it('never asks the site for T&T locations: the answer is unsupported with no request', async () => {
    const fetchMock = vi.fn(async () => reply({ pickupLocations: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const { env, cookies } = await setup();
    const got = await call(`${API}/site-stores/tandt/locations?q=L5A%203V7`, withCookie(cookies[OWNER]!), env);
    expect(await got.json()).toEqual({ locations: [], unsupported: true, status: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('regular price refresh and status', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says so, without sending any search, when no store has a location', async () => {
    const fetchMock = siteFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { raw, env, cookies } = await setup();
    const cookie = cookies[OWNER]!;
    await householdWith(raw, env, cookie, OWNER, doc({ stores: [{ ...NO_FRILLS, siteStore: undefined }] }));
    const got = await (await call(`${API}/site-prices/refresh`, { method: 'POST', headers: { cookie } }, env)).json();
    expect(got).toMatchObject({ ok: false, lookups: 0, authNeeded: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the prices, then refuses a second refresh within ten minutes', async () => {
    const fetchMock = siteFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { raw, env, cookies } = await setup();
    const cookie = cookies[OWNER]!;
    await householdWith(raw, env, cookie, OWNER, doc());

    const first = await call(`${API}/site-prices/refresh`, { method: 'POST', headers: { cookie } }, env);
    expect(first.status).toBe(200);
    const result = (await first.json()) as { ok: boolean; lookups: number; matched: number; authNeeded: boolean };
    expect(result).toMatchObject({ ok: true, authNeeded: false });
    expect(result.lookups).toBeGreaterThan(0);
    expect(result.matched).toBeGreaterThan(0);

    const second = await call(`${API}/site-prices/refresh`, { method: 'POST', headers: { cookie } }, env);
    expect(second.status).toBe(429);
    expect(await second.text()).toMatch(/Try again in \d+ minutes?/);
  });

  it('reports the latest run, its sample with ?debug=1, and the prices in the window', async () => {
    vi.stubGlobal('fetch', siteFetch());
    const { raw, env, cookies } = await setup();
    const cookie = cookies[OWNER]!;
    await householdWith(raw, env, cookie, OWNER, doc());
    expect(await (await call(`${API}/site-prices/status`, { headers: { cookie } }, env)).json()).toEqual({ lastRun: null, prices: 0 });

    await call(`${API}/site-prices/refresh`, { method: 'POST', headers: { cookie } }, env);
    const plain = (await (await call(`${API}/site-prices/status`, { headers: { cookie } }, env)).json()) as {
      lastRun: Record<string, unknown>;
      prices: number;
    };
    expect(plain.lastRun).not.toHaveProperty('sample');
    expect(plain.prices).toBeGreaterThan(0);
    const debug = (await (await call(`${API}/site-prices/status?debug=1`, { headers: { cookie } }, env)).json()) as {
      lastRun: { sample: unknown[] };
    };
    expect(debug.lastRun.sample.length).toBeGreaterThan(0);
  });

  it('reports a sign-in need from the search, and does not send more searches to that banner', async () => {
    const fetchMock = siteFetch({ search: new Response('', { status: 401 }) });
    vi.stubGlobal('fetch', fetchMock);
    const { raw, env, cookies } = await setup();
    const cookie = cookies[OWNER]!;
    await householdWith(raw, env, cookie, OWNER, doc());
    const got = (await (await call(`${API}/site-prices/refresh`, { method: 'POST', headers: { cookie } }, env)).json()) as {
      authNeeded: boolean;
      matched: number;
    };
    expect(got).toMatchObject({ authNeeded: true, matched: 0 });
    const searches = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/products/search'));
    expect(searches).toHaveLength(1);
  });
});

describe('the household document', () => {
  it('keeps a store location on save, and refuses one on a banner the app does not read', async () => {
    const { env, cookies } = await setup();
    const cookie = cookies[OWNER]!;
    await call(`${API}/household`, { headers: { cookie } }, env);
    const ok = await call(
      `${API}/household`,
      { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(doc()) },
      env,
    );
    expect(ok.status).toBe(200);
    const saved = (await (await call(`${API}/household`, { headers: { cookie } }, env)).json()) as Household;
    expect(saved.stores[0]?.siteStore).toEqual(NO_FRILLS.siteStore);

    const bad = await call(
      `${API}/household`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(doc({ stores: [{ ...NO_FRILLS, id: 'metro', siteStore: { banner: 'metro', storeId: '1', label: 'x' } } as never] })),
      },
      env,
    );
    expect(bad.status).toBe(400);
  });
});
