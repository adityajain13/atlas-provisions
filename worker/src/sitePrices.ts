// Regular shelf prices for a household's Loblaw-family stores: a batch of searches on the store location the household
// picked, the prices written to price_history (source 'site'), and a row in site_price_runs. One batch is capped by a
// request budget, and an ingredient looked up at a location is not looked up there again for six days.
import {
  INGREDIENT_BY_ID,
  LB_KG,
  SITE_BANNER_NAMES,
  addDaysIso,
  alwaysBuyId,
  isSiteBanner,
  matchIngredient,
  newId,
  parseSize,
  planWeekOf,
  siteBannerOf,
  toBaseQty,
  torontoDate,
  HouseholdSchema,
  type CatalogIngredient,
  type Household,
  type MealPlan,
  type ParsedSize,
  type PantryItem,
  type SiteBanner,
  type Store,
} from '@provisions/shared';
import { loadHousehold, loadPantry, loadPlan } from './db';
import { createBudget } from './flipp';
import { listLocations, searchProducts, type SiteLocation, type SiteProduct, type SiteResult } from './pcexpress';

/** Searches one batch may send. Stays under the Worker's 50 requests per run, with room for the rest of a run. */
export const SITE_BUDGET = 40;
/** The Sunday job's flyer run and regular-price batch share one invocation: the most requests the two may send together. */
export const SCHEDULED_SUBREQUEST_LIMIT = 46;
const LOCATION_CACHE_MS = 7 * 86_400_000;
const LOCATION_RESULTS = 25;
/** A household can refresh its regular prices by hand at most this often. */
export const SITE_COOLDOWN_MS = 10 * 60_000;
/** A pair looked up this recently is not looked up again. */
const LOOKUP_DAYS = 6;
/** Site prices count as offers for this many days. */
export const SITE_PRICE_DAYS = 14;
const MAX_ERRORS = 20;
const SAMPLE_SIZE = 3;

/** Staple ingredients looked up after the ones the household needs, so the first batches cover common items. */
export const STAPLE_IDS = [
  'eggs-large',
  'milk-2-percent',
  'butter',
  'yellow-onion',
  'garlic',
  'potatoes',
  'carrots',
  'bananas',
  'white-bread',
  'rolled-oats',
  'basmati-rice',
  'spaghetti',
  'canned-tuna',
  'chicken-thigh-boneless',
  'ground-beef',
  'cheddar',
  'greek-yogurt',
  'frozen-peas',
  'lemons',
  'roma-tomatoes',
];

export interface SiteRunSummary {
  ok: boolean;
  lookups: number;
  matched: number;
  errors: string[];
  authNeeded: boolean;
}

/** One store location a household reads prices for. */
export interface SiteTarget {
  store: Store;
  banner: SiteBanner;
  storeId: string;
}

/** The enabled household stores that have a location picked, on a banner the app reads. */
export function siteTargets(household: Household): SiteTarget[] {
  return household.stores.flatMap((store) => {
    if (!store.enabled || !store.siteStore) return [];
    const banner = store.siteStore.banner;
    if (!isSiteBanner(banner) || siteBannerOf(store.id) === undefined) return [];
    return [{ store, banner, storeId: store.siteStore.storeId }];
  });
}

/** The search term for an ingredient: its first alias, which the catalogue lists most common first. */
export function searchTermFor(ing: CatalogIngredient): string {
  return ing.aliases[0] ?? ing.name;
}

/**
 * The ingredients to look up, most wanted first: the ones on the household's current and next week's lists, the
 * always-buy and pinned ones, the pantry, then the staples. Only catalogue ingredients, each once.
 */
export function lookupOrder(input: { plans: (MealPlan | null)[]; household: Household; pantry: PantryItem[] }): string[] {
  const ids: string[] = [];
  for (const plan of input.plans) for (const item of plan?.list ?? []) ids.push(item.ingredientId);
  for (const rule of input.household.itemRules) {
    if (rule.rule === 'always') ids.push(alwaysBuyId(rule.name) ?? '');
    if (rule.rule === 'pin' && rule.ingredientId) ids.push(rule.ingredientId);
  }
  for (const item of input.pantry) ids.push(item.ingredientId);
  ids.push(...STAPLE_IDS);
  return [...new Set(ids)].filter((id) => INGREDIENT_BY_ID[id] !== undefined);
}

/** A size as the site words it: the shared parser, or "12 un" for twelve units. Null when neither reads it. */
export function parseSiteSize(text: string | undefined): ParsedSize | null {
  if (!text) return null;
  const size = parseSize(text);
  if (size) return size;
  const m = text.toLowerCase().match(/(\d+)\s*(?:un|units?)\b/);
  return m ? { qty: Number(m[1]), unit: 'each' } : null;
}

/** The site's own unit price, converted to the ingredient's base unit ($/kg, $/l or $/each), or null. */
export function comparisonPerBase(unit: { value: number; unit: string } | undefined, baseUnit: CatalogIngredient['baseUnit']): number | null {
  if (!unit) return null;
  const v = unit.value;
  const u = unit.unit.toLowerCase().replace(/\s+/g, '');
  const per =
    baseUnit === 'kg'
      ? { kg: v, '100g': v * 10, g: v * 1000, lb: v / LB_KG, lbs: v / LB_KG }[u]
      : baseUnit === 'l'
        ? { l: v, '100ml': v * 10, ml: v * 1000 }[u]
        : { each: v, ea: v }[u];
  return per !== undefined && Number.isFinite(per) && per > 0 ? per : null;
}

/**
 * Price per base unit and the base units in the pack, from the pack size. Without a usable size, the site's unit price
 * stands in. Null when neither gives a price in the ingredient's unit.
 */
export function sitePackPrice(p: Pick<SiteProduct, 'price' | 'packageSize' | 'unitPrice'>, baseUnit: CatalogIngredient['baseUnit']): { pricePerUnit: number; packQty: number } | null {
  const size = parseSiteSize(p.packageSize);
  if (size) {
    const qty = toBaseQty(size, baseUnit);
    if (Number.isFinite(qty) && qty > 0) return { pricePerUnit: p.price / qty, packQty: qty };
  }
  const perUnit = comparisonPerBase(p.unitPrice, baseUnit);
  if (perUnit === null) return null;
  return { pricePerUnit: perUnit, packQty: p.price / perUnit };
}

/**
 * The first result that is the ingredient and has a price in its unit. The site's order is kept, so the top match wins.
 * Null when nothing matches.
 */
export function pickSiteResult(products: SiteProduct[], ing: CatalogIngredient): (ReturnType<typeof sitePackPrice> & { product: SiteProduct }) | null {
  for (const product of products) {
    if (matchIngredient(product.name)?.ingredientId !== ing.id) continue;
    const pack = sitePackPrice(product, ing.baseUnit);
    if (pack) return { ...pack, product };
  }
  return null;
}

type Db = D1Database;

/** Every household's last regular-price run, for the Sunday job: the household that has waited longest is next. */
export async function nextSiteHousehold(db: Db): Promise<string | null> {
  const { results } = await db
    .prepare(
      `SELECT h.id, h.data, (SELECT MAX(r.started_at) FROM site_price_runs r WHERE r.household_id = h.id) AS last_run
       FROM households h`,
    )
    .all<{ id: string; data: string; last_run: string | null }>();
  const eligible: { id: string; last: string }[] = [];
  for (const row of results) {
    let parsed: ReturnType<typeof HouseholdSchema.safeParse>;
    try {
      parsed = HouseholdSchema.safeParse(JSON.parse(row.data));
    } catch {
      continue;
    }
    if (!parsed.success || siteTargets(parsed.data).length === 0) continue;
    eligible.push({ id: row.id, last: row.last_run ?? '' });
  }
  eligible.sort((a, b) => a.last.localeCompare(b.last) || a.id.localeCompare(b.id));
  return eligible[0]?.id ?? null;
}

async function recentlyLookedUp(db: Db, banner: string, storeId: string, since: string): Promise<Set<string>> {
  const { results } = await db
    .prepare('SELECT ingredient_id FROM site_lookups WHERE banner = ? AND store_id = ? AND looked_up_at >= ?')
    .bind(banner, storeId, since)
    .all<{ ingredient_id: string }>();
  return new Set(results.map((r) => r.ingredient_id));
}

const CHUNK = 50;

/**
 * One batch of regular-price lookups for a household: every enabled store with a location, in the household's store
 * order, each ingredient in lookupOrder. Stops when the budget is used up. A sign-in or a block on a banner stops that
 * banner, and a not-found stops that location. Writes the matched prices, the lookups and the run row.
 */
export async function runSitePrices(
  env: { DB: Db },
  householdId: string,
  fetchImpl: typeof fetch = fetch,
  budgetLimit: number = SITE_BUDGET,
  now: Date = new Date(),
): Promise<SiteRunSummary> {
  const db = env.DB;
  const household = await loadHousehold(db, householdId);
  const targets = siteTargets(household);
  if (targets.length === 0) {
    return { ok: false, lookups: 0, matched: 0, errors: ['Pick a store location for regular prices first.'], authNeeded: false };
  }

  const startedAt = now.toISOString();
  const today = torontoDate(now);
  const thisWeek = planWeekOf(now);
  const plans = [await loadPlan(db, householdId, thisWeek), await loadPlan(db, householdId, addDaysIso(thisWeek, 7))];
  const order = lookupOrder({ plans, household, pantry: await loadPantry(db, householdId) });
  const since = new Date(now.getTime() - LOOKUP_DAYS * 86_400_000).toISOString();

  const budget = createBudget(budgetLimit);
  const errors: string[] = [];
  const sample: unknown[] = [];
  const writes: D1PreparedStatement[] = [];
  const stopped = new Set<SiteBanner>();
  let lookups = 0;
  let matched = 0;
  let successes = 0;
  let authNeeded = false;
  let exhausted = false;

  for (const t of targets) {
    if (exhausted) break;
    if (stopped.has(t.banner)) continue;
    const recent = await recentlyLookedUp(db, t.banner, t.storeId, since);
    const label = t.store.name;
    for (const ingredientId of order) {
      if (recent.has(ingredientId)) continue;
      if (!budget.take()) {
        exhausted = true;
        break;
      }
      const ing = INGREDIENT_BY_ID[ingredientId]!;
      const term = searchTermFor(ing);
      lookups++;
      const got = await searchProducts(t.banner, t.storeId, term, fetchImpl);
      if (!got.ok) {
        const e = got.error;
        if (sample.length < SAMPLE_SIZE && e.sample !== undefined) sample.push({ store: label, term, kind: e.kind, sample: e.sample });
        if (errors.length < MAX_ERRORS) errors.push(`${label}, ${term}: ${e.message}`);
        if (e.kind === 'auth') {
          authNeeded = true;
          stopped.add(t.banner);
          break;
        }
        if (e.kind === 'blocked') {
          stopped.add(t.banner);
          break;
        }
        if (e.kind === 'not-found') break;
        continue;
      }
      successes++;
      const hit = pickSiteResult(got.value, ing);
      if (sample.length < SAMPLE_SIZE && got.value.length > 0) {
        sample.push({ store: label, term, results: got.value.slice(0, 3) });
      }
      writes.push(
        db
          .prepare(
            `INSERT OR REPLACE INTO site_lookups (banner, store_id, ingredient_id, looked_up_at, matched) VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(t.banner, t.storeId, ingredientId, startedAt, hit ? 1 : 0),
      );
      if (!hit) continue;
      matched++;
      const regular = hit.product.wasPrice !== undefined ? hit.product.wasPrice / hit.packQty : null;
      writes.push(
        db
          .prepare(
            `INSERT OR REPLACE INTO price_history
               (ingredient_id, store, date, price_per_unit, on_sale, source, household_id, pack_qty, site_store_id, regular_price_per_unit)
             VALUES (?, ?, ?, ?, ?, 'site', '', ?, ?, ?)`,
          )
          .bind(ingredientId, t.store.name, today, hit.pricePerUnit, hit.product.onSale ? 1 : 0, hit.packQty, t.storeId, regular),
      );
    }
  }
  if (exhausted && errors.length < MAX_ERRORS) errors.push('Stopped early: the request budget for one run is used up.');

  for (let i = 0; i < writes.length; i += CHUNK) await db.batch(writes.slice(i, i + CHUNK));

  const finishedAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO site_price_runs (id, household_id, started_at, finished_at, ok, lookups, matched, errors, sample, auth_needed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId(),
      householdId,
      startedAt,
      finishedAt,
      successes > 0 ? 1 : 0,
      lookups,
      matched,
      JSON.stringify(errors.slice(0, MAX_ERRORS)),
      JSON.stringify(sample.slice(0, SAMPLE_SIZE)),
      authNeeded ? 1 : 0,
    )
    .run();

  return { ok: successes > 0, lookups, matched, errors: errors.slice(0, MAX_ERRORS), authNeeded };
}

/** The Sunday job's batch: the household that has waited longest, with a budget the flyer run left room for. */
export async function runScheduledSite(
  env: { DB: Db },
  now: Date,
  fetchImpl: typeof fetch = fetch,
  budget: number = SITE_BUDGET,
): Promise<{ householdId: string; summary: SiteRunSummary } | null> {
  if (budget <= 0) return null;
  const householdId = await nextSiteHousehold(env.DB);
  if (householdId === null) return null;
  return { householdId, summary: await runSitePrices(env, householdId, fetchImpl, budget, now) };
}

/**
 * The locations of a banner, from the store's site or from the cache when it is under a week old. A failed or empty
 * listing is not cached, so the next search asks again.
 */
export async function cachedLocations(db: Db, banner: string, fetchImpl: typeof fetch, now: Date): Promise<SiteResult<SiteLocation[]>> {
  const row = await db
    .prepare('SELECT data, fetched_at FROM site_locations WHERE banner = ?')
    .bind(banner)
    .first<{ data: string; fetched_at: string }>();
  if (row && now.getTime() - Date.parse(row.fetched_at) < LOCATION_CACHE_MS) {
    try {
      const cached = JSON.parse(row.data) as SiteLocation[];
      if (Array.isArray(cached)) return { ok: true, value: cached };
    } catch {
      // A damaged cache row is replaced below.
    }
  }
  const got = await listLocations(banner, fetchImpl);
  if (got.ok && got.value.length > 0) {
    await db
      .prepare('INSERT OR REPLACE INTO site_locations (banner, data, fetched_at) VALUES (?, ?, ?)')
      .bind(banner, JSON.stringify(got.value), now.toISOString())
      .run();
  }
  return got;
}

/**
 * The locations whose name, street, city or postal code contain every word of `query` (case-insensitive, spaces in a
 * postal code ignored). Empty for an empty query. Each has the label the picker shows, e.g. "No Frills · 123 Main St, Mississauga".
 */
export function matchLocations(
  locations: SiteLocation[],
  banner: string,
  query: string,
): { storeId: string; label: string; postalCode: string | null }[] {
  const words = query.toLowerCase().replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const bannerName = isSiteBanner(banner) ? SITE_BANNER_NAMES[banner] : banner;
  const out: { storeId: string; label: string; postalCode: string | null }[] = [];
  for (const loc of locations) {
    const haystack = [loc.name, loc.line1, loc.city, loc.postalCode]
      .filter((v): v is string => typeof v === 'string' && v !== '')
      .join(' ')
      .toLowerCase()
      .replace(/\s+/g, '');
    if (!words.every((w) => haystack.includes(w.replace(/\s+/g, '')))) continue;
    const address = [loc.line1, loc.city].filter(Boolean).join(', ');
    out.push({ storeId: loc.storeId, label: address ? `${bannerName} · ${address}` : bannerName, postalCode: loc.postalCode ?? null });
    if (out.length === LOCATION_RESULTS) break;
  }
  return out;
}

/** Minutes left before a household can refresh its regular prices by hand. Zero when it can now. */
export async function siteWaitMinutes(db: Db, householdId: string, now: Date): Promise<number> {
  const last = await db
    .prepare('SELECT started_at FROM site_price_runs WHERE household_id = ? ORDER BY started_at DESC LIMIT 1')
    .bind(householdId)
    .first<{ started_at: string }>();
  if (!last) return 0;
  const elapsed = now.getTime() - Date.parse(last.started_at);
  if (!Number.isFinite(elapsed) || elapsed >= SITE_COOLDOWN_MS) return 0;
  return Math.max(1, Math.ceil((SITE_COOLDOWN_MS - Math.max(0, elapsed)) / 60_000));
}

export interface SiteRunRow {
  id: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  lookups: number;
  matched: number;
  errors: string[];
  authNeeded: boolean;
  sample?: unknown[];
}

interface SiteRunDbRow {
  id: string;
  started_at: string;
  finished_at: string;
  ok: number;
  lookups: number;
  matched: number;
  errors: string;
  auth_needed: number;
  sample?: string;
}

/** The household's latest run, and the prices read in the last fourteen days at its locations. */
export async function siteStatus(
  db: Db,
  householdId: string,
  household: Household,
  now: Date,
  debug: boolean,
): Promise<{ lastRun: SiteRunRow | null; prices: number }> {
  const row = await db
    .prepare(
      `SELECT id, started_at, finished_at, ok, lookups, matched, errors, auth_needed${debug ? ', sample' : ''}
       FROM site_price_runs WHERE household_id = ? ORDER BY started_at DESC LIMIT 1`,
    )
    .bind(householdId)
    .first<SiteRunDbRow>();
  const lastRun: SiteRunRow | null = row
    ? {
        id: row.id,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        ok: row.ok === 1,
        lookups: row.lookups,
        matched: row.matched,
        errors: parseList(row.errors) as string[],
        authNeeded: row.auth_needed === 1,
        ...(debug ? { sample: parseList(row.sample) } : {}),
      }
    : null;

  // Distinct ingredient and store pairs with a site price in the window, at the household's locations.
  const ids = siteTargets(household).map((t) => t.storeId);
  let prices = 0;
  if (ids.length > 0) {
    const since = addDaysIso(torontoDate(now), -SITE_PRICE_DAYS);
    const marks = ids.map(() => '?').join(', ');
    const n = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT DISTINCT ingredient_id, store, site_store_id FROM price_history
           WHERE source = 'site' AND date >= ? AND site_store_id IN (${marks})
         )`,
      )
      .bind(since, ...ids)
      .first<{ n: number }>();
    prices = n?.n ?? 0;
  }
  return { lastRun, prices };
}

function parseList(text: string | undefined): unknown[] {
  if (!text) return [];
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
