import type { Deal } from './scoring';
import type { MatchedItem } from './match';

/** The cheapest price one store offers for one ingredient. */
export interface Offer {
  ingredientId: string;
  store: string;
  pricePerUnit: number;
  packQty: number; // base units
  packPrice: number;
}

/**
 * One offer per (ingredient, store), keeping the lowest unit price, from deals and matched flyer
 * items. Only stores accepted by `storeOk` are kept. Offers within an ingredient are sorted by
 * unit price, then store name.
 */
export function collectOffers(
  deals: Deal[],
  matched: MatchedItem[],
  storeOk: (store: string) => boolean,
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
