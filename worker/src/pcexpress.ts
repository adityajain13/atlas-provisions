// Regular shelf prices from the Loblaw-family sites (Loblaws, No Frills, Real Canadian Superstore, ...). The endpoints
// and the API key are the sites' own web traffic: unofficial, and they may change. Every field of a response is
// optional, nothing is thrown, and a failed request comes back as a typed error. Callers pass fetch in; nothing here
// reaches the network by itself.
import { isSiteBanner, SITE_BANNER_NAMES } from '@provisions/shared';

export const PCX_BASE_URL = 'https://api.pcexpress.ca/pcx-bff/api/v1';
/** The static key the public web site sends. It is not a secret and it is not ours to rotate. */
export const PCX_API_KEY = 'C1xujSegT5j3ap3yexJjqhOfELwGKYvz';
export const PCX_TIMEOUT_MS = 10_000;

export type SiteErrorKind = 'auth' | 'not-found' | 'blocked' | 'network' | 'shape';

export interface SiteError {
  kind: SiteErrorKind;
  message: string;
  status?: number;
  /** The start of an unexpected body, for the debug sample. Never sent to a browser except through ?debug=1. */
  sample?: string;
}

export type SiteResult<T> = { ok: true; value: T } | { ok: false; error: SiteError };

/** A pickup location, as the picker shows it. lat and lng are set when the site gives coordinates. */
export interface SiteLocation {
  storeId: string;
  name: string;
  line1?: string;
  city?: string;
  postalCode?: string;
  lat?: number;
  lng?: number;
}

/** One search result, normalised. Prices are dollars for the whole pack as sold. */
export interface SiteProduct {
  code: string;
  name: string;
  brand?: string;
  packageSize?: string;
  price: number;
  wasPrice?: number;
  onSale: boolean;
  unitPrice?: { value: number; unit: string };
}

/** The headers the public site sends. There is no Authorization header: a PC id would be needed for it. */
export function siteHeaders(banner: string): Record<string, string> {
  return {
    'x-apikey': PCX_API_KEY,
    'Business-User-Agent': 'PCXWEB',
    'Site-Banner': banner,
    baseSiteId: banner,
    'x-application-type': 'Web',
    'x-loblaw-tenant-id': 'ONLINE_GROCERIES',
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Accept-Language': 'en',
  };
}

/** A non-empty trimmed string, or undefined. */
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

/** A finite number, or a numeric string, or undefined. */
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

const err = (kind: SiteErrorKind, message: string, extra: { status?: number; sample?: string } = {}): { ok: false; error: SiteError } => ({
  ok: false,
  error: { kind, message, ...extra },
});

const sampleOf = (value: unknown): string => {
  try {
    return JSON.stringify(value).slice(0, 300);
  } catch {
    return '';
  }
};

/** One request with the timeout. The status decides the error kind; a body that is not JSON is a challenge page or a shape change. */
async function getJson(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<SiteResult<unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PCX_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      return err('auth', `HTTP ${res.status}: the site needs a PC id sign-in for this search`, { status: res.status });
    }
    if (res.status === 404) return err('not-found', 'HTTP 404', { status: 404 });
    if (res.status === 429) return err('blocked', 'HTTP 429: the site is limiting requests', { status: 429 });
    if (!res.ok) return err('network', `HTTP ${res.status}`, { status: res.status });
    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch {
      const head = text.trimStart().slice(0, 300);
      if (head.startsWith('<')) return err('blocked', 'The site returned a web page, not data (a bot check?)', { sample: head });
      return err('shape', 'The response was not JSON', { sample: head });
    }
  } catch (e) {
    return err('network', e instanceof Error ? e.message : 'The request failed');
  } finally {
    clearTimeout(timer);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A value that is a number, or an object with a numeric `value` (the site uses both shapes). */
export function valueOf(v: unknown): number | undefined {
  if (isObject(v)) return num(v.value);
  return num(v);
}

const scalarText = (v: unknown): string | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return str(v);
};

/** The array of records in a response: the body itself, or the first of the known keys that holds one. */
function listIn(json: unknown, keys: string[]): unknown[] | null {
  if (Array.isArray(json)) return json;
  if (!isObject(json)) return null;
  for (const k of keys) {
    const v = json[k];
    if (Array.isArray(v)) return v;
  }
  return null;
}

/**
 * The coordinates of a location record, when the site gives them in one of the shapes it uses (a geo point, a location,
 * or plain fields on the record or its address). Null when there are none or they are out of range.
 */
export function coordsOf(raw: Record<string, unknown>): { lat: number; lng: number } | null {
  const address = isObject(raw.address) ? raw.address : {};
  const shapes = [raw.geoPoint, raw.location, raw.coordinates, raw.geo, address.geoPoint, address.location, raw];
  for (const shape of shapes) {
    if (!isObject(shape)) continue;
    const lat = num(shape.latitude ?? shape.lat);
    const lng = num(shape.longitude ?? shape.lng ?? shape.lon);
    if (lat === undefined || lng === undefined) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) continue;
    return { lat, lng };
  }
  return null;
}

/** A pickup location from one record of the list, or null when it has no store id. */
export function normaliseLocation(raw: unknown): SiteLocation | null {
  if (!isObject(raw)) return null;
  const storeId = scalarText(raw.storeId ?? raw.store_id ?? raw.id);
  if (!storeId) return null;
  const address = isObject(raw.address) ? raw.address : {};
  const coords = coordsOf(raw);
  return {
    storeId,
    name: str(raw.name) ?? str(raw.storeName) ?? 'Store',
    line1: str(address.line1) ?? str(address.addressLine1) ?? str(address.street),
    city: str(address.town) ?? str(address.city),
    postalCode: (str(address.postalCode) ?? str(address.postal_code) ?? str(raw.postalCode))?.toUpperCase().replace(/\s+/g, ''),
    ...(coords ?? {}),
  };
}

/**
 * The banner id Loblaw's systems use for each app banner (the app's own ids are in shared/src/stores.ts). Loblaws is
 * 'loblaw' there, not 'loblaws'. A banner not listed here is sent under its own id.
 */
export const PCX_BANNER_IDS: Record<string, string> = {
  loblaws: 'loblaw',
  nofrills: 'nofrills',
  superstore: 'superstore',
  zehrs: 'zehrs',
  independent: 'independent',
  tandt: 'tandt',
  fortinos: 'fortinos',
  valumart: 'valumart',
  independentcitymarket: 'independentcitymarket',
};

/** The ids a product search tries, in order. A refused Loblaws id (400 or 404) is retried once as 'loblaws'. */
const SEARCH_ID_FALLBACKS: Record<string, string[]> = { loblaws: ['loblaw', 'loblaws'] };

/** The id that answered a product search for each app banner, kept for the rest of the run. */
const answeringId = new Map<string, string>();

/** Forgets which id answered each banner. For tests, and for a run that should start again. */
export function resetAnsweringIds(): void {
  answeringId.clear();
}

/** The ids to try for a product search on a banner: the one that answered before first, then the rest. */
export function searchIdsFor(banner: string): string[] {
  const ids = SEARCH_ID_FALLBACKS[banner] ?? [PCX_BANNER_IDS[banner] ?? banner];
  const known = answeringId.get(banner);
  return known ? [known, ...ids.filter((id) => id !== known)] : ids;
}

const LOCATION_KEYS = ['pickupLocations', 'locations', 'results'];
const LOCATION_RESULTS = 25;

/** A pickup location per record of the list, without repeats and without records that have no store id. */
function locationsIn(records: unknown[]): SiteLocation[] {
  const seen = new Set<string>();
  const out: SiteLocation[] = [];
  for (const r of records) {
    const loc = normaliseLocation(r);
    if (!loc || seen.has(loc.storeId)) continue;
    seen.add(loc.storeId);
    out.push(loc);
  }
  return out;
}

/**
 * Lists the pickup locations of a banner. Three requests are tried in order (bannerIds, bannerId, bannerIds with
 * isShoppable), and the first non-empty list wins. A sign-in or a block stops at once. When none has locations, the
 * first failure is returned as the error; a listing that was empty and had no failure is an empty list.
 */
export async function listLocations(banner: string, fetchImpl: typeof fetch = fetch): Promise<SiteResult<SiteLocation[]>> {
  const bannerId = searchIdsFor(banner)[0] ?? banner;
  const id = encodeURIComponent(bannerId);
  const init = { method: 'GET', headers: siteHeaders(bannerId) };
  const paths = [`pickup-locations?bannerIds=${id}`, `pickup-locations?bannerId=${id}`, `pickup-locations?bannerIds=${id}&isShoppable=true`];

  let firstError: SiteResult<SiteLocation[]> | null = null;
  let sawEmpty = false;
  for (const path of paths) {
    const got = await getJson(fetchImpl, `${PCX_BASE_URL}/${path}`, init);
    if (!got.ok) {
      firstError ??= got;
      if (got.error.kind === 'auth' || got.error.kind === 'blocked') return got;
      continue;
    }
    const records = listIn(got.value, LOCATION_KEYS);
    if (records === null) {
      firstError ??= err('shape', 'No list of locations in the response', { sample: sampleOf(got.value) });
      continue;
    }
    if (records.length === 0) {
      sawEmpty = true;
      continue;
    }
    const out = locationsIn(records);
    if (out.length > 0) return { ok: true, value: out };
    firstError ??= err('shape', 'No location in the response had a store id', { sample: sampleOf(records[0]) });
  }
  if (sawEmpty || firstError === null) return { ok: true, value: [] };
  return firstError;
}

/** Normalised text for matching: lower case, no spaces, so "M5T 1R5" and "m5t1r5" are the same. */
const squash = (s: string): string => s.toLowerCase().replace(/\s+/g, '');

/** The label the picker shows for a location: the chain, then its street and city. */
export function locationLabel(banner: string, loc: Pick<SiteLocation, 'line1' | 'city'>): string {
  const bannerName = isSiteBanner(banner) ? SITE_BANNER_NAMES[banner] : banner;
  const address = [loc.line1, loc.city].filter(Boolean).join(', ');
  return address ? `${bannerName} · ${address}` : bannerName;
}

/**
 * The locations a search matches. Every word of the query must appear in the name, street, city or postal code, with
 * spaces ignored on both sides. A query that starts like a postal code lists the locations whose postal code starts
 * with it first. Each result is labelled with the chain and the street and city.
 */
export function searchLocations(
  locations: SiteLocation[],
  banner: string,
  query: string,
): { storeId: string; label: string; postalCode: string | null }[] {
  const words = query.toLowerCase().split(/\s+/).map(squash).filter(Boolean);
  if (words.length === 0) return [];
  const postal = words.join('');
  const postalLike = /^[a-z]\d[a-z]/.test(postal);

  const hits = locations.flatMap((loc) => {
    const fields = [loc.name, loc.line1, loc.city, loc.postalCode].filter((v): v is string => typeof v === 'string' && v !== '').map(squash);
    if (!words.every((w) => fields.some((f) => f.includes(w)))) return [];
    const rank = postalLike && loc.postalCode && squash(loc.postalCode).startsWith(postal) ? 0 : 1;
    return [{ rank, storeId: loc.storeId, label: locationLabel(banner, loc), postalCode: loc.postalCode ?? null }];
  });
  // Array.prototype.sort is stable, so the site's order holds within each rank.
  hits.sort((a, b) => a.rank - b.rank);
  return hits.slice(0, LOCATION_RESULTS).map(({ storeId, label, postalCode }) => ({ storeId, label, postalCode }));
}

/** The unit price the site shows, normalised from its comparison price, or undefined. */
function comparisonOf(raw: Record<string, unknown>): { value: number; unit: string } | undefined {
  const list = Array.isArray(raw.comparisonPrices) ? raw.comparisonPrices : null;
  const first = list?.find(isObject);
  if (!first) return undefined;
  const value = num(first.value);
  const unit = str(first.unit);
  return value !== undefined && unit ? { value, unit } : undefined;
}

/** One search result as a SiteProduct, or null when it has no name or no price. */
export function normaliseProduct(raw: unknown): SiteProduct | null {
  if (!isObject(raw)) return null;
  const name = str(raw.name);
  if (!name) return null;
  const prices = isObject(raw.prices) ? raw.prices : {};

  const wasPrice = valueOf(prices.wasPrice) ?? valueOf(raw.wasPrice);
  // The shelf price. A deal price stands in when no shelf price is shown.
  const price = valueOf(prices.price) ?? valueOf(raw.price) ?? valueOf(raw.dealPrice);
  if (price === undefined || price <= 0) return null;

  const offer = typeof raw.offerType === 'string' ? raw.offerType : '';
  const onSale = (wasPrice !== undefined && wasPrice > price) || /sale|deal|offer|promo/i.test(offer);
  const unitPrice = comparisonOf(raw);

  return {
    code: scalarText(raw.code ?? raw.productId ?? raw.id) ?? '',
    name,
    brand: str(raw.brand),
    packageSize: str(raw.packageSize) ?? str(raw.size),
    price,
    ...(wasPrice !== undefined && wasPrice > 0 ? { wasPrice } : {}),
    onSale,
    ...(unitPrice ? { unitPrice } : {}),
  };
}

/**
 * Searches a store location for a term. Results come back in the site's order. The banner id is tried as searchIdsFor
 * gives it; a 400 or 404 moves on to the next id, and the id that answers is remembered.
 */
export async function searchProducts(banner: string, storeId: string, term: string, fetchImpl: typeof fetch = fetch): Promise<SiteResult<SiteProduct[]>> {
  let first: SiteResult<SiteProduct[]> | null = null;
  for (const id of searchIdsFor(banner)) {
    const got = await searchOnce(fetchImpl, id, storeId, term);
    if (got.ok) {
      answeringId.set(banner, id);
      return got;
    }
    first ??= got;
    const status = got.error.status;
    if (status !== 400 && status !== 404) return got;
  }
  return first!;
}

async function searchOnce(fetchImpl: typeof fetch, banner: string, storeId: string, term: string): Promise<SiteResult<SiteProduct[]>> {
  const body = JSON.stringify({ lang: 'en', term, storeId, banner, pagination: { from: 0, size: 24 } });
  const got = await getJson(fetchImpl, `${PCX_BASE_URL}/products/search`, { method: 'POST', headers: siteHeaders(banner), body });
  if (!got.ok) return got;

  const records = listIn(got.value, ['results', 'products']);
  if (records === null) return err('shape', 'No product list in the response', { sample: sampleOf(got.value) });
  const products = records.map(normaliseProduct).filter((p): p is SiteProduct => p !== null);
  if (records.length > 0 && products.length === 0) {
    return err('shape', 'No result in the response had a name and a price', { sample: sampleOf(records[0]) });
  }
  return { ok: true, value: products };
}
