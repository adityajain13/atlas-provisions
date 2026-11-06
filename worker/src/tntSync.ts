// T&T prices from the signed-in browser. The app never searches T&T itself (its site blocks server lookups). Instead the
// browser asks for a plan (which terms to search, in which region), searches them as the shopper's own browser, and
// posts the raw search items back. This module builds the plan, checks and matches the results, and writes the prices
// (price_history, source 'site') and one site_price_runs row (mode 'browser') per sync.
import {
  INGREDIENT_BY_ID,
  LB_KG,
  addDaysIso,
  matchIngredient,
  newId,
  planWeekOf,
  toBaseQty,
  torontoDate,
  tntRegionOf,
  tntStoreIdOf,
  fsaOf,
  normaliseTntItem,
  TNT_QUERY,
  TNT_STORE_NAME,
  type CatalogIngredient,
  type Household,
  type TntProduct,
  type TntRegion,
} from '@provisions/shared';
import { loadHousehold, loadPantry, loadPlan } from './db';
import { lookupOrder, parseSiteSize, searchTermFor, SITE_PRICE_DAYS, type PriceHit } from './sitePrices';
import { touchSyncKey } from './syncKeys';

/** The store preset id of T&T in a household's stores. */
export const TNT_STORE_ID = 'tt-supermarket';
/** Ingredients a plan may ask for in one sync. */
export const TNT_TERMS = 40;
/** Results one sync may post, and raw items per result. */
export const TNT_RESULTS = 40;
export const TNT_ITEMS = 50;
/** The largest results request body the app reads. */
export const TNT_BODY_BYTES = 1_000_000;
const PAGE_SIZE = 24;
const DELAY_MS = 800;
/** An ingredient the browser searched for T&T in the last six days is not searched again. */
const LOOKUP_DAYS = 6;
/** The site_lookups banner T&T lookups are recorded under (the Loblaw-family banners use their own ids). */
const LOOKUP_BANNER = 'tnt';
const CHUNK = 50;

export interface TntPlanTerm {
  ingredientId: string;
  term: string;
}

export interface TntPlan {
  region: TntRegion;
  /** The forward sortation area the storefront prices a delivery at, or null when the household has none. */
  postcode: string | null;
  query: string;
  operationName: 'ProductSearch';
  pageSize: number;
  delayMs: number;
  terms: TntPlanTerm[];
}

/** A plan with nothing to search, and why. */
export interface TntPlanNone {
  terms: [];
  reason: string;
}

/** One search result the browser posts: the ingredient and term it searched for, and the raw items the site answered. */
export interface TntResultIn {
  ingredientId: string;
  term: string;
  items: unknown[];
}

export interface TntIngestSummary {
  stored: number;
  matched: number;
  skipped: number;
}

/** Whether the household has T&T among its enabled stores. */
export function tntEnabled(household: Household): boolean {
  return household.stores.some((s) => s.id === TNT_STORE_ID && s.enabled);
}

/** The T&T rows a household's list reads, one per region it prices: none unless T&T is enabled with a region. */
export function tntLocations(household: Household): { store: string; storeId: string }[] {
  if (!tntEnabled(household)) return [];
  const region = tntRegionOf(household.postalCode);
  return region ? [{ store: TNT_STORE_NAME, storeId: tntStoreIdOf(region) }] : [];
}

/**
 * What the signed-in browser should search: the household's ingredients in the site-price order, skipping the ones
 * searched for T&T in the last six days, up to TNT_TERMS. Nothing to search (T&T not enabled, or no region) comes back
 * as an empty plan with the reason.
 */
export async function tntPlan(db: D1Database, householdId: string, now: Date): Promise<TntPlan | TntPlanNone> {
  const household = await loadHousehold(db, householdId);
  if (!tntEnabled(household)) return { terms: [], reason: "T&T isn't one of your stores" };
  const region = tntRegionOf(household.postalCode);
  if (!region) return { terms: [], reason: 'Set a postal code in Ontario, British Columbia, Alberta or Quebec to read T&T prices.' };

  const thisWeek = planWeekOf(now);
  const plans = [await loadPlan(db, householdId, thisWeek), await loadPlan(db, householdId, addDaysIso(thisWeek, 7))];
  const order = lookupOrder({ plans, household, pantry: await loadPantry(db, householdId) });
  const recent = await recentTntLookups(db, tntStoreIdOf(region), new Date(now.getTime() - LOOKUP_DAYS * 86_400_000).toISOString());
  const terms = order
    .filter((id) => !recent.has(id))
    .slice(0, TNT_TERMS)
    .map((id) => ({ ingredientId: id, term: searchTermFor(INGREDIENT_BY_ID[id]!) }));
  return {
    region,
    postcode: fsaOf(household.postalCode) ?? null,
    query: TNT_QUERY,
    operationName: 'ProductSearch',
    pageSize: PAGE_SIZE,
    delayMs: DELAY_MS,
    terms,
  };
}

async function recentTntLookups(db: D1Database, storeId: string, since: string): Promise<Set<string>> {
  const { results } = await db
    .prepare('SELECT ingredient_id FROM site_lookups WHERE banner = ? AND store_id = ? AND looked_up_at >= ?')
    .bind(LOOKUP_BANNER, storeId, since)
    .all<{ ingredient_id: string }>();
  return new Set(results.map((r) => r.ingredient_id));
}

/** The reason a results body is refused, with the status to answer with. Null when the body is one the app takes. */
export function tntResultsProblem(body: unknown): { status: 400 | 413; message: string } | null {
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { results?: unknown }).results)) {
    return { status: 400, message: 'Body must be { results: [...] }' };
  }
  const results = (body as { results: unknown[] }).results;
  if (results.length > TNT_RESULTS) return { status: 413, message: `At most ${TNT_RESULTS} results per sync` };
  for (const r of results) {
    if (typeof r !== 'object' || r === null) return { status: 400, message: 'Each result must be an object' };
    const { ingredientId, term, items } = r as { ingredientId?: unknown; term?: unknown; items?: unknown };
    if (typeof ingredientId !== 'string' || typeof term !== 'string' || !Array.isArray(items)) {
      return { status: 400, message: 'Each result needs ingredientId, term and items' };
    }
    if (items.length > TNT_ITEMS) return { status: 413, message: `At most ${TNT_ITEMS} items per result` };
  }
  return null;
}

/** A pack price per base unit, from the pack size in the product's name; a weight-priced product per kilogram. */
export function tntPackPrice(p: TntProduct, baseUnit: CatalogIngredient['baseUnit']): PriceHit | null {
  if (p.perWeight) {
    if (baseUnit !== 'kg') return null;
    const toKg = p.perWeight === 'lb' ? 1 / LB_KG : 1;
    const pricePerUnit = p.price * toKg;
    if (!Number.isFinite(pricePerUnit) || pricePerUnit <= 0) return null;
    return { pricePerUnit, packQty: 1, onSale: p.onSale, regularPerUnit: p.onSale ? p.regularPrice * toKg : null };
  }
  const size = parseSiteSize(p.name);
  if (!size) return null;
  const qty = toBaseQty(size, baseUnit);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return {
    pricePerUnit: p.price / qty,
    packQty: qty,
    onSale: p.onSale,
    regularPerUnit: p.onSale ? p.regularPrice / qty : null,
  };
}

/** The first in-stock product that is the ingredient and has a price in its unit, or null. */
export function pickTntResult(products: TntProduct[], ing: CatalogIngredient): PriceHit | null {
  for (const product of products) {
    if (!product.inStock) continue;
    if (matchIngredient(product.name)?.ingredientId !== ing.id) continue;
    const hit = tntPackPrice(product, ing.baseUnit);
    if (hit) return hit;
  }
  return null;
}

/**
 * Stores one sync's results: each ingredient's first priced match becomes a site price for T&T at the household's region,
 * every searched ingredient is recorded as looked up, and one site_price_runs row (mode 'browser') is written. Null when
 * T&T is not one of the household's stores (or has no region), so nothing is written.
 */
export async function ingestTntResults(
  db: D1Database,
  householdId: string,
  keyId: string,
  results: TntResultIn[],
  now: Date,
): Promise<TntIngestSummary | null> {
  const household = await loadHousehold(db, householdId);
  const region = tntRegionOf(household.postalCode);
  if (!tntEnabled(household) || !region) return null;
  const storeId = tntStoreIdOf(region);
  const today = torontoDate(now);
  const startedAt = now.toISOString();

  const writes: D1PreparedStatement[] = [];
  let matched = 0;
  let skipped = 0;
  for (const r of results) {
    const ing = INGREDIENT_BY_ID[r.ingredientId];
    if (!ing) {
      skipped++;
      continue;
    }
    const products = r.items.map((raw) => normaliseTntItem(raw)).filter((p): p is TntProduct => p !== null);
    const hit = pickTntResult(products, ing);
    writes.push(
      db
        .prepare('INSERT OR REPLACE INTO site_lookups (banner, store_id, ingredient_id, looked_up_at, matched) VALUES (?, ?, ?, ?, ?)')
        .bind(LOOKUP_BANNER, storeId, ing.id, startedAt, hit ? 1 : 0),
    );
    if (!hit) {
      skipped++;
      continue;
    }
    matched++;
    writes.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO price_history
             (ingredient_id, store, date, price_per_unit, on_sale, source, household_id, pack_qty, site_store_id, regular_price_per_unit)
           VALUES (?, ?, ?, ?, ?, 'site', '', ?, ?, ?)`,
        )
        .bind(ing.id, TNT_STORE_NAME, today, hit.pricePerUnit, hit.onSale ? 1 : 0, hit.packQty, storeId, hit.regularPerUnit),
    );
  }

  for (let i = 0; i < writes.length; i += CHUNK) await db.batch(writes.slice(i, i + CHUNK));
  await db
    .prepare(
      `INSERT INTO site_price_runs (id, household_id, started_at, finished_at, ok, lookups, matched, errors, sample, auth_needed, mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', 0, 'browser')`,
    )
    .bind(newId(), householdId, startedAt, startedAt, matched > 0 ? 1 : 0, results.length, matched)
    .run();
  await touchSyncKey(db, keyId, now);
  return { stored: matched, matched, skipped };
}

export interface TntStatus {
  enabled: boolean;
  lastRun: { finishedAt: string; ok: boolean; lookups: number; matched: number } | null;
  /** Ingredients with a T&T price in the last fourteen days at the household's region. */
  prices: number;
}

/** The household's last browser sync, and how many T&T prices are current. */
export async function tntStatus(db: D1Database, householdId: string, household: Household, now: Date): Promise<TntStatus> {
  if (!tntEnabled(household)) return { enabled: false, lastRun: null, prices: 0 };
  const row = await db
    .prepare(
      `SELECT finished_at, ok, lookups, matched FROM site_price_runs
       WHERE household_id = ? AND mode = 'browser' ORDER BY started_at DESC LIMIT 1`,
    )
    .bind(householdId)
    .first<{ finished_at: string; ok: number; lookups: number; matched: number }>();
  const region = tntRegionOf(household.postalCode);
  let prices = 0;
  if (region) {
    const since = addDaysIso(torontoDate(now), -SITE_PRICE_DAYS);
    const n = await db
      .prepare(
        `SELECT COUNT(DISTINCT ingredient_id) AS n FROM price_history
         WHERE source = 'site' AND date >= ? AND site_store_id = ? AND store = ?`,
      )
      .bind(since, tntStoreIdOf(region), TNT_STORE_NAME)
      .first<{ n: number }>();
    prices = n?.n ?? 0;
  }
  return {
    enabled: true,
    lastRun: row ? { finishedAt: row.finished_at, ok: row.ok === 1, lookups: row.lookups, matched: row.matched } : null,
    prices,
  };
}
