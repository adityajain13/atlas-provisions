// When each price source last read each household store: its flyers, its regular shelf prices and its T&T prices. Four
// grouped queries whatever the number of stores. The state (fresh, stale, none) is worked out by the app from these.
import { addDaysIso, normalizePostalCode, torontoDate, type Household, type StoreSyncReadings } from '@provisions/shared';
import { SITE_PRICE_DAYS, siteTargets } from './sitePrices';
import { TNT_STORE_ID, tntLocations } from './tntSync';

/** The sync readings of every store in the household, keyed by store id. A store with nothing read has no entry. */
export async function storeSyncReadings(
  db: D1Database,
  householdId: string,
  household: Household,
  now: Date,
): Promise<Record<string, StoreSyncReadings>> {
  const out: Record<string, StoreSyncReadings> = {};
  const today = torontoDate(now);
  const since = addDaysIso(today, -SITE_PRICE_DAYS);

  // Flyers, per the household's postal code. Flyer rows are keyed by the store's name, as the import writes them.
  const postal = household.postalCode ? normalizePostalCode(household.postalCode) : null;
  if (postal) {
    const { results } = await db
      .prepare(
        `SELECT store, MAX(fetched_at) AS at, MAX(valid_to) AS valid_to, SUM(CASE WHEN valid_to >= ? THEN 1 ELSE 0 END) AS current
         FROM flyer_items WHERE postal_code = ? GROUP BY store`,
      )
      .bind(today, postal)
      .all<{ store: string; at: string; valid_to: string; current: number }>();
    const byName = new Map(results.map((r) => [r.store, r]));
    for (const store of household.stores) {
      const r = byName.get(store.name);
      if (r) (out[store.id] ??= {}).flyer = { at: r.at, count: Number(r.current ?? 0), validTo: r.valid_to };
    }
  }

  // Regular shelf prices at the enabled Loblaw-family locations, and T&T at its region's store. A location's last
  // matched lookup is its read time; the count is the distinct ingredients priced there in the last fourteen days.
  const shelf = siteTargets(household).map((t) => ({ id: t.store.id, banner: t.banner as string, storeId: t.storeId, name: t.store.name }));
  const tnt = tntLocations(household).map((t) => ({ storeId: t.storeId, name: t.store }));
  const storeIds = [...new Set([...shelf.map((l) => l.storeId), ...tnt.map((l) => l.storeId)])];
  if (storeIds.length > 0) {
    const marks = storeIds.map(() => '?').join(', ');
    const lookups = await db
      .prepare(
        `SELECT banner, store_id, MAX(looked_up_at) AS at FROM site_lookups
         WHERE matched = 1 AND store_id IN (${marks}) GROUP BY banner, store_id`,
      )
      .bind(...storeIds)
      .all<{ banner: string; store_id: string; at: string }>();
    const lastLookup = new Map(lookups.results.map((r) => [`${r.banner}|${r.store_id}`, r.at]));
    const priced = await db
      .prepare(
        `SELECT site_store_id, store, COUNT(DISTINCT ingredient_id) AS n FROM price_history
         WHERE source = 'site' AND date >= ? AND site_store_id IN (${marks}) GROUP BY site_store_id, store`,
      )
      .bind(since, ...storeIds)
      .all<{ site_store_id: string; store: string; n: number }>();
    const count = new Map(priced.results.map((r) => [`${r.site_store_id}|${r.store}`, r.n]));

    for (const l of shelf) {
      const at = lastLookup.get(`${l.banner}|${l.storeId}`);
      if (at) (out[l.id] ??= {}).shelf = { at, count: count.get(`${l.storeId}|${l.name}`) ?? 0 };
    }

    // T&T is read by the signed-in browser, so its time is the household's last browser run.
    const location = tnt[0];
    if (location) {
      const run = await db
        .prepare(`SELECT MAX(finished_at) AS at FROM site_price_runs WHERE household_id = ? AND mode = 'browser'`)
        .bind(householdId)
        .first<{ at: string | null }>();
      if (run?.at) (out[TNT_STORE_ID] ??= {}).tnt = { at: run.at, count: count.get(`${location.storeId}|${location.name}`) ?? 0 };
    }
  }

  return out;
}
