// Regular shelf prices from the Loblaw-family sites (Loblaws, No Frills, Real Canadian Superstore, ...). The endpoints
// and the API key are the sites' own web traffic: unofficial, and they may change. Every field of a response is
// optional, nothing is thrown, and a failed request comes back as a typed error. Callers pass fetch in; nothing here
// reaches the network by itself.
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

/** A pickup location, as the picker shows it. */
export interface SiteLocation {
  storeId: string;
  name: string;
  line1?: string;
  city?: string;
  postalCode?: string;
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

/** A pickup location from one record of the list, or null when it has no store id. */
export function normaliseLocation(raw: unknown): SiteLocation | null {
  if (!isObject(raw)) return null;
  const storeId = scalarText(raw.storeId ?? raw.store_id ?? raw.id);
  if (!storeId) return null;
  const address = isObject(raw.address) ? raw.address : {};
  return {
    storeId,
    name: str(raw.name) ?? str(raw.storeName) ?? 'Store',
    line1: str(address.line1) ?? str(address.addressLine1) ?? str(address.street),
    city: str(address.town) ?? str(address.city),
    postalCode: (str(address.postalCode) ?? str(address.postal_code) ?? str(raw.postalCode))?.toUpperCase().replace(/\s+/g, ''),
  };
}

/** Lists the pickup locations of a banner. Tries bannerIds first, then bannerId when the first is not found. */
export async function listLocations(banner: string, fetchImpl: typeof fetch = fetch): Promise<SiteResult<SiteLocation[]>> {
  const init = { method: 'GET', headers: siteHeaders(banner) };
  let got = await getJson(fetchImpl, `${PCX_BASE_URL}/pickup-locations?bannerIds=${encodeURIComponent(banner)}`, init);
  if (!got.ok && got.error.kind === 'not-found') {
    got = await getJson(fetchImpl, `${PCX_BASE_URL}/pickup-locations?bannerId=${encodeURIComponent(banner)}`, init);
  }
  if (!got.ok) return got;

  const records = listIn(got.value, ['pickupLocations', 'locations', 'stores', 'results', 'data']);
  if (records === null) return err('shape', 'No list of locations in the response', { sample: sampleOf(got.value) });
  if (records.length === 0) return { ok: true, value: [] };

  const seen = new Set<string>();
  const out: SiteLocation[] = [];
  for (const r of records) {
    const loc = normaliseLocation(r);
    if (!loc || seen.has(loc.storeId)) continue;
    seen.add(loc.storeId);
    out.push(loc);
  }
  if (out.length === 0) return err('shape', 'No location in the response had a store id', { sample: sampleOf(records[0]) });
  return { ok: true, value: out };
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

/** Searches a store location for a term. Results come back in the site's order. */
export async function searchProducts(banner: string, storeId: string, term: string, fetchImpl: typeof fetch = fetch): Promise<SiteResult<SiteProduct[]>> {
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
