// Flyer import: read the flyers of the household's stores, store their items, and record the matched prices.
// When the flyers give nothing, search Flipp by name instead. One request budget covers the whole run.
import {
  HouseholdSchema,
  collapseIssues,
  expandFlyerItem,
  fallbackSearchTerms,
  matchFlyerItem,
  newId,
  normalizePostalCode,
  planWeekOf,
  retentionCutoff,
  torontoDate,
  type FlyerItem,
  type FlyerUsed,
  type Household,
  type IngestIssue,
  type IngestMode,
  type IngestRunSummary,
  type MatchedItem,
  type StoreCount,
  type StoreMatchInput,
} from '@provisions/shared';
import { insertFlyerItems, insertIngestRun, pruneWeeksBefore, recordPrices } from './db';
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
/** A postal code can be refreshed by hand at most this often. */
export const REFRESH_COOLDOWN_MS = 10 * 60_000;

/** The summary for a run that did not start, such as a household with no postal code. */
export const notRunSummary = (message: string): IngestRunSummary => ({
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

/** A household's enabled stores, as the flyer matcher takes them. */
export function enabledStores(household: Household): StoreMatchInput[] {
  return household.stores.filter((s) => s.enabled).map((s) => ({ name: s.name, flippNames: s.flippNames }));
}

/**
 * One import run for a postal code: the flyers of the given stores, or a search when they give nothing. Writes
 * the flyer items for the postal code, records prices for the ones that match an ingredient, and writes an
 * ingest_runs row. ok is true when at least one request got a usable answer.
 */
export async function runIngest(
  env: IngestEnv,
  postal: string,
  stores: StoreMatchInput[],
  fetchImpl: typeof fetch = fetch,
  opts: Partial<FlippOptions> = {},
): Promise<IngestRunSummary> {
  const startedAt = new Date().toISOString();
  const today = torontoDate();
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
  await insertFlyerItems(env.DB, postal, expanded);

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
  await insertIngestRun(env.DB, postal, {
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
    requests: client.budget.used,
  };
}

// ---- The Sunday job and per-postal-code scheduling ----

/** A postal code with at least one enabled store, and the stores of every household that uses it. */
export interface PostalTarget {
  postal: string;
  stores: StoreMatchInput[];
}

/**
 * Every postal code that a household with an enabled store uses. A household whose stored document does not
 * parse is skipped, so one bad row cannot stop the others from being refreshed.
 */
export async function postalTargets(db: D1Database): Promise<PostalTarget[]> {
  const { results } = await db.prepare('SELECT id, data FROM households').all<{ id: string; data: string }>();
  const byPostal = new Map<string, Map<string, Set<string>>>();
  for (const row of results) {
    let parsed: ReturnType<typeof HouseholdSchema.safeParse>;
    try {
      parsed = HouseholdSchema.safeParse(JSON.parse(row.data));
    } catch {
      continue;
    }
    if (!parsed.success) continue;
    const postal = parsed.data.postalCode ? normalizePostalCode(parsed.data.postalCode) : null;
    const enabled = parsed.data.stores.filter((s) => s.enabled);
    if (!postal || enabled.length === 0) continue;
    const merged = byPostal.get(postal) ?? new Map<string, Set<string>>();
    for (const store of enabled) {
      const names = merged.get(store.name) ?? new Set<string>();
      for (const flipp of store.flippNames ?? []) names.add(flipp);
      merged.set(store.name, names);
    }
    byPostal.set(postal, merged);
  }
  return [...byPostal].map(([postal, merged]) => ({
    postal,
    stores: [...merged].map(([name, names]) => (names.size > 0 ? { name, flippNames: [...names] } : { name })),
  }));
}

export interface PostalStatus {
  /** Start time of the latest run of any kind, or null when there is none. */
  lastAttempt: string | null;
  /** A run for this postal code succeeded since the week started. */
  fresh: boolean;
}

/** Each postal code's latest attempt and whether it succeeded since `weekStart` (a YYYY-MM-DD Sunday). */
export async function postalStatus(db: D1Database, weekStart: string): Promise<Map<string, PostalStatus>> {
  const { results } = await db
    .prepare(
      `SELECT postal_code, MAX(started_at) AS last_attempt,
              MAX(CASE WHEN ok = 1 AND started_at >= ? THEN 1 ELSE 0 END) AS fresh
       FROM ingest_runs WHERE postal_code IS NOT NULL GROUP BY postal_code`,
    )
    .bind(weekStart)
    .all<{ postal_code: string; last_attempt: string | null; fresh: number }>();
  return new Map(
    results.map((r) => [r.postal_code, { lastAttempt: r.last_attempt, fresh: r.fresh === 1 }] as const),
  );
}

/**
 * The postal code to refresh next: the one that is not fresh this week and was attempted longest ago (never
 * attempted sorts first). Ordering by the latest attempt, not the latest success, means one postal code that
 * always fails cannot keep the others from being refreshed.
 */
export function pickStalestPostal(
  targets: PostalTarget[],
  status: Map<string, PostalStatus>,
): PostalTarget | undefined {
  const stale = targets.filter((t) => !status.get(t.postal)?.fresh);
  stale.sort((a, b) => {
    const byAttempt = (status.get(a.postal)?.lastAttempt ?? '').localeCompare(status.get(b.postal)?.lastAttempt ?? '');
    return byAttempt || a.postal.localeCompare(b.postal);
  });
  return stale[0];
}

/**
 * The hourly Sunday job. Refreshes the one postal code that is stale this week, if there is one. Old plans and
 * ticks are deleted in the last run of the day (23:00 UTC), or on any run that has nothing to refresh.
 */
export async function runScheduledIngest(
  env: IngestEnv,
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
  opts: Partial<FlippOptions> = {},
): Promise<{ postal: string | null; summary: IngestRunSummary | null; pruned: { plans: number; checks: number } | null }> {
  const targets = await postalTargets(env.DB);
  const next = pickStalestPostal(targets, await postalStatus(env.DB, planWeekOf(now)));
  if (!next) {
    return { postal: null, summary: null, pruned: await pruneWeeksBefore(env.DB, retentionCutoff(now)) };
  }
  let summary: IngestRunSummary | null = null;
  let pruned: { plans: number; checks: number } | null = null;
  try {
    summary = await runIngest(env, next.postal, next.stores, fetchImpl, opts);
  } finally {
    if (now.getUTCHours() === 23) pruned = await pruneWeeksBefore(env.DB, retentionCutoff(now));
  }
  return { postal: next.postal, summary, pruned };
}

/** Minutes left before a manual refresh of this postal code is allowed. Zero when it is allowed now. */
export async function refreshWaitMinutes(db: D1Database, postal: string, now: Date): Promise<number> {
  const last = await db
    .prepare('SELECT started_at FROM ingest_runs WHERE postal_code = ? ORDER BY started_at DESC LIMIT 1')
    .bind(postal)
    .first<{ started_at: string }>();
  if (!last) return 0;
  const elapsed = now.getTime() - Date.parse(last.started_at);
  if (!Number.isFinite(elapsed) || elapsed >= REFRESH_COOLDOWN_MS) return 0;
  return Math.max(1, Math.ceil((REFRESH_COOLDOWN_MS - Math.max(0, elapsed)) / 60_000));
}
