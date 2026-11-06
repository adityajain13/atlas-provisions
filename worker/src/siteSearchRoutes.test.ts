// The address search through the Worker app: one banner's locations (text, or nearest to a postal code) and the
// cross-banner search. A fake fetch answers each banner's list by its id; no network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API, call, setup, withCookie, OWNER } from './testing/app';

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const rec = (storeId: string, name: string, line1: string, town: string, postalCode: string, lat: number, lng: number) => ({
  storeId,
  name,
  address: { line1, town, postalCode },
  geoPoint: { latitude: lat, longitude: lng },
});

/** Locations by the chain's PC id. 'forbidden' answers the listing with a sign-in refusal. */
const LISTS: Record<string, unknown[] | 'forbidden'> = {
  nofrills: [
    rec('101', 'No Frills Bloor', '425 Bloor St W', 'Toronto', 'M5S1W7', 43.6659, -79.4066),
    rec('102', 'No Frills CityPlace', '15 Lower Simcoe St', 'Toronto', 'M5V3K3', 43.6401, -79.3972),
    rec('103', 'No Frills Christie', '1 Christie St', 'Toronto', 'M6G3H4', 43.6696, -79.4183),
    rec('104', 'No Frills Church', '1 Church St', 'Toronto', 'M4Y1A6', 43.6667, -79.3806),
    rec('105', 'No Frills Scarborough', '3850 Finch Ave E', 'Scarborough', 'M1S5H5', 43.78, -79.26),
  ],
  superstore: [rec('201', 'Real Canadian Superstore Bloor', '1 Lansdowne Ave', 'Toronto', 'M6H4A1', 43.6588, -79.4442)],
  loblaw: [rec('301', 'Loblaws Yonge and Bloor', '2 Bloor St E', 'Toronto', 'M4W1A8', 43.6707, -79.3866)],
  zehrs: 'forbidden',
};

function chainFetch(lists: Record<string, unknown[] | 'forbidden'> = LISTS) {
  return vi.fn(async (url: string | URL | Request) => {
    const id = /bannerIds=([^&]+)/.exec(String(url))?.[1];
    if (!id) throw new Error(`unexpected request ${String(url)}`);
    const list = lists[decodeURIComponent(id)];
    if (list === 'forbidden') return new Response('no', { status: 403 });
    return reply({ pickupLocations: list ?? [] });
  });
}

describe('one banner, by postal code and by text', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists the nearest locations to a postal code that no store has, with distances and approx set', async () => {
    vi.stubGlobal('fetch', chainFetch());
    const { env, cookies } = await setup();
    const got = (await (await call(`${API}/site-stores/nofrills/locations?q=M5T%201R5`, withCookie(cookies[OWNER]!), env)).json()) as {
      locations: Array<{ storeId: string; label: string; distanceKm: number }>;
      approx?: boolean;
    };
    expect(got.approx).toBe(true);
    expect(got.locations.map((l) => l.storeId).slice(0, 2).sort()).toEqual(['101', '102']);
    expect(got.locations.map((l) => l.distanceKm)).toEqual([...got.locations.map((l) => l.distanceKm)].sort((a, b) => a - b));
    expect(got.locations.at(-1)?.storeId).toBe('105');
    expect(got.locations[0]!.label).toMatch(/^No Frills · \d/);
  });

  it('reads a postal code typed without the space the same as with it', async () => {
    vi.stubGlobal('fetch', chainFetch());
    const { env, cookies } = await setup();
    const cookie = cookies[OWNER]!;
    const spaced = await (await call(`${API}/site-stores/nofrills/locations?q=M5T%201R5`, withCookie(cookie), env)).json();
    const plain = await (await call(`${API}/site-stores/nofrills/locations?q=m5t1r5`, withCookie(cookie), env)).json();
    expect(plain).toEqual(spaced);
  });

  it('lists the nearest to the household postal code for an empty search', async () => {
    vi.stubGlobal('fetch', chainFetch());
    const { env, cookies } = await setup();
    const got = (await (await call(`${API}/site-stores/nofrills/locations?q=&near=M5T%201R5`, withCookie(cookies[OWNER]!), env)).json()) as {
      locations: Array<{ storeId: string }>;
    };
    expect(got.locations.map((l) => l.storeId).slice(0, 2).sort()).toEqual(['101', '102']);
  });

  it('answers nothing for an empty search with no household postal code, without asking the site', async () => {
    const fetchMock = chainFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { env, cookies } = await setup();
    expect(await (await call(`${API}/site-stores/nofrills/locations?q=`, withCookie(cookies[OWNER]!), env)).json()).toEqual({ locations: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('adds the distance from the household postal code to a text match, and keeps the match', async () => {
    vi.stubGlobal('fetch', chainFetch());
    const { env, cookies } = await setup();
    const got = (await (await call(`${API}/site-stores/nofrills/locations?q=bloor&near=M5T%201R5`, withCookie(cookies[OWNER]!), env)).json()) as {
      locations: Array<{ storeId: string; distanceKm?: number }>;
    };
    expect(got.locations.map((l) => l.storeId)).toEqual(['101']);
    expect(typeof got.locations[0]!.distanceKm).toBe('number');
  });

  it('keeps the text match without distances when no household postal code is given', async () => {
    vi.stubGlobal('fetch', chainFetch());
    const { env, cookies } = await setup();
    const got = (await (await call(`${API}/site-stores/nofrills/locations?q=scarborough`, withCookie(cookies[OWNER]!), env)).json()) as {
      locations: Array<Record<string, unknown>>;
    };
    expect(got.locations).toEqual([{ storeId: '105', label: 'No Frills · 3850 Finch Ave E, Scarborough', postalCode: 'M1S5H5' }]);
  });

  it('never asks the site for T&T, even for a postal code', async () => {
    const fetchMock = chainFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { env, cookies } = await setup();
    const got = (await (await call(`${API}/site-stores/tandt/locations?q=M5T%201R5&near=M5T%201R5`, withCookie(cookies[OWNER]!), env)).json()) as {
      locations: unknown[];
      unsupported?: boolean;
    };
    expect(got).toMatchObject({ locations: [], unsupported: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the cross-banner search', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('finds the nearest locations across the banners for a postal code, and names the banner that refused', async () => {
    const fetchMock = chainFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { env, cookies } = await setup();
    const got = (await (await call(`${API}/site-stores/search?q=M5T%201R5`, withCookie(cookies[OWNER]!), env)).json()) as {
      locations: Array<{ banner: string; storeId: string; label: string; distanceKm: number }>;
      unavailable: string[];
      approx?: boolean;
    };
    expect(got.approx).toBe(true);
    expect(got.unavailable).toEqual(['zehrs']);
    expect(new Set(got.locations.map((l) => l.banner))).toEqual(new Set(['nofrills', 'superstore', 'loblaws']));
    expect(got.locations.slice(0, 2).map((l) => l.storeId).sort()).toEqual(['101', '102']);
    expect(got.locations.length).toBeLessThanOrEqual(8);
    expect(got.locations[0]!.label).toMatch(/^No Frills · /);
  });

  it('never asks the site for T&T', async () => {
    const fetchMock = chainFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { env, cookies } = await setup();
    await call(`${API}/site-stores/search?q=Bloor`, withCookie(cookies[OWNER]!), env);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('tandt'))).toBe(false);
    expect(urls.length).toBeGreaterThan(0);
  });

  it('lists the nearest across the banners for an empty search with the household postal code', async () => {
    vi.stubGlobal('fetch', chainFetch());
    const { env, cookies } = await setup();
    const got = (await (await call(`${API}/site-stores/search?q=&near=M5T%201R5`, withCookie(cookies[OWNER]!), env)).json()) as {
      locations: Array<{ distanceKm: number }>;
    };
    expect(got.locations.length).toBeGreaterThan(0);
    expect(got.locations.map((l) => l.distanceKm)).toEqual([...got.locations.map((l) => l.distanceKm)].sort((a, b) => a - b));
  });

  it('answers nothing for an empty search with no household postal code, and asks the site for nothing', async () => {
    const fetchMock = chainFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { env, cookies } = await setup();
    expect(await (await call(`${API}/site-stores/search?q=&near=`, withCookie(cookies[OWNER]!), env)).json()).toEqual({ locations: [], unavailable: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads a banner that has locations once a week, so a second search does not ask the site for it again', async () => {
    const fetchMock = chainFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { env, cookies } = await setup();
    const cookie = cookies[OWNER]!;
    const asked = (id: string) => fetchMock.mock.calls.filter((c) => String(c[0]).includes(`bannerIds=${id}`)).length;
    await call(`${API}/site-stores/search?q=M5T%201R5`, withCookie(cookie), env);
    expect(asked('nofrills')).toBe(1);
    expect(asked('loblaw')).toBe(1);
    await call(`${API}/site-stores/search?q=bloor`, withCookie(cookie), env);
    expect(asked('nofrills')).toBe(1);
    expect(asked('superstore')).toBe(1);
    expect(asked('loblaw')).toBe(1);
  });
});
