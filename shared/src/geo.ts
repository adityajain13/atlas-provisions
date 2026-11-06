// Distances between Canadian postal codes, without a geocoder. A location's own coordinates place it when the site
// gives them. A postal code with no coordinates of its own is placed at the average of the known locations that share
// its prefix: the first three characters (an FSA), else two, else one. Pure: no network.

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** A known location: its postal code and its coordinates. */
export interface PostalSample extends GeoPoint {
  postalCode: string;
}

/** Where a postal code was placed. `approx` is set when only a two- or one-character prefix matched. */
export interface PostalEstimate extends GeoPoint {
  approx: boolean;
}

const EARTH_RADIUS_KM = 6371;

/** A Canadian postal code or a forward sortation area, with or without the space: "M5T 1R5", "m5t1r5", "M5T". */
const POSTAL_QUERY = /^[A-Za-z]\d[A-Za-z]( ?\d[A-Za-z]\d)?$/;

/** True when the text is a postal code or its first three characters, so it is searched by distance. */
export function looksLikePostal(text: string): boolean {
  return POSTAL_QUERY.test(text.trim());
}

/** The great-circle distance between two points, in kilometres. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A distance to one decimal place of a kilometre. */
export function roundKm(km: number): number {
  return Math.round(km * 10) / 10;
}

const squash = (s: string): string => s.replace(/\s+/g, '').toUpperCase();

/**
 * The point for a postal code, from the known samples: the average of those sharing its three-character prefix, else
 * two characters, else one. Null when no sample shares even the first character.
 */
export function estimatePostalPoint(postal: string, points: PostalSample[]): PostalEstimate | null {
  const code = squash(postal);
  if (code === '') return null;
  const known = points.map((p) => ({ ...p, code: squash(p.postalCode) })).filter((p) => p.code !== '');
  for (const length of [3, 2, 1]) {
    if (code.length < length) continue;
    const prefix = code.slice(0, length);
    const same = known.filter((p) => p.code.startsWith(prefix));
    if (same.length === 0) continue;
    return {
      lat: same.reduce((sum, p) => sum + p.lat, 0) / same.length,
      lng: same.reduce((sum, p) => sum + p.lng, 0) / same.length,
      approx: length < 3,
    };
  }
  return null;
}
