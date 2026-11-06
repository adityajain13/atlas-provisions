// Finding store locations by address: a text match, or the nearest locations to a postal code. The distances come
// from the coordinates the site gives, and a postal code with none of its own is placed by the locations that share
// its prefix (shared/src/geo.ts). The ranking is pure; the reads of the cached lists are at the bottom.
import {
  estimatePostalPoint,
  haversineKm,
  looksLikePostal,
  roundKm,
  type PostalEstimate,
  type PostalSample,
  type SiteBanner,
} from '@provisions/shared';
import { locationLabel, searchLocations, type SiteLocation } from './pcexpress';
import { cachedLocations, readCachedLocations } from './sitePrices';

type Db = D1Database;

/** The nearest locations a postal-code or empty search lists. */
export const NEAREST_LIMIT = 8;
/** The most locations a text search lists. */
const TEXT_LIMIT = 25;
/** The banners whose lists place a postal code that has no coordinates of its own. */
export const REFERENCE_BANNERS: SiteBanner[] = ['superstore', 'nofrills', 'loblaws', 'independent'];

/** A location and the banner it is on. */
export interface Candidate {
  banner: SiteBanner;
  loc: SiteLocation;
}

/** One result: the chain, the store id to add it by, its label, and its distance when it is known. */
export interface Hit {
  banner: SiteBanner;
  storeId: string;
  label: string;
  postalCode: string | null;
  distanceKm?: number;
}

type Placed = SiteLocation & { lat: number; lng: number };

const placed = (loc: SiteLocation): loc is Placed => loc.lat !== undefined && loc.lng !== undefined;

/** Nearest first, with the locations that have no distance last in their own order. */
function byDistance(a: { km?: number }, b: { km?: number }): number {
  if (a.km === undefined) return b.km === undefined ? 0 : 1;
  if (b.km === undefined) return -1;
  return a.km - b.km;
}

/**
 * The results for a search. With an origin and a postal-code search (or an empty one), the nearest locations to the
 * origin, whatever their names say. Otherwise the locations that match the text, with their distances from the origin
 * when there is one, nearest first. Empty text with no origin finds nothing.
 */
export function rankStores(candidates: Candidate[], q: string, origin: PostalEstimate | null): Hit[] {
  const query = q.trim();
  if (origin !== null && (query === '' || looksLikePostal(query))) {
    const measured = candidates
      .filter((c): c is Candidate & { loc: Placed } => placed(c.loc))
      .map((c) => ({ c, km: haversineKm(origin, c.loc) }))
      .sort(byDistance);
    return measured.slice(0, NEAREST_LIMIT).map(({ c, km }) => ({
      banner: c.banner,
      storeId: c.loc.storeId,
      label: locationLabel(c.banner, c.loc),
      postalCode: c.loc.postalCode ?? null,
      distanceKm: roundKm(km),
    }));
  }

  const byBanner = new Map<SiteBanner, SiteLocation[]>();
  for (const c of candidates) byBanner.set(c.banner, [...(byBanner.get(c.banner) ?? []), c.loc]);
  const matched: { hit: Hit; km?: number }[] = [];
  for (const [banner, locs] of byBanner) {
    const byId = new Map(locs.map((loc) => [loc.storeId, loc]));
    for (const m of searchLocations(locs, banner, query)) {
      const loc = byId.get(m.storeId);
      const km = origin !== null && loc && placed(loc) ? haversineKm(origin, loc) : undefined;
      matched.push({
        hit: { banner, storeId: m.storeId, label: m.label, postalCode: m.postalCode, ...(km !== undefined ? { distanceKm: roundKm(km) } : {}) },
        km,
      });
    }
  }
  if (origin !== null) matched.sort(byDistance);
  return matched.slice(0, TEXT_LIMIT).map((m) => m.hit);
}

/**
 * The coordinates of every location in the cached lists, for placing a postal code that has none of its own. The
 * reference banners are listed first when their lists are missing or a week old, so a search has the points it needs.
 */
export async function referenceSamples(db: Db, fetchImpl: typeof fetch, now: Date): Promise<PostalSample[]> {
  for (const banner of REFERENCE_BANNERS) await cachedLocations(db, banner, fetchImpl, now);
  const rows = await db.prepare('SELECT data FROM site_locations').all<{ data: string }>();
  const samples: PostalSample[] = [];
  for (const row of rows.results) {
    for (const loc of readCachedLocations(row.data) ?? []) {
      if (placed(loc) && loc.postalCode) samples.push({ postalCode: loc.postalCode, lat: loc.lat, lng: loc.lng });
    }
  }
  return samples;
}

/**
 * The point a search measures from: the typed postal code when the search is one, else the household's postal code.
 * Null when neither is a postal code, or the known locations cannot place it.
 */
export async function originPoint(db: Db, fetchImpl: typeof fetch, now: Date, q: string, near: string): Promise<PostalEstimate | null> {
  const query = q.trim();
  const target = looksLikePostal(query) ? query : near.trim();
  if (!looksLikePostal(target)) return null;
  return estimatePostalPoint(target, await referenceSamples(db, fetchImpl, now));
}
