// Regular prices from T&T Supermarket's storefront product search (a GraphQL query on its own web site). T&T's prices
// are the same at every store, so one search serves the whole chain; the household's province stands in for the store
// (the site prices a delivery region). The endpoint and its headers are the site's own web traffic: unofficial, and
// they may change. The site sits behind bot protection: a block is reported as a typed error and nothing is retried
// around it. Nothing is thrown, and nothing here reaches the network by itself: callers pass fetch in.
import type { SiteError, SiteResult } from './pcexpress';

export const TNT_GRAPHQL_URL = 'https://www.tntsupermarket.com/graphql';
export const TNT_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 35;
/** A normal desktop browser's user agent, as the site's own pages send. */
export const TNT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** The product search the storefront sends, trimmed to the fields the app reads. */
export const TNT_QUERY =
  'query ProductSearch($currentPage:Int=1 $inputText:String! $pageSize:Int=6 $filters:ProductAttributeFilterInput! $sort:ProductAttributeSortInput){products(currentPage:$currentPage pageSize:$pageSize search:$inputText filter:$filters sort:$sort){items{id sku name stock_status url_key price{regularPrice{amount{currency value}}} price_range{minimum_price{final_price{currency value}}} was_price uom_type weight_uom} total_count}}';

export const TNT_BLOCKED_MESSAGE = "T&T's site blocked the price lookup.";

/** The province the site prices a delivery in, from the first letter of a postal code. Ontario when there is none. */
export type TntRegion = 'ON' | 'BC' | 'AB' | 'QC';

export function tntRegionOf(postalCode: string | undefined): TntRegion {
  const first = (postalCode ?? '').trim().toUpperCase().charAt(0);
  if (first === 'V') return 'BC';
  if (first === 'T') return 'AB';
  if (first === 'G' || first === 'H' || first === 'J') return 'QC';
  return 'ON';
}

/** The first three characters of a Canadian postal code (the forward sortation area), or undefined when it is not one. */
export function fsaOf(postalCode: string | undefined): string | undefined {
  const s = (postalCode ?? '').replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z]\d[A-Z]/.test(s) ? s.slice(0, 3) : undefined;
}

/** The store id T&T's rows are keyed by: one per province the site prices. */
export function tntStoreId(postalCode: string | undefined): string {
  return `tnt-${tntRegionOf(postalCode)}`;
}

export interface TntOptions {
  region: TntRegion;
  /** The forward sortation area, e.g. "L5L". Omitted when the household has no postal code. */
  postcode?: string;
}

/** One product of a search, normalised. Prices are dollars for the pack, or per weight unit when perWeight is set. */
export interface TntProduct {
  sku: string;
  name: string;
  /** The price now (the sale price when one is on). */
  price: number;
  /** The regular price. Equals price when nothing is on sale. */
  regularPrice: number;
  wasPrice?: number;
  onSale: boolean;
  /** Set when the product is priced by weight: the price is per pound or per kilogram. */
  perWeight?: 'lb' | 'kg';
  inStock: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
/** A number, or an object with a numeric `value` (the storefront uses both shapes). */
const valueOf = (v: unknown): number | undefined => (isObject(v) ? num(v.value) : num(v));
const scalarText = (v: unknown): string | undefined => (typeof v === 'number' && Number.isFinite(v) ? String(v) : str(v));
const err = (kind: SiteError['kind'], message: string, sample?: string): { ok: false; error: SiteError } => ({
  ok: false,
  error: sample === undefined ? { kind, message } : { kind, message, sample },
});

/** The request headers the storefront's own search sends. No cookie is sent: a session id is never kept here. */
export function tntHeaders(term: string, opts: TntOptions): Record<string, string> {
  const headers: Record<string, string> = {
    store: 'default',
    'x-current-region': opts.region,
    'x-current-shipping-method': 'delivery',
    'content-currency': 'CAD',
    'content-type': 'application/json',
    Accept: '*/*',
    'Accept-Language': 'en-CA',
    'User-Agent': TNT_USER_AGENT,
    Referer: `https://www.tntsupermarket.com/eng/search.html?query=${encodeURIComponent(term)}`,
  };
  if (opts.postcode) headers['x-postcode'] = opts.postcode;
  return headers;
}

/** The GET URL of a product search for a term: the query, the operation name and the variables, URL-encoded. */
export function tntSearchUrl(term: string): string {
  const variables = JSON.stringify({ currentPage: 1, pageSize: PAGE_SIZE, filters: {}, inputText: term, sort: { relevance: 'DESC' } });
  return `${TNT_GRAPHQL_URL}?query=${encodeURIComponent(TNT_QUERY)}&operationName=ProductSearch&variables=${encodeURIComponent(variables)}`;
}

/** The unit a product is priced by weight in, or undefined when it is priced as a pack. Read from the storefront's own fields. */
function perWeightOf(raw: Record<string, unknown>): 'lb' | 'kg' | undefined {
  const uom = str(raw.uom_type)?.toLowerCase() ?? '';
  if (!uom.includes('weight')) return undefined;
  const unit = str(raw.weight_uom)?.toLowerCase() ?? '';
  if (/kg|kilo/.test(unit)) return 'kg';
  if (/lb|pound/.test(unit)) return 'lb';
  return undefined;
}

/** One search item as a TntProduct, or null when it has no name or no price. */
export function normaliseTntItem(raw: unknown): TntProduct | null {
  if (!isObject(raw)) return null;
  const name = str(raw.name);
  if (!name) return null;
  const price = isObject(raw.price) ? raw.price : {};
  const range = isObject(raw.price_range) ? raw.price_range : {};
  const minimum = isObject(range.minimum_price) ? range.minimum_price : {};
  const regularListed = valueOf(isObject(price.regularPrice) ? price.regularPrice.amount : undefined);
  const finalPrice = valueOf(minimum.final_price) ?? regularListed;
  if (finalPrice === undefined || finalPrice <= 0) return null;

  const wasRaw = valueOf(raw.was_price);
  const wasPrice = wasRaw !== undefined && wasRaw > 0 ? wasRaw : undefined;
  // The regular price is the highest of the listed regular price and the was price, and never below the price now.
  const regularPrice = Math.max(regularListed ?? finalPrice, wasPrice ?? 0, finalPrice);
  const stock = raw.stock_status;
  const perWeight = perWeightOf(raw);

  return {
    sku: scalarText(raw.sku ?? raw.id) ?? '',
    name,
    price: finalPrice,
    regularPrice,
    ...(wasPrice !== undefined ? { wasPrice } : {}),
    onSale: regularPrice > finalPrice,
    ...(perWeight ? { perWeight } : {}),
    inStock: typeof stock !== 'string' || !/out/i.test(stock),
  };
}

/**
 * Searches T&T for a term. Results come back in the storefront's order. A 403, a 429, or a body that is not JSON (a
 * bot-check page) is 'blocked'; a body with GraphQL errors or without a product list is 'shape'.
 */
export async function searchTnt(term: string, opts: TntOptions, fetchImpl: typeof fetch = fetch): Promise<SiteResult<TntProduct[]>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TNT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(tntSearchUrl(term), {
      method: 'GET',
      headers: tntHeaders(term, opts),
      signal: controller.signal,
    });
    const text = await res.text();
    if (res.status === 403) return { ok: false, error: { kind: 'blocked', message: TNT_BLOCKED_MESSAGE, status: 403, sample: text.trimStart().slice(0, 300) } };
    if (res.status === 429) return { ok: false, error: { kind: 'blocked', message: TNT_BLOCKED_MESSAGE, status: 429 } };
    if (!res.ok) return { ok: false, error: { kind: 'network', message: `HTTP ${res.status}`, status: res.status } };

    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      return err('blocked', TNT_BLOCKED_MESSAGE, text.trimStart().slice(0, 300));
    }
    const data = isObject(json) && isObject(json.data) ? json.data : null;
    const products = data && isObject(data.products) ? data.products : null;
    const items = products && Array.isArray(products.items) ? products.items : null;
    if (items === null) {
      const message = isObject(json) && Array.isArray(json.errors) ? 'The storefront returned an error for this search' : 'No product list in the response';
      return err('shape', message, JSON.stringify(json).slice(0, 300));
    }
    const normalised = items.map(normaliseTntItem).filter((p): p is TntProduct => p !== null);
    if (items.length > 0 && normalised.length === 0) {
      return err('shape', 'No result in the response had a name and a price', JSON.stringify(items[0]).slice(0, 300));
    }
    return { ok: true, value: normalised };
  } catch (e) {
    return err('network', e instanceof Error ? e.message : 'The request failed');
  } finally {
    clearTimeout(timer);
  }
}
