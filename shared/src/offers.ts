import { INGREDIENTS, type Ingredient } from './catalog';
import type { Deal } from './scoring';
import type { MatchedItem } from './match';

/**
 * What an estimate is based on: a regular shelf price the store's own site shows for the location the household picked
 * (site), a price the household paid at the store (receipt), or the catalogue's approximate typical price (typical),
 * which has no store of its own and is taken at the household's top-ranked store.
 */
export type EstimateBasis = 'receipt' | 'site' | 'typical';

/** The order estimates are used in when a store has no flyer price: site, then receipt, then typical. */
export const ESTIMATE_PRIORITY: readonly EstimateBasis[] = ['site', 'receipt', 'typical'];

/** The cheapest price one store offers for one ingredient. */
export interface Offer {
  ingredientId: string;
  store: string;
  pricePerUnit: number;
  packQty: number; // base units
  packPrice: number;
  // Set on an estimate: not a flyer price, but a site, receipt or typical price (see EstimateBasis). Typical prices have no date.
  estimate?: { basis: EstimateBasis; date?: string };
}

/** A price the household paid at a store for an ingredient, from a confirmed receipt. */
export interface ReceiptPrice {
  ingredientId: string;
  store: string;
  date: string; // YYYY-MM-DD
  pricePerUnit: number; // per base unit
  packQty?: number; // base units the line bought; absent on older rows, which price one base unit
}

/**
 * The most recent receipt price per (ingredient, store), as an estimate offer. Each estimate is one pack of the size
 * the household bought, or one base unit when the size is not known. Rows outside [from, to] are ignored.
 */
export function estimateOffers(prices: ReceiptPrice[], from: string, to: string): Offer[] {
  const latest = new Map<string, ReceiptPrice>();
  for (const p of prices) {
    if (p.date < from || p.date > to) continue;
    if (!Number.isFinite(p.pricePerUnit) || p.pricePerUnit <= 0) continue;
    const key = `${p.ingredientId}|${p.store}`;
    const prev = latest.get(key);
    if (!prev || p.date > prev.date) latest.set(key, p);
  }
  return [...latest.values()].map((p) => {
    const packQty = p.packQty !== undefined && Number.isFinite(p.packQty) && p.packQty > 0 ? p.packQty : 1;
    return {
      ingredientId: p.ingredientId,
      store: p.store,
      pricePerUnit: p.pricePerUnit,
      packQty,
      packPrice: p.pricePerUnit * packQty,
      estimate: { basis: 'receipt' as const, date: p.date },
    };
  });
}

/** One site price row: the regular shelf price a store location showed on a day. */
export interface SitePrice {
  ingredientId: string;
  store: string;
  date: string; // YYYY-MM-DD, the day it was read
  pricePerUnit: number; // per base unit, as shelf-priced that day
  onSale: boolean;
  regularPricePerUnit?: number; // per base unit, the regular (was) price when the site showed one
  packQty?: number; // base units in the pack that was priced
}

/**
 * The most recent site price per (ingredient, store), as an estimate offer, for rows inside [from, to]. The price is the
 * regular price when the site showed one, so a sale is not taken as the store's usual price. A row on sale with no
 * regular price is left out: its price is a sale price, and a flyer covers sales.
 */
export function siteOffers(prices: SitePrice[], from: string, to: string): Offer[] {
  const latest = new Map<string, SitePrice>();
  for (const p of prices) {
    if (p.date < from || p.date > to) continue;
    const price = p.regularPricePerUnit ?? (p.onSale ? undefined : p.pricePerUnit);
    if (price === undefined || !Number.isFinite(price) || price <= 0) continue;
    const key = `${p.ingredientId}|${p.store}`;
    const prev = latest.get(key);
    if (!prev || p.date > prev.date) latest.set(key, p);
  }
  return [...latest.values()].map((p) => {
    const pricePerUnit = (p.regularPricePerUnit ?? p.pricePerUnit) as number;
    const packQty = p.packQty !== undefined && Number.isFinite(p.packQty) && p.packQty > 0 ? p.packQty : 1;
    return {
      ingredientId: p.ingredientId,
      store: p.store,
      pricePerUnit,
      packQty,
      packPrice: pricePerUnit * packQty,
      estimate: { basis: 'site' as const, date: p.date },
    };
  });
}

/**
 * One offer per (ingredient, store), keeping the lowest unit price, from deals and matched flyer
 * items. Only stores accepted by `storeOk` are kept. Offers within an ingredient are sorted by
 * unit price, then store name.
 *
 * `estimates` fill only the (ingredient, store) pairs no flyer offer covers. A flyer price always wins over an
 * estimate, even a dearer one. Among estimates, the first one for a pair wins, so callers list the site prices
 * (siteOffers) before the receipt prices (estimateOffers): a site price is used over a receipt price for the same pair.
 */
export function collectOffers(
  deals: Deal[],
  matched: MatchedItem[],
  storeOk: (store: string) => boolean,
  estimates: Offer[] = [],
): Map<string, Offer[]> {
  const best = new Map<string, Offer>();
  const consider = (o: Offer) => {
    if (!storeOk(o.store)) return;
    if (!Number.isFinite(o.pricePerUnit) || o.pricePerUnit <= 0) return;
    if (!Number.isFinite(o.packQty) || o.packQty <= 0) return;
    const key = `${o.ingredientId}|${o.store}`;
    const prev = best.get(key);
    if (!prev || o.pricePerUnit < prev.pricePerUnit) best.set(key, o);
  };
  for (const d of deals) consider({ ingredientId: d.ingredientId, store: d.store, pricePerUnit: d.pricePerUnit, packQty: d.packQty, packPrice: d.packPrice });
  for (const m of matched) consider({ ingredientId: m.ingredientId, store: m.store, pricePerUnit: m.pricePerUnit, packQty: m.packQty, packPrice: m.packPrice });
  const flyerKeys = new Set(best.keys());
  const estimateKeys = new Set<string>();
  for (const e of estimates) {
    const key = `${e.ingredientId}|${e.store}`;
    if (flyerKeys.has(key) || estimateKeys.has(key)) continue;
    consider(e);
    // A usable estimate claims the pair, so a later (lower-priority) estimate for it is skipped.
    if (best.has(key)) estimateKeys.add(key);
  }

  const out = new Map<string, Offer[]>();
  for (const o of best.values()) {
    const list = out.get(o.ingredientId) ?? [];
    list.push(o);
    out.set(o.ingredientId, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.pricePerUnit - b.pricePerUnit || a.store.localeCompare(b.store));
  }
  return out;
}

/** The typical price of one catalogue ingredient as an offer at `store`, or undefined when it has no typical price. */
export function typicalOffer(ing: Ingredient, store: string): Offer | undefined {
  const t = ing.typicalPrice;
  if (!t) return undefined;
  // Per kilogram or litre, a 0.1 step; per item, one item; per pack, the pack the price is for.
  const packQty = t.per === 'pack' ? (t.packQty ?? 1) : t.per === 'each' ? 1 : 0.1;
  const packPrice = t.per === 'pack' ? t.price : t.price * packQty;
  return {
    ingredientId: ing.id,
    store,
    pricePerUnit: packPrice / packQty,
    packQty,
    packPrice,
    estimate: { basis: 'typical' },
  };
}

/** A typical-price offer for every catalogue ingredient that has one, all at `store`. None when there is no store. */
export function typicalOffers(store: string | undefined): Offer[] {
  if (!store) return [];
  return INGREDIENTS.flatMap((ing) => {
    const o = typicalOffer(ing, store);
    return o ? [o] : [];
  });
}

/**
 * The estimate an ingredient is priced from when no flyer prices it: the first basis in ESTIMATE_PRIORITY that any
 * estimate for it has. Undefined when none does.
 */
export function estimateBasisFor(ingredientId: string, estimates: Offer[]): EstimateBasis | undefined {
  for (const basis of ESTIMATE_PRIORITY) {
    if (estimates.some((e) => e.ingredientId === ingredientId && e.estimate?.basis === basis)) return basis;
  }
  return undefined;
}

/** The cheapest offer in a list, or undefined. */
export function cheapest(offers: Offer[]): Offer | undefined {
  return offers.reduce<Offer | undefined>((best, o) => (best === undefined || o.pricePerUnit < best.pricePerUnit ? o : best), undefined);
}

/** Packs needed to cover a quantity (base units). */
export function packsFor(qty: number, packQty: number): number {
  if (qty <= 0) return 0;
  return Math.max(1, Math.ceil(qty / packQty - 1e-9));
}
