import { INGREDIENT_BY_ID, CATEGORY_ORDER, type Ingredient } from './catalog';
import type { MatchedItem } from './match';

export interface Deal {
  ingredientId: string;
  store: string;
  pricePerUnit: number;
  packQty: number;
  packPrice: number;
  discountPct: number;
  baseline: number;
  validTo: string;
  score: number;
  staple?: boolean;
}

export interface HistoryPoint {
  ingredientId: string;
  store: string;
  date: string; // YYYY-MM-DD
  pricePerUnit: number;
}

export interface ScoreOptions {
  history: HistoryPoint[];
  neverBuy: string[]; // ingredient ids
  alwaysBuy: string[]; // ingredient ids
  allergens: string[]; // household-wide union
  shoppingDate: string; // YYYY-MM-DD
  householdSize: number;
  perCategory?: number; // default 8
}

const BASELINE_WINDOW_DAYS = 56;
const MIN_HISTORY_POINTS = 3;
const LONE_STORE_MARKUP = 1.15;
const NUTRIENT_CAP = 15;
// Deal score weights: the discount leads. Nutrient density and the shelf-life bonus are small, so no single cheap
// item (a whole green cabbage, 21 days on the shelf) dominates the shortlist.
export const SCORE_DISCOUNT_WEIGHT = 0.6;
export const SCORE_NUTRIENT_WEIGHT = 0.15;
export const SCORE_SHELF_WEIGHT = 0.05;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Typical price per base unit for an ingredient.
 *
 * - With at least 3 history points in the 56 days up to `asOf`, the baseline is their median.
 * - Otherwise it is a fallback based on the current flyer prices:
 *   - one store only: that store's price x 1.15, so a lone price counts as about 13% off;
 *   - several stores: the highest current price x 1.0.
 * - Returns 0 when there is no data at all. Callers treat a 0 baseline as no discount.
 */
export function baselineFor(
  ingredientId: string,
  history: HistoryPoint[],
  current: MatchedItem[],
  asOf: string = new Date().toISOString().slice(0, 10),
): number {
  const cutoff = addDays(asOf, -BASELINE_WINDOW_DAYS);
  const recent = history
    .filter((h) => h.ingredientId === ingredientId && h.date >= cutoff && h.date <= asOf)
    .map((h) => h.pricePerUnit);
  if (recent.length >= MIN_HISTORY_POINTS) return median(recent);

  const now = current.filter((c) => c.ingredientId === ingredientId);
  if (now.length === 0) return 0;
  const stores = new Set(now.map((c) => c.store));
  const prices = now.map((c) => c.pricePerUnit);
  if (stores.size === 1) return Math.max(...prices) * LONE_STORE_MARKUP;
  return Math.max(...prices);
}

/**
 * Protein plus fibre (g) per dollar per 100 g, scaled to 0..1 by dividing by NUTRIENT_CAP and clamping.
 * Price per 100 g comes from the unit price: kg and l divide by 10, each items use eachWeightKg.
 */
export function nutrientDensity(ing: Ingredient, pricePerUnit: number): number {
  let pricePer100g: number;
  if (ing.baseUnit === 'each') {
    if (!ing.eachWeightKg || ing.eachWeightKg <= 0) return 0;
    pricePer100g = pricePerUnit / (ing.eachWeightKg * 10);
  } else {
    pricePer100g = pricePerUnit / 10;
  }
  if (!Number.isFinite(pricePer100g) || pricePer100g <= 0) return 0;
  const { protein, fibre } = ing.nutritionPer100g;
  const raw = (protein + fibre) / pricePer100g;
  return Math.min(1, Math.max(0, raw / NUTRIENT_CAP));
}

/**
 * Rank flyer items as deals.
 *
 * Steps: keep the cheapest unit price per (ingredient, store), drop never-buy ingredients,
 * allergen clashes and expired items, then drop packs too big to use. The size rule is a rough
 * heuristic: packQty (kg, l or count) must be at most shelfLifeDays / 7 * 1.5 * householdSize.
 * Score = discount * 0.6 + nutrientDensity * 0.15 + 0.05 if shelf life exceeds a week. The nutrient and shelf-life
 * weights are small, so a big cheap pack (a whole cabbage) cannot outscore a real discount on something else.
 * Keep the top `perCategory` per category. Always-buy ingredients are added once each,
 * flagged staple, from their cheapest store, even when not on sale.
 */
export function scoreDeals(items: MatchedItem[], opts: ScoreOptions): Deal[] {
  const perCategory = opts.perCategory ?? 8;
  const neverBuy = new Set(opts.neverBuy);
  const alwaysBuy = new Set(opts.alwaysBuy);
  const allergenSet = new Set(opts.allergens);

  // Cheapest unit price per (ingredient, store).
  const cheapest = new Map<string, MatchedItem>();
  for (const it of items) {
    if (!Number.isFinite(it.pricePerUnit) || it.pricePerUnit <= 0) continue;
    const key = `${it.ingredientId}|${it.store}`;
    const prev = cheapest.get(key);
    if (!prev || it.pricePerUnit < prev.pricePerUnit) cheapest.set(key, it);
  }

  const baselineCache = new Map<string, number>();
  const baselineOf = (id: string) => {
    let b = baselineCache.get(id);
    if (b === undefined) {
      b = baselineFor(id, opts.history, items, opts.shoppingDate);
      baselineCache.set(id, b);
    }
    return b;
  };

  const candidates: Deal[] = [];
  for (const it of cheapest.values()) {
    const ing = INGREDIENT_BY_ID[it.ingredientId];
    if (!ing) continue;
    if (neverBuy.has(ing.id)) continue;
    if (ing.allergens.some((a) => allergenSet.has(a))) continue;
    if (it.validTo < opts.shoppingDate) continue;

    const maxPack = (ing.shelfLifeDays / 7) * 1.5 * opts.householdSize;
    if (it.packQty > maxPack) continue;

    const baseline = baselineOf(ing.id);
    const discountPct = baseline > 0 ? Math.max(0, 1 - it.pricePerUnit / baseline) : 0;
    const score =
      discountPct * SCORE_DISCOUNT_WEIGHT +
      nutrientDensity(ing, it.pricePerUnit) * SCORE_NUTRIENT_WEIGHT +
      (ing.shelfLifeDays > 7 ? SCORE_SHELF_WEIGHT : 0);

    candidates.push({
      ingredientId: ing.id,
      store: it.store,
      pricePerUnit: it.pricePerUnit,
      packQty: it.packQty,
      packPrice: it.packPrice,
      discountPct,
      baseline,
      validTo: it.validTo,
      score,
    });
  }

  const byScore = (a: Deal, b: Deal) => b.score - a.score || a.ingredientId.localeCompare(b.ingredientId);
  const out: Deal[] = [];

  // Always-buy staples: cheapest store, flagged staple, outside the category cap.
  const stapleIds = new Set<string>();
  for (const id of alwaysBuy) {
    const options = candidates.filter((d) => d.ingredientId === id);
    if (options.length === 0) continue;
    const best = options.reduce((a, b) => (b.pricePerUnit < a.pricePerUnit ? b : a));
    out.push({ ...best, staple: true });
    stapleIds.add(id);
  }

  // Everything else: top N per category.
  for (const cat of CATEGORY_ORDER) {
    const inCat = candidates
      .filter((d) => !stapleIds.has(d.ingredientId) && INGREDIENT_BY_ID[d.ingredientId]?.category === cat)
      .sort(byScore);
    out.push(...inCat.slice(0, perCategory));
  }

  return out.sort(byScore);
}
