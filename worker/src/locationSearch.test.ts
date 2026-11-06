// Ranking store locations by distance, and placing postal codes from the cached lists. Pure ranking on fake
// locations; the reference lists are read from an in-memory database with a fake fetch. No network.
import { describe, expect, it, vi } from 'vitest';
import { estimatePostalPoint, type SiteBanner } from '@provisions/shared';
import { NEAREST_LIMIT, originPoint, rankStores, referenceSamples, type Candidate } from './locationSearch';
import { newTestDb } from './testing/d1';
import type { SiteLocation } from './pcexpress';

const loc = (storeId: string, name: string, lat: number | undefined, lng: number | undefined, postalCode: string, line1 = `${storeId} Main St`, city = 'Toronto'): SiteLocation => ({
  storeId,
  name,
  line1,
  city,
  postalCode,
  ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}),
});

const NOFRILLS: Candidate[] = [
  { banner: 'nofrills', loc: loc('1', 'No Frills Bloor', 43.66, -79.4, 'M5S1W7', '425 Bloor St W') },
  { banner: 'nofrills', loc: loc('2', 'No Frills CityPlace', 43.64, -79.4, 'M5V3K3', '1 CityPlace Ave') },
  { banner: 'nofrills', loc: loc('3', 'No Frills Christie', 43.67, -79.42, 'M6G3H4', '1 Christie St') },
  { banner: 'nofrills', loc: loc('4', 'No Frills Church', 43.66, -79.38, 'M4Y1A6', '1 Church St') },
  { banner: 'nofrills', loc: loc('5', 'No Frills Scarborough', 43.77, -79.26, 'M1S5H5', '3850 Finch Ave E', 'Scarborough') },
  { banner: 'nofrills', loc: loc('6', 'No Frills Old', undefined, undefined, 'M5T9Z9', '9 Nowhere Rd') },
];

/** Origin at the middle of the M5 stores, as the M5T estimate would place it. */
const M5T: ReturnType<typeof estimatePostalPoint> = { lat: 43.65, lng: -79.4, approx: true };

describe('rankStores, nearest to a postal code', () => {
  it('lists the nearest locations first, and leaves out the ones with no coordinates', () => {
    const hits = rankStores(NOFRILLS, 'M5T 1R5', M5T);
    expect(hits.map((h) => h.storeId)).toEqual(['1', '2', '4', '3', '5']);
    expect(hits.every((h) => typeof h.distanceKm === 'number')).toBe(true);
    expect(hits[0]!.distanceKm!).toBeLessThanOrEqual(hits[1]!.distanceKm!);
  });

  it('gives the distance to one decimal place and the chain-labelled address', () => {
    const [first] = rankStores(NOFRILLS, 'M5T', M5T);
    expect(first).toEqual({
      banner: 'nofrills',
      storeId: '1',
      label: 'No Frills · 425 Bloor St W, Toronto',
      postalCode: 'M5S1W7',
      distanceKm: expect.any(Number),
    });
    expect(Number.isInteger(first!.distanceKm! * 10)).toBe(true);
  });

  it('caps the nearest list at eight', () => {
    const many: Candidate[] = Array.from({ length: 20 }, (_, i) => ({
      banner: 'nofrills' as SiteBanner,
      loc: loc(String(i), `No Frills ${i}`, 43.6 + i * 0.01, -79.4, 'M5T1A1'),
    }));
    expect(rankStores(many, 'M5T', M5T)).toHaveLength(NEAREST_LIMIT);
  });

  it('is nearest to an empty search too, with the household origin', () => {
    expect(rankStores(NOFRILLS, '', M5T).map((h) => h.storeId)).toEqual(['1', '2', '4', '3', '5']);
  });

  it('finds nothing for an empty search with no origin', () => {
    expect(rankStores(NOFRILLS, '', null)).toEqual([]);
  });
});

describe('rankStores, text search', () => {
  it('matches the text as before, with no distance when there is no origin', () => {
    const hits = rankStores(NOFRILLS, 'scarborough', null);
    expect(hits).toEqual([
      { banner: 'nofrills', storeId: '5', label: 'No Frills · 3850 Finch Ave E, Scarborough', postalCode: 'M1S5H5' },
    ]);
  });

  it('adds distances from the household origin and sorts the matches nearest first', () => {
    const hits = rankStores(NOFRILLS, 'toronto', M5T);
    expect(hits.map((h) => h.storeId)).toEqual(['1', '2', '4', '3', '6']);
    expect(hits.find((h) => h.storeId === '6')).not.toHaveProperty('distanceKm');
  });

  it('spans every banner it is given, and labels each with its chain', () => {
    const mixed: Candidate[] = [
      { banner: 'nofrills', loc: loc('1', 'No Frills Bloor', 43.66, -79.4, 'M5S1W7', '425 Bloor St W') },
      { banner: 'superstore', loc: loc('9', 'Superstore Bloor', 43.66, -79.41, 'M5S2A1', '500 Bloor St W') },
    ];
    expect(rankStores(mixed, 'bloor', null).map((h) => h.label)).toEqual([
      'No Frills · 425 Bloor St W, Toronto',
      'Real Canadian Superstore · 500 Bloor St W, Toronto',
    ]);
  });
});

describe('referenceSamples and originPoint, from the cached lists', () => {
  const LIST = (rows: Array<{ id: string; lat: number; lng: number; postal: string }>) =>
    JSON.stringify({
      v: 2,
      locations: rows.map((r) => ({ storeId: r.id, name: 'No Frills', line1: 'x', city: 'Toronto', postalCode: r.postal, lat: r.lat, lng: r.lng })),
    });

  it('places a postal code from every cached list that has coordinates, with no network when the lists are fresh', async () => {
    const { raw, DB } = newTestDb();
    const now = new Date('2026-11-05T12:00:00Z');
    const fresh = now.toISOString();
    for (const banner of ['nofrills', 'superstore', 'loblaws', 'independent'] as const) {
      raw.prepare('INSERT INTO site_locations (banner, data, fetched_at) VALUES (?, ?, ?)').run(
        banner,
        LIST([{ id: banner, lat: 43.66, lng: -79.4, postal: 'M5S1W7' }]),
        fresh,
      );
    }
    raw.prepare('INSERT INTO site_locations (banner, data, fetched_at) VALUES (?, ?, ?)').run('zehrs', LIST([{ id: 'z', lat: 43.64, lng: -79.4, postal: 'M5V3K3' }]), fresh);
    const fetchImpl = vi.fn(async () => {
      throw new Error('no network in tests');
    }) as unknown as typeof fetch;

    const origin = await originPoint(DB, fetchImpl, now, 'M5T 1R5', '');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(origin).toMatchObject({ approx: true });
    expect(origin!.lat).toBeCloseTo((43.66 * 4 + 43.64) / 5, 9);
  });

  it('lists each reference banner once when the cache is empty, then reuses it for a week', async () => {
    const { DB } = newTestDb();
    const now = new Date('2026-11-05T12:00:00Z');
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const id = /bannerIds=([^&]+)/.exec(String(url))?.[1] ?? '';
      return new Response(JSON.stringify({ pickupLocations: [{ storeId: id, name: 'Store', address: { line1: 'x', town: 'y', postalCode: 'M5S1W7' }, geoPoint: { latitude: 43.66, longitude: -79.4 } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    await referenceSamples(DB, fetchImpl, now);
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    await referenceSamples(DB, fetchImpl, new Date('2026-11-06T12:00:00Z'));
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    const samples = await referenceSamples(DB, fetchImpl, new Date('2026-11-13T13:00:00Z'));
    expect(fetchImpl).toHaveBeenCalledTimes(8);
    expect(samples.length).toBeGreaterThan(0);
  });

  it('treats a list cached before coordinates were kept (a bare array) as stale', async () => {
    const { raw, DB } = newTestDb();
    const now = new Date('2026-11-05T12:00:00Z');
    raw.prepare('INSERT INTO site_locations (banner, data, fetched_at) VALUES (?, ?, ?)').run(
      'nofrills',
      JSON.stringify([{ storeId: '1', name: 'No Frills', postalCode: 'M5S1W7' }]),
      now.toISOString(),
    );
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ pickupLocations: [] }), { status: 200 })) as unknown as typeof fetch;
    const samples = await referenceSamples(DB, fetchImpl, now);
    expect(fetchImpl).toHaveBeenCalled();
    expect(samples).toEqual([]);
  });

  it('does not place a postal code that is not one, and asks the site for nothing', async () => {
    const { DB } = newTestDb();
    const fetchImpl = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    expect(await originPoint(DB, fetchImpl, new Date(), 'Bloor St', 'junk')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
