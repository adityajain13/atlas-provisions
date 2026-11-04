// Flyer import: read the flyers of the household's stores, store their items, and record the matched prices.
// When the flyers give nothing, search Flipp by name instead. One request budget covers the whole run.
import {
  collapseIssues,
  expandFlyerItem,
  fallbackSearchTerms,
  matchFlyerItem,
  newId,
  torontoDate,
  type FlyerItem,
  type FlyerUsed,
  type IngestIssue,
  type IngestMode,
  type IngestRunSummary,
  type MatchedItem,
  type StoreCount,
  type StoreMatchInput,
} from '@provisions/shared';
import { insertFlyerItems, insertIngestRun, loadHousehold, recordPrices } from './db';
import {
  BUDGET_STOP_MESSAGE,
  createFlippClient,
  fetchFlyerItems,
  fetchFlyerList,
  mapPool,
  searchFlippTerms,
  selectFlyers,
  toFlyerItemFromFlyer,
  type FlippClient,
  type FlippOptions,
  type FlippRawItem,
} from './flipp';

export type IngestEnv = { DB: D1Database };

const UNMATCHED_SAMPLE = 15;
const MAX_ERRORS = 20;
const SAMPLE_SIZE = 3;
const CONCURRENCY = 4;

const notRun = (message: string): IngestRunSummary => ({
  ok: false,
  mode: 'flyers',
  terms: 0,
  flyerCount: 0,
  items: 0,
  kept: 0,
  stored: 0,
  matched: 0,
  storeCounts: [],
  unmatchedSample: [],
  errors: [message],
});

interface FlyerImport {
  raw: FlippRawItem[];
  kept: FlyerItem[];
  flyersUsed: FlyerUsed[];
  storeCounts: StoreCount[];
}

/**
 * The items of the flyers for the household's stores. Null when there are no matching flyers, or when
 * their items gave nothing, so the caller can fall back to a search.
 */
async function importFlyers(
  postal: string,
  stores: StoreMatchInput[],
  today: string,
  client: FlippClient,
  issues: IngestIssue[],
): Promise<FlyerImport | null> {
  const listed = await fetchFlyerList(postal, client);
  if (!listed.ok) {
    if (!listed.budget) issues.push({ message: listed.message });
    return null;
  }
  const selected = selectFlyers(listed.flyers, stores, today);
  if (selected.length === 0) return null;

  // Fetched in parallel, merged in flyer order below so the results are the same every run.
  const fetched = await mapPool(selected, CONCURRENCY, async ({ flyer, store }) => {
    const got = await fetchFlyerItems(flyer.id, client);
    for (const message of got.issues) issues.push({ label: `${store} flyer`, message });
    return { flyer, store, items: got.items };
  });

  const rawByKey = new Map<string, FlippRawItem>();
  const kept = new Map<string, FlyerItem>();
  const countByStore = new Map<string, number>();
  const flyersUsed: FlyerUsed[] = [];
  for (const { flyer, store, items } of fetched) {
    let newItems = 0;
    for (const raw of items) {
      const key = raw.flyer_item_id ?? raw.id;
      if (key === undefined || key === null) continue;
      const k = String(key);
      if (rawByKey.has(k)) continue;
      rawByKey.set(k, raw);
      newItems++;
      const item = toFlyerItemFromFlyer(raw, store, flyer);
      if (item && !kept.has(item.id)) kept.set(item.id, item);
    }
    countByStore.set(store, (countByStore.get(store) ?? 0) + newItems);
    flyersUsed.push({ id: flyer.id, merchant: flyer.merchant, name: flyer.name, store, items: items.length });
  }

  if (rawByKey.size === 0) return null;
  return {
    raw: [...rawByKey.values()],
    kept: [...kept.values()],
    flyersUsed,
    storeCounts: [...countByStore].map(([store, count]) => ({ store, count })),
  };
}

/**
 * One import run. Does nothing (and writes no run row) without a postal code or an enabled store.
 * Otherwise it writes the flyer items, records prices for the ones that match an ingredient, and
 * writes an ingest_runs row. ok is true when at least one request got a usable answer.
 */
export async function runIngest(
  env: IngestEnv,
  fetchImpl: typeof fetch = fetch,
  opts: Partial<FlippOptions> = {},
): Promise<IngestRunSummary> {
  const household = await loadHousehold(env.DB);
  if (!household.postalCode) return notRun('Add a postal code in Household first.');
  const stores = household.stores
    .filter((s) => s.enabled)
    .map((s) => ({ name: s.name, flippNames: s.flippNames }));
  if (stores.length === 0) return notRun('Turn on at least one store in Household first.');

  const startedAt = new Date().toISOString();
  const today = torontoDate();
  const postal = household.postalCode;
  const client = createFlippClient(fetchImpl, opts);
  const issues: IngestIssue[] = [];

  let mode: IngestMode = 'flyers';
  let terms = 0;
  let imported = await importFlyers(postal, stores, today, client, issues);
  if (!imported) {
    mode = 'search';
    const searchTerms = fallbackSearchTerms();
    terms = searchTerms.length;
    const found = await searchFlippTerms(postal, searchTerms, client, stores, CONCURRENCY);
    issues.push(...found.issues);
    const countByStore = new Map<string, number>();
    for (const item of found.items) countByStore.set(item.store, (countByStore.get(item.store) ?? 0) + 1);
    imported = {
      raw: found.raw,
      kept: found.items,
      flyersUsed: [],
      storeCounts: [...countByStore].map(([store, count]) => ({ store, count })),
    };
  }

  const expanded = imported.kept.flatMap(expandFlyerItem);
  await insertFlyerItems(env.DB, expanded);

  const matched: MatchedItem[] = [];
  const unmatched: string[] = [];
  for (const item of expanded) {
    const m = matchFlyerItem(item);
    if (m) matched.push(m);
    else unmatched.push(item.rawName);
  }
  await recordPrices(env.DB, matched, torontoDate());

  const finishedAt = new Date().toISOString();
  // The stop note always fits, so it is never cut off by the error cap.
  const stopped = client.budget.exhausted;
  const errors = collapseIssues(issues, mode === 'search' ? 'searches' : 'requests').slice(0, MAX_ERRORS - (stopped ? 1 : 0));
  if (stopped) errors.push(BUDGET_STOP_MESSAGE);
  const ok = client.successes > 0;
  await insertIngestRun(env.DB, {
    id: newId(),
    startedAt,
    finishedAt,
    ok,
    mode,
    terms,
    flyers: imported.flyersUsed,
    items: imported.raw.length,
    kept: imported.kept.length,
    stored: expanded.length,
    matched: matched.length,
    errors,
    sample: imported.raw.slice(0, SAMPLE_SIZE),
  });

  return {
    ok,
    mode,
    terms,
    flyerCount: imported.flyersUsed.length,
    items: imported.raw.length,
    kept: imported.kept.length,
    stored: expanded.length,
    matched: matched.length,
    storeCounts: imported.storeCounts,
    unmatchedSample: [...new Set(unmatched)].slice(0, UNMATCHED_SAMPLE),
    errors,
  };
}
