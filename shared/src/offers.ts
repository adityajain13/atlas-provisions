import type { Deal } from './scoring';
import type { MatchedItem } from './match';

/** The cheapest price one store offers for one ingredient. */
export interface Offer {
  ingredientId: string;
  store: string;
  pricePerUnit: number;
  packQty: number; // base units
  packPrice: number;
  // Set on an estimate: a price the household last paid at this store, not a flyer price.
  estimate?: { basis: 'receipt'; date: string };
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

/**
 * One offer per (ingredient, store), keeping the lowest unit price, from deals and matched flyer
 * items. Only stores accepted by `storeOk` are kept. Offers within an ingredient are sorted by
 * unit price, then store name.
 *
 * `estimates` (receipt prices, see estimateOffers) fill only the (ingredient, store) pairs no flyer
 * offer covers. A flyer price always wins over an estimate, even a dearer one.
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
  for (const e of estimates) {
    const key = `${e.ingredientId}|${e.store}`;
    if (flyerKeys.has(key)) continue;
    consider(e);
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

/** The cheapest offer in a list, or undefined. */
export function cheapest(offers: Offer[]): Offer | undefined {
  return offers.reduce<Offer | undefined>((best, o) => (best === undefined || o.pricePerUnit < best.pricePerUnit ? o : best), undefined);
}

/** Packs needed to cover a quantity (base units). */
export function packsFor(qty: number, packQty: number): number {
  if (qty <= 0) return 0;
  return Math.max(1, Math.ceil(qty / packQty - 1e-9));
}
