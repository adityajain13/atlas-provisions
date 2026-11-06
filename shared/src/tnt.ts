// T&T's storefront search response, normalised into one product shape. Pure: no network, no storage. The worker no
// longer fetches T&T (its site blocks automated lookups), but a browser sync that imports T&T prices uses this same shape.

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
