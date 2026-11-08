import { Hono, type Context } from 'hono';
import {
  CheckBulkSchema,
  CheckPutSchema,
  HouseholdSchema,
  INGREDIENT_BY_ID,
  MealStatusInputSchema,
  PantryCreateSchema,
  PantryFromPlanSchema,
  PantryPatchSchema,
  normalizeAllergies,
  nextGuestIds,
  PlanRequestSchema,
  type PlanRequest,
  RatingInputSchema,
  SwapRequestSchema,
  readStoredPlan,
  ReceiptCommitSchema,
  defaultExpiry,
  defaultHousehold,
  PLAN_WINDOW_MESSAGE,
  isPlannableWeek,
  isSundayIso,
  alwaysBuyId,
  blockedIds,
  matchFlyerItem,
  newId,
  planReceiptCommit,
  planWeekOf,
  ratingSignals,
  recentDinnerNames,
  addDaysIso,
  scoreDeals,
  torontoDate,
  usageCapsFrom,
  usageMonth,
  type Deal,
  type FlyerItem,
  type Household,
  type MatchedItem,
  type MealPlan,
  type PantryItem,
  type PriceSource,
  type Rating,
  type UsageKind,
  estimateOffers,
  SITE_BANNER_IDS,
  isSiteBanner,
  normalizePostalCode,
  siteOffers,
  type Offer,
} from '@provisions/shared';
import type { ZodError } from 'zod';
import flyerFixture from '../fixtures/flyer-sample.json';
import historyFixture from '../fixtures/history-sample.json';
import {
  commitReceiptRows,
  currentFlyerItems,
  overlappingFlyerItems,
  insertMissingChecks,
  deletePantryItem,
  flyerCountsForDate,
  householdReceiptPrices,
  insertFlyerItems,
  insertPantryItem,
  insertPriceHistory,
  clearWeekStatuses,
  deleteMealStatus,
  loadStatusesBetween,
  loadWeekStatuses,
  upsertMealStatus,
  latestIngestRun,
  loadChecks,
  loadHousehold,
  loadPantry,
  loadPantryItem,
  loadPlan,
  loadPlanData,
  RATING_WINDOW_DAYS,
  loadRatings,
  plansBetween,
  priceHistory,
  saveHouseholdDocument,
  savePlan,
  setCheck,
  sitePriceRows,
  undoPlan,
  updatePantryItem,
  upsertRating,
  type HistoryInsert,
} from './db';
import { anthropicClient, anthropicPrepClient } from './planner/claude';
import { enabledStores, notRunSummary, refreshWaitMinutes, runIngest, runScheduledIngest } from './ingest';
import { attachPrep } from './planner/prep';
import { runPlanner, type PlanProgress } from './planner/run';
import { runSwap } from './planner/swap';
import { MAX_RECEIPT_IMAGE_CHARS, parseReceiptImage } from './receipts';
import { authRoutes, type AuthEnv } from './auth';
import { requireSession, type SessionVars } from './authMiddleware';
import { householdRoutes } from './householdRoutes';
import { accessRoutes } from './accessRoutes';
import { feedbackRoutes, planFeedback } from './feedbackRoutes';
import { tntSyncRoutes } from './tntSyncRoutes';
import { tntLocations } from './tntSync';
import { capMessage, recordUsage } from './usage';
import { householdHasAdmin } from './access';
import { storeSyncReadings } from './storeSync';
import { SITE_BUDGET, SITE_PRICE_DAYS, SCHEDULED_SUBREQUEST_LIMIT, cachedLocations, runScheduledSite, runSitePrices, siteStatus, siteTargets, siteWaitMinutes } from './sitePrices';
import { rankStores, originPoint, type Candidate } from './locationSearch';

type Env = AuthEnv & {
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY?: string;
  PLANNER_MODEL?: string;
  PREP_MODEL?: string;
  RECEIPT_MODEL?: string;
  EXTRACT_MODEL?: string;
  PLAN_CAP_MONTHLY?: string;
  RECEIPT_CAP_MONTHLY?: string;
  PREP_CAP_MONTHLY?: string;
  SWAP_CAP_MONTHLY?: string;
};

const API = '/provisions/api';
const DEFAULT_PLANNER_MODEL = 'claude-sonnet-5-5';
const DEFAULT_PREP_MODEL = 'claude-haiku-5-5';
// Receipt prices this many days old or newer can stand in for a flyer price the household's stores do not run.
const RECEIPT_ESTIMATE_DAYS = 90;
export const app = new Hono<{ Bindings: Env; Variables: SessionVars }>();

// Sign-in is required for every API route except health and /auth/* (checked in the middleware).
app.use(`${API}/*`, requireSession);
app.route(`${API}/auth`, authRoutes);
app.route(API, householdRoutes);
app.route(API, accessRoutes);
app.route(API, feedbackRoutes);
app.route(API, tntSyncRoutes);

function formatZod(error: ZodError): string {
  return error.issues
    .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
    .join('; ');
}

/** The household's postal code as flyer rows and Flipp searches store it: no space. Undefined when there is none. */
const flyerPostal = (household: Household): string | undefined =>
  household.postalCode ? (normalizePostalCode(household.postalCode) ?? undefined) : undefined;

/**
 * The flyer items that price a week starting on `weekOf`, for a postal code. The flyers valid that Sunday come
 * first. When none are out yet, the flyers that overlap the week are used, and then the flyers valid today.
 * A household with no postal code has no flyers.
 */
async function flyerItemsFor(
  db: D1Database,
  postalCode: string | undefined,
  weekOf: string,
  today: string,
): Promise<{ items: FlyerItem[]; source: PriceSource }> {
  if (!postalCode) return { items: [], source: 'current' };
  const onDay = await currentFlyerItems(db, postalCode, weekOf);
  if (onDay.length > 0) return { items: onDay, source: 'week' };
  const overlap = await overlappingFlyerItems(db, postalCode, weekOf, addDaysIso(weekOf, 6));
  if (overlap.length > 0) return { items: overlap, source: 'overlap' };
  return { items: await currentFlyerItems(db, postalCode, today), source: 'current' };
}

/**
 * Matched and scored flyer items for a shopping date, from the household's enabled stores. Used by /deals and
 * the planner. Also returns the household and the never-buy ingredient ids. The planner passes the plan week's
 * Sunday, so the week is priced from the flyers valid that day.
 */
async function loadDeals(
  env: Env,
  householdId: string,
  date: string,
): Promise<{
  household: Household;
  matched: MatchedItem[];
  unmatched: string[];
  deals: Deal[];
  neverBuy: string[];
  priceSource: PriceSource;
  estimates: Offer[]; // site prices from the last 14 days, then receipt prices from the last 90 days, where no flyer prices a store
}> {
  const household = await loadHousehold(env.DB, householdId);
  // What the household last paid at each store, from its receipts. Estimates only where no flyer prices that store.
  const today = torontoDate();
  const estimateFrom = addDaysIso(today, -RECEIPT_ESTIMATE_DAYS);
  // The flyers, the price history and the store prices depend only on the household and the date, so they load together.
  // A store's regular site price (its location picked in Household) comes before a receipt price for the same store.
  const [{ items: flyerItems, source: priceSource }, history, sitePrices, receipts] = await Promise.all([
    flyerItemsFor(env.DB, flyerPostal(household), date, today),
    priceHistory(env.DB, householdId, addDaysIso(date, -56)),
    sitePriceRows(
      env.DB,
      [...siteTargets(household).map((t) => ({ store: t.store.name, storeId: t.storeId })), ...tntLocations(household)],
      addDaysIso(today, -SITE_PRICE_DAYS),
    ),
    householdReceiptPrices(env.DB, householdId, estimateFrom, today),
  ]);

  // Only enabled stores count. If none are enabled, every store in the flyer is used.
  const enabled = new Set(household.stores.filter((s) => s.enabled).map((s) => s.name));
  const inScope = enabled.size > 0 ? flyerItems.filter((i) => enabled.has(i.store)) : flyerItems;

  const matched: MatchedItem[] = [];
  const unmatched: string[] = [];
  for (const item of inScope) {
    const m = matchFlyerItem(item);
    if (m) matched.push(m);
    else unmatched.push(item.rawName);
  }

  const estimates = [
    ...siteOffers(sitePrices, addDaysIso(today, -SITE_PRICE_DAYS), today),
    ...estimateOffers(receipts, estimateFrom, today),
  ];

  // Item rules name foods in free text. A never-buy name blocks every ingredient it covers, less the ones the
  // household un-ticked. An always-buy name keeps its single best match.
  const itemRules = (rule: 'always' | 'never') => household.itemRules.filter((r) => r.rule === rule);
  const neverBuy = [...new Set(itemRules('never').flatMap(blockedIds))];
  const alwaysBuy = itemRules('always')
    .map((r) => alwaysBuyId(r.name))
    .filter((id): id is string => id !== undefined);

  const allergens = [...new Set(household.people.flatMap((p) => p.allergies))];

  const deals = scoreDeals(matched, {
    history,
    neverBuy,
    alwaysBuy,
    allergens,
    shoppingDate: date,
    householdSize: Math.max(1, household.people.length),
  });

  return { household, matched, unmatched, deals, neverBuy, priceSource, estimates };
}

/** A 429 for a household that has used up a monthly cap, or null when it may go ahead. */
async function overCap(env: Env, householdId: string, kind: UsageKind): Promise<Response | null> {
  // An admin's household is never refused. Its calls are still counted in recordUsage.
  if (await householdHasAdmin(env.DB, env, householdId)) return null;
  const today = torontoDate();
  const message = await capMessage(env.DB, householdId, kind, usageCapsFrom(env), usageMonth(today));
  return message ? new Response(message, { status: 429 }) : null;
}

/** Why a week's plan cannot be changed, or null when it can: a Sunday this week or up to WEEKS_AHEAD weeks ahead. */
function planWeekError(weekOf: string, now: Date): string | null {
  if (!isSundayIso(weekOf)) return 'weekOf must be a Sunday (YYYY-MM-DD)';
  return isPlannableWeek(weekOf, now) ? null : PLAN_WINDOW_MESSAGE;
}

/** A progress or result event, written to the response as one JSON line. */
type Emit = (event: object) => void;
const noEmit: Emit = () => {};

/** The client asked for progress lines (`Accept: application/x-ndjson`). Otherwise the response is one JSON document. */
function wantsNdjson(c: Context): boolean {
  return (c.req.header('accept') ?? '').includes('application/x-ndjson');
}

/**
 * A streamed response of JSON lines. `work` emits progress as it goes and returns the final event, which is written
 * last. A failure is written as an error event with status 500, since the HTTP status is already sent.
 */
function ndjson(c: Context, work: (emit: Emit) => Promise<object>): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const emit: Emit = (event) => {
    void writer.write(encoder.encode(`${JSON.stringify(event)}\n`)).catch(() => {});
  };
  const finished = work(emit)
    .then((last) => emit(last))
    .catch((e: unknown) => emit({ stage: 'error', status: 500, message: e instanceof Error ? e.message : 'Planner failed' }))
    .finally(() => {
      void writer.close().catch(() => {});
    });
  // Keeps the Worker alive until the stream has finished. Outside a Worker there is no execution context.
  try {
    c.executionCtx.waitUntil(finished);
  } catch {
    // Not running in a Worker (tests call the app directly).
  }
  return new Response(readable, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * Plans a week and saves it. Progress goes to `emit` as the planner works, and the saved plan is returned. Shared by
 * the JSON and the streamed responses of POST /plan.
 */
async function planWeek(env: Env, apiKey: string, householdId: string, request: PlanRequest, emit: Emit): Promise<MealPlan> {
  const today = torontoDate();
  // Plans starting up to 21 days before the week can hold dinners in the 14-day window. None of these depend on each
  // other, so they load together.
  const [deal, earlier, earlierStatuses, pantry, ratingRows, feedback] = await Promise.all([
    loadDeals(env, householdId, request.weekOf),
    plansBetween(env.DB, householdId, addDaysIso(request.weekOf, -21), request.weekOf),
    loadStatusesBetween(env.DB, householdId, addDaysIso(request.weekOf, -21), request.weekOf),
    loadPantry(env.DB, householdId),
    loadRatings(env.DB, householdId, addDaysIso(today, -RATING_WINDOW_DAYS)),
    planFeedback(env.DB, householdId, today),
  ]);
  const { household, matched, deals, neverBuy, priceSource, estimates } = deal;
  const ratings = ratingSignals(ratingRows, household.people, today);
  // One Claude call makes the meals and, when a prep day is set, the prep list.
  const plan = await runPlanner({
    household,
    request,
    deals,
    matched,
    neverBuy,
    recentDinnerNames: recentDinnerNames(earlier, request.weekOf, 14, earlierStatuses),
    pantry,
    ratings,
    feedback,
    today,
    estimates,
    client: anthropicClient(apiKey, env.PLANNER_MODEL ?? DEFAULT_PLANNER_MODEL),
    prepClient: anthropicPrepClient(apiKey, env.PREP_MODEL ?? DEFAULT_PREP_MODEL),
    onProgress: (p: PlanProgress) => emit(p),
  });
  plan.priceSource = priceSource;
  // Next week's flyers are often not out yet; the plan says its prices are estimates.
  if (priceSource === 'current' && request.weekOf > planWeekOf(new Date())) {
    plan.issues.push({
      check: 'prices',
      severity: 'warning',
      message: "Prices are estimates from the current flyer; next week's flyers aren't out yet.",
    });
  }
  // A new plan that replaces one keeps the old one, so the change can be undone.
  emit({ stage: 'saving' });
  await savePlan(env.DB, householdId, plan, await loadPlanData(env.DB, householdId, request.weekOf));
  // The meals are new, so what was marked on the old ones (skipped, made instead, guests) no longer applies.
  await clearWeekStatuses(env.DB, householdId, request.weekOf);
  await recordUsage(env.DB, householdId, 'plan', usageMonth(today));
  return plan;
}

app.get(`${API}/health`, (c) => c.json({ ok: true }));

app.get(`${API}/household`, async (c) => {
  let household: Household;
  try {
    household = await loadHousehold(c.env.DB, c.get('householdId'));
  } catch (e) {
    return c.text(e instanceof Error ? e.message : 'Stored household is invalid', 500);
  }
  return c.json(household);
});

app.put(`${API}/household`, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.text('Body must be JSON', 400);
  }

  const parsed = HouseholdSchema.safeParse(body);
  if (!parsed.success) return c.text(formatZod(parsed.error), 400);

  const saved = await saveHouseholdDocument(c.env.DB, c.get('householdId'), parsed.data, new Date().toISOString());
  if (!saved) return c.text('Household not found', 404);
  return c.json(parsed.data);
});

// Dev only: load the flyer and price-history fixtures. Needs DEV=1 (see .dev.vars.example).
app.post(`${API}/dev/load-fixtures`, async (c) => {
  if (c.env.DEV !== '1') return c.json({ error: 'Not found' }, 404);

  const household = await loadHousehold(c.env.DB, c.get('householdId'));
  const flyerCount = await insertFlyerItems(c.env.DB, flyerPostal(household) ?? '', flyerFixture as FlyerItem[]);
  const historyCount = await insertPriceHistory(c.env.DB, historyFixture as HistoryInsert[]);
  return c.json({ flyerItems: flyerCount, priceHistory: historyCount });
});

// Ranked deals for a shopping date: flyer items matched, scored against history and household rules.
app.get(`${API}/deals`, async (c) => {
  const date = c.req.query('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.text('date must be YYYY-MM-DD', 400);

  const { matched, unmatched, deals } = await loadDeals(c.env, c.get('householdId'), date);
  return c.json({ matched: matched.length, unmatched, deals });
});

app.post(`${API}/plan`, async (c) => {
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) return c.text('Planner not configured: add the ANTHROPIC_API_KEY secret.', 503);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.text('Body must be JSON', 400);
  }
  const parsed = PlanRequestSchema.safeParse(body);
  if (!parsed.success) return c.text(formatZod(parsed.error), 400);
  const request = parsed.data;
  if (!isPlannableWeek(request.weekOf, new Date())) return c.text(PLAN_WINDOW_MESSAGE, 400);

  const householdId = c.get('householdId');
  const capped = await overCap(c.env, householdId, 'plan');
  if (capped) return capped;

  if (wantsNdjson(c)) {
    return ndjson(c, async (emit) => ({ stage: 'done', plan: await planWeek(c.env, apiKey, householdId, request, emit) }));
  }
  try {
    return c.json(await planWeek(c.env, apiKey, householdId, request, noEmit));
  } catch (e) {
    return c.text(e instanceof Error ? e.message : 'Planner failed', 500);
  }
});

// Regenerates only the batch prep for a saved plan, for the household's current prep day (one Haiku call).
app.post(`${API}/plan/:weekOf/prep`, async (c) => {
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) return c.text('Planner not configured: add the ANTHROPIC_API_KEY secret.', 503);
  const weekOf = c.req.param('weekOf');
  if (!isSundayIso(weekOf)) return c.text('weekOf must be a Sunday (YYYY-MM-DD)', 400);

  const householdId = c.get('householdId');
  const capped = await overCap(c.env, householdId, 'prep');
  if (capped) return capped;

  try {
    const plan = await loadPlan(c.env.DB, householdId, weekOf);
    if (!plan) return c.text('No plan for this week', 404);
    const household = await loadHousehold(c.env.DB, householdId);
    if (!household.prepDay) return c.text('Set a prep day in Household first', 400);

    const updated = await attachPrep(
      plan,
      household.prepDay,
      anthropicPrepClient(apiKey, c.env.PREP_MODEL ?? DEFAULT_PREP_MODEL),
      household.storage,
    );
    await savePlan(c.env.DB, householdId, updated);
    await recordUsage(c.env.DB, householdId, 'prep', usageMonth(torontoDate()));
    return c.json(updated);
  } catch (e) {
    return c.text(e instanceof Error ? e.message : 'Prep failed', 500);
  }
});

// Swaps the chosen meals of a saved week, and the meals linked to them by leftovers. The rest of the week is kept
// as it is. Counted as a swap; the plan it replaces is kept for undo.
app.post(`${API}/plan/:weekOf/swap`, async (c) => {
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) return c.text('Planner not configured: add the ANTHROPIC_API_KEY secret.', 503);
  const weekOf = c.req.param('weekOf');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.text('Body must be JSON', 400);
  }
  const parsed = SwapRequestSchema.safeParse(body);
  if (!parsed.success) return c.text(formatZod(parsed.error), 400);
  const weekError = planWeekError(weekOf, new Date());
  if (weekError) return c.text(weekError, 400);

  const householdId = c.get('householdId');
  const capped = await overCap(c.env, householdId, 'swap');
  if (capped) return capped;

  let stored: string;
  let saved: MealPlan;
  try {
    const found = await loadPlanData(c.env.DB, householdId, weekOf);
    if (found === null) return c.text('No plan for this week', 404);
    stored = found;
    saved = readStoredPlan(JSON.parse(stored) as MealPlan) as MealPlan;
  } catch (e) {
    return c.text(e instanceof Error ? e.message : 'Swap failed', 500);
  }
  const known = new Set(saved.meals.map((m) => m.id));
  const unknown = parsed.data.mealIds.find((id) => !known.has(id));
  if (unknown !== undefined) return c.text(`Unknown meal: ${unknown}`, 400);

  // Guests joining the swapped slots get the next free guest ids. Their allergies come with them.
  const guests = parsed.data.guests
    ? { ids: nextGuestIds(saved, parsed.data.guests.count), allergies: normalizeAllergies(parsed.data.guests.allergies) }
    : undefined;

  const swapWeek = async (emit: Emit) => {
    const today = torontoDate();
    const [household, deal, earlier, earlierStatuses, pantry, ratingRows, feedback] = await Promise.all([
      loadHousehold(c.env.DB, householdId),
      loadDeals(c.env, householdId, weekOf),
      plansBetween(c.env.DB, householdId, addDaysIso(weekOf, -21), weekOf),
      loadStatusesBetween(c.env.DB, householdId, addDaysIso(weekOf, -21), weekOf),
      loadPantry(c.env.DB, householdId),
      loadRatings(c.env.DB, householdId, addDaysIso(today, -RATING_WINDOW_DAYS)),
      planFeedback(c.env.DB, householdId, today),
    ]);
    const { matched, deals, neverBuy, estimates } = deal;
    const result = await runSwap({
      household,
      plan: saved,
      mealIds: parsed.data.mealIds,
      note: parsed.data.note,
      guests,
      deals,
      matched,
      neverBuy,
      estimates,
      recentDinnerNames: recentDinnerNames(earlier, weekOf, 14, earlierStatuses),
      pantry,
      ratings: ratingSignals(ratingRows, household.people, today),
      feedback,
      today,
      client: anthropicClient(apiKey, c.env.PLANNER_MODEL ?? DEFAULT_PLANNER_MODEL),
      onProgress: (p: PlanProgress) => emit(p),
    });
    emit({ stage: 'saving' });
    await savePlan(c.env.DB, householdId, result.plan, stored);
    // Swapped meals are new: their marks go. Their ids may be reused by the new meals, so they must not carry over.
    await clearWeekStatuses(c.env.DB, householdId, weekOf, result.swapped);
    await recordUsage(c.env.DB, householdId, 'swap', usageMonth(today));
    return result;
  };

  if (wantsNdjson(c)) {
    return ndjson(c, async (emit) => {
      const result = await swapWeek(emit);
      return { stage: 'done', plan: result.plan, swapped: result.swapped, added: result.added };
    });
  }
  try {
    const result = await swapWeek(noEmit);
    return c.json({ ...result.plan, swapped: result.swapped, added: result.added });
  } catch (e) {
    return c.text(e instanceof Error ? e.message : 'Swap failed', 500);
  }
});

// Undoes the last change to a week's plan (a swap or a new plan): the plan and the one it replaced trade places.
app.post(`${API}/plan/:weekOf/undo`, async (c) => {
  const weekOf = c.req.param('weekOf');
  const weekError = planWeekError(weekOf, new Date());
  if (weekError) return c.text(weekError, 400);
  const householdId = c.get('householdId');
  if (!(await undoPlan(c.env.DB, householdId, weekOf))) return c.text('Nothing to undo for this week', 404);
  const plan = await loadPlan(c.env.DB, householdId, weekOf);
  return plan ? c.json(plan) : c.text('No plan for this week', 404);
});

// ---- Flyer import (milestone 4) ----

// Searches Flipp for the household's postal code now. Takes up to a minute or so. Limited to once per 10
// minutes per postal code, since the flyers for a postal code do not change that often.
app.post(`${API}/flyers/refresh`, async (c) => {
  const household = await loadHousehold(c.env.DB, c.get('householdId'));
  const postal = flyerPostal(household);
  if (!postal) return c.json(notRunSummary('Add a postal code in Household first.'));
  const stores = enabledStores(household);
  if (stores.length === 0) return c.json(notRunSummary('Turn on at least one store in Household first.'));

  const wait = await refreshWaitMinutes(c.env.DB, postal, new Date());
  if (wait > 0) {
    return c.text(
      `Flyers for this postal code were refreshed a few minutes ago. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`,
      429,
    );
  }
  try {
    return c.json(await runIngest(c.env, postal, stores));
  } catch (e) {
    return c.text(e instanceof Error ? e.message : 'Flyer refresh failed', 500);
  }
});

// The latest run and the prices valid today, for the household's postal code. ?debug=1 adds the run's sample and flyers.
app.get(`${API}/flyers/status`, async (c) => {
  const household = await loadHousehold(c.env.DB, c.get('householdId'));
  const postal = flyerPostal(household);
  if (!postal) return c.json({ lastRun: null, currentItems: [] });
  const lastRun = await latestIngestRun(c.env.DB, postal, { debug: c.req.query('debug') === '1' });
  const currentItems = await flyerCountsForDate(c.env.DB, postal, torontoDate());
  return c.json({ lastRun, currentItems });
});

// ---- Regular prices from the Loblaw-family sites (migration 0012) ----

const SITE_AUTH_MESSAGE = "Loblaw's site needs a PC id sign-in for store search, so store locations aren't available yet.";

// The store locations of a Loblaw-family banner: the ones that match the search text, or the nearest to a postal code.
// q is a street, city, name or postal code; near is the household's postal code (used for an empty search, and for
// distances on a text search). Cached for a week. When the site lists no locations for the banner (or refuses the
// listing), the answer is 200 with unsupported set, and the picker offers a store number instead. T&T is not a banner here.
app.get(`${API}/site-stores/:banner/locations`, async (c) => {
  const banner = c.req.param('banner');
  if (!isSiteBanner(banner)) return c.text('Unknown store chain', 400);
  const q = (c.req.query('q') ?? '').slice(0, 60);
  const near = (c.req.query('near') ?? '').slice(0, 12);
  if (q.trim() === '' && near.trim() === '') return c.json({ locations: [] });
  const now = new Date();
  const got = await cachedLocations(c.env.DB, banner, fetch, now);
  if (!got.ok) {
    if (got.error.kind === 'auth') return c.text(SITE_AUTH_MESSAGE, 409);
    return c.json({ locations: [], unsupported: true, status: got.error.status ?? null });
  }
  const origin = await originPoint(c.env.DB, fetch, now, q, near);
  const hits = rankStores(
    got.value.map((loc) => ({ banner, loc })),
    q,
    origin,
  );
  return c.json({
    locations: hits.map(({ storeId, label, postalCode, distanceKm }) => ({
      storeId,
      label,
      postalCode,
      ...(distanceKm !== undefined ? { distanceKm } : {}),
    })),
    ...(origin?.approx ? { approx: true } : {}),
  });
});

// The locations of every banner the app searches, for one search. A text search lists the matches by name, street,
// city or postal code; a postal code or an empty search lists the nearest to that postal code (or, when empty, to the
// household's). Banners whose list cannot be read are named in unavailable. T&T is not searched (its site blocks lookups).
app.get(`${API}/site-stores/search`, async (c) => {
  const q = (c.req.query('q') ?? '').slice(0, 60);
  const near = (c.req.query('near') ?? '').slice(0, 12);
  if (q.trim() === '' && near.trim() === '') return c.json({ locations: [], unavailable: [] });
  const now = new Date();
  const origin = await originPoint(c.env.DB, fetch, now, q, near);
  if (q.trim() === '' && origin === null) return c.json({ locations: [], unavailable: [] });
  const candidates: Candidate[] = [];
  const unavailable: string[] = [];
  for (const banner of SITE_BANNER_IDS) {
    const got = await cachedLocations(c.env.DB, banner, fetch, now);
    if (!got.ok) {
      unavailable.push(banner);
      continue;
    }
    for (const loc of got.value) candidates.push({ banner, loc });
  }
  return c.json({
    locations: rankStores(candidates, q, origin),
    unavailable,
    ...(origin?.approx ? { approx: true } : {}),
  });
});

// Reads the regular prices of the household's stores now. Limited to once per 10 minutes per household.
app.post(`${API}/site-prices/refresh`, async (c) => {
  const householdId = c.get('householdId');
  const household = await loadHousehold(c.env.DB, householdId);
  if (siteTargets(household).length === 0) {
    return c.json({ ok: false, lookups: 0, matched: 0, errors: ['Pick a store location for regular prices first.'], authNeeded: false });
  }
  const wait = await siteWaitMinutes(c.env.DB, householdId, new Date());
  if (wait > 0) {
    return c.text(`Regular prices were refreshed a few minutes ago. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`, 429);
  }
  try {
    return c.json(await runSitePrices(c.env, householdId, fetch, SITE_BUDGET, new Date()));
  } catch (e) {
    return c.text(e instanceof Error ? e.message : 'Regular price refresh failed', 500);
  }
});

// The latest run and the prices read in the last two weeks. ?debug=1 adds the run's sample of raw results.
app.get(`${API}/site-prices/status`, async (c) => {
  const householdId = c.get('householdId');
  const household = await loadHousehold(c.env.DB, householdId);
  return c.json(await siteStatus(c.env.DB, householdId, household, new Date(), c.req.query('debug') === '1'));
});

// When each price source last read each store (its flyers, regular prices and T&T prices). The app works out the state.
app.get(`${API}/stores/sync`, async (c) => {
  const householdId = c.get('householdId');
  const household = await loadHousehold(c.env.DB, householdId);
  return c.json({ stores: await storeSyncReadings(c.env.DB, householdId, household, new Date()) });
});

// ---- Pantry (milestone 3A) ----

app.get(`${API}/pantry`, async (c) => {
  return c.json(await loadPantry(c.env.DB, c.get('householdId')));
});

// The unit comes from the catalogue. Expiry defaults from the ingredient's shelf life.
app.post(`${API}/pantry`, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.text('Body must be JSON', 400);
  }
  const parsed = PantryCreateSchema.safeParse(body);
  if (!parsed.success) return c.text(formatZod(parsed.error), 400);

  const { ingredientId, qty } = parsed.data;
  const catalog = INGREDIENT_BY_ID[ingredientId];
  if (!catalog) return c.text(`Unknown ingredient: ${ingredientId}`, 400);

  const addedOn = parsed.data.addedOn ?? torontoDate();
  const item: PantryItem = {
    id: newId(),
    ingredientId,
    qty,
    unit: catalog.baseUnit,
    addedOn,
    expiresOn: parsed.data.expiresOn ?? defaultExpiry(ingredientId, addedOn),
    source: 'manual',
  };
  await insertPantryItem(c.env.DB, c.get('householdId'), item);
  return c.json(item, 201);
});

app.patch(`${API}/pantry/:id`, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.text('Body must be JSON', 400);
  }
  const parsed = PantryPatchSchema.safeParse(body);
  if (!parsed.success) return c.text(formatZod(parsed.error), 400);

  const householdId = c.get('householdId');
  const current = await loadPantryItem(c.env.DB, householdId, c.req.param('id'));
  if (!current) return c.text('No pantry item with that id', 404);

  const item: PantryItem = {
    ...current,
    qty: parsed.data.qty ?? current.qty,
    expiresOn: parsed.data.expiresOn ?? current.expiresOn,
  };
  await updatePantryItem(c.env.DB, householdId, item);
  return c.json(item);
});

app.delete(`${API}/pantry/:id`, async (c) => {
  const removed = await deletePantryItem(c.env.DB, c.get('householdId'), c.req.param('id'));
  if (!removed) return c.text('No pantry item with that id', 404);
  return c.json({ ok: true });
});

// ---- Meal ratings (milestone 3A) ----

app.get(`${API}/ratings`, async (c) => {
  return c.json(await loadRatings(c.env.DB, c.get('householdId')));
});

// Upserts by meal name and person. The date is today on the Toronto calendar.
app.post(`${API}/ratings`, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.text('Body must be JSON', 400);
  }
  const parsed = RatingInputSchema.safeParse(body);
  if (!parsed.success) return c.text(formatZod(parsed.error), 400);

  const householdId = c.get('householdId');
  const household = await loadHousehold(c.env.DB, householdId);
  if (!household.people.some((p) => p.id === parsed.data.personId)) {
    return c.text(`Unknown person: ${parsed.data.personId}`, 400);
  }

  const rating: Rating = { id: newId(), date: torontoDate(), ...parsed.data };
  await upsertRating(c.env.DB, householdId, rating);
  return c.json(rating, 201);
});

// The saved plan, and the statuses marked on its meals ("Didn't go to plan?"), by meal id.
app.get(`${API}/plan/:weekOf`, async (c) => {
  const weekOf = c.req.param('weekOf');
  if (!isSundayIso(weekOf)) return c.text('weekOf must be a Sunday (YYYY-MM-DD)', 400);
  const householdId = c.get('householdId');
  const plan = await loadPlan(c.env.DB, householdId, weekOf);
  if (!plan) return c.text('No plan for this week', 404);
  return c.json({ ...plan, statuses: await loadWeekStatuses(c.env.DB, householdId, weekOf) });
});

// Marks a planned meal as skipped, or as made something else, or notes guests joining it. Replaces the meal's row.
// Any week with a saved plan, past weeks too: the record is what happened.
app.put(`${API}/plan/:weekOf/meals/:mealId/status`, async (c) => {
  const weekOf = c.req.param('weekOf');
  if (!isSundayIso(weekOf)) return c.text('weekOf must be a Sunday (YYYY-MM-DD)', 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.text('Body must be JSON', 400);
  }
  const parsed = MealStatusInputSchema.safeParse(body);
  if (!parsed.success) return c.text(formatZod(parsed.error), 400);

  const householdId = c.get('householdId');
  const mealId = c.req.param('mealId');
  const plan = await loadPlan(c.env.DB, householdId, weekOf);
  if (!plan) return c.text('No plan for this week', 404);
  if (!plan.meals.some((m) => m.id === mealId)) return c.text('No such meal in this week', 404);

  const status = parsed.data;
  await upsertMealStatus(c.env.DB, householdId, weekOf, mealId, status, new Date().toISOString());
  return c.json(status);
});

// Clears a meal's mark: it went to plan after all.
app.delete(`${API}/plan/:weekOf/meals/:mealId/status`, async (c) => {
  const weekOf = c.req.param('weekOf');
  if (!isSundayIso(weekOf)) return c.text('weekOf must be a Sunday (YYYY-MM-DD)', 400);
  const householdId = c.get('householdId');
  const plan = await loadPlan(c.env.DB, householdId, weekOf);
  if (!plan) return c.text('No plan for this week', 404);
  await deleteMealStatus(c.env.DB, householdId, weekOf, c.req.param('mealId'));
  return c.json({ ok: true });
});

// Puts the unused amounts of a planned meal's ingredients into the pantry, from the catalogue's shelf life.
// Each item must be an ingredient of that meal. Added as plan leftovers.
app.post(`${API}/plan/:weekOf/meals/:mealId/to-pantry`, async (c) => {
  const weekOf = c.req.param('weekOf');
  if (!isSundayIso(weekOf)) return c.text('weekOf must be a Sunday (YYYY-MM-DD)', 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.text('Body must be JSON', 400);
  }
  const parsed = PantryFromPlanSchema.safeParse(body);
  if (!parsed.success) return c.text(formatZod(parsed.error), 400);

  const householdId = c.get('householdId');
  const plan = await loadPlan(c.env.DB, householdId, weekOf);
  if (!plan) return c.text('No plan for this week', 404);
  const meal = plan.meals.find((m) => m.id === c.req.param('mealId'));
  if (!meal) return c.text('No such meal in this week', 404);

  const addedOn = torontoDate();
  const added: PantryItem[] = [];
  for (const { ingredientId, qty } of parsed.data.items) {
    const catalog = INGREDIENT_BY_ID[ingredientId];
    if (!catalog) return c.text(`Unknown ingredient: ${ingredientId}`, 400);
    if (!meal.ingredients.some((i) => i.ingredientId === ingredientId)) {
      return c.text(`${catalog.name} is not an ingredient of that meal`, 400);
    }
    added.push({
      id: newId(),
      ingredientId,
      qty,
      unit: catalog.baseUnit,
      addedOn,
      expiresOn: defaultExpiry(ingredientId, addedOn),
      source: 'plan-leftover',
    });
  }
  for (const item of added) await insertPantryItem(c.env.DB, householdId, item);
  return c.json({ added }, 201);
});

// ---- Shopping and prep ticks, shared across the household ----

// Every tick saved for the week.
app.get(`${API}/checks/:weekOf`, async (c) => {
  const weekOf = c.req.param('weekOf');
  if (!isSundayIso(weekOf)) return c.text('weekOf must be a Sunday (YYYY-MM-DD)', 400);
  return c.json(await loadChecks(c.env.DB, c.get('householdId'), weekOf));
});

// Sets one tick. Last write wins; the row records the signed-in address and the time.
app.put(`${API}/checks/:weekOf`, async (c) => {
  const weekOf = c.req.param('weekOf');
  if (!isSundayIso(weekOf)) return c.text('weekOf must be a Sunday (YYYY-MM-DD)', 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.text('Body must be JSON', 400);
  }
  const parsed = CheckPutSchema.safeParse(body);
  if (!parsed.success) return c.text(formatZod(parsed.error), 400);

  const updatedAt = new Date().toISOString();
  await setCheck(
    c.env.DB,
    c.get('householdId'),
    weekOf,
    parsed.data.kind,
    parsed.data.itemId,
    parsed.data.checked,
    c.get('email'),
    updatedAt,
  );
  return c.json({ updatedAt });
});

// One-time move of ticks saved in a browser before they synced. Never overwrites a saved tick.
app.post(`${API}/checks/:weekOf/bulk`, async (c) => {
  const weekOf = c.req.param('weekOf');
  if (!isSundayIso(weekOf)) return c.text('weekOf must be a Sunday (YYYY-MM-DD)', 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.text('Body must be JSON', 400);
  }
  const parsed = CheckBulkSchema.safeParse(body);
  if (!parsed.success) return c.text(formatZod(parsed.error), 400);

  const received = await insertMissingChecks(
    c.env.DB,
    c.get('householdId'),
    weekOf,
    parsed.data,
    c.get('email'),
    new Date().toISOString(),
  );
  return c.json({ received });
});

// ---- Receipts (milestone 3B) ----

// Reads a receipt photo (base64 JPEG) into structured lines. Nothing is saved until commit.
app.post(`${API}/receipts/parse`, async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) {
    return c.text('Receipt reader not configured: add the ANTHROPIC_API_KEY secret.', 503);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.text('Body must be JSON', 400);
  }
  const image = (body as { image?: unknown } | null)?.image;
  if (typeof image !== 'string' || image.length === 0 || image.length > MAX_RECEIPT_IMAGE_CHARS) {
    return c.text('Missing or oversized image', 400);
  }

  const householdId = c.get('householdId');
  const capped = await overCap(c.env, householdId, 'receipt');
  if (capped) return capped;

  const result = await parseReceiptImage(image, c.env);
  if (!result.ok) return c.text(result.message, result.status);
  await recordUsage(c.env.DB, householdId, 'receipt', usageMonth(torontoDate()));
  return c.json(result.receipt);
});

// Saves a confirmed receipt: prices for each line, confirmed matches, and pantry items.
app.post(`${API}/receipts/commit`, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.text('Body must be JSON', 400);
  }
  const parsed = ReceiptCommitSchema.safeParse(body);
  if (!parsed.success) return c.text(formatZod(parsed.error), 400);

  const unknown = parsed.data.lines.find((l) => !INGREDIENT_BY_ID[l.ingredientId]);
  if (unknown) return c.text(`Unknown ingredient: ${unknown.ingredientId}`, 400);

  const rows = planReceiptCommit(parsed.data, torontoDate(), newId);
  const counts = await commitReceiptRows(c.env.DB, c.get('householdId'), rows, new Date().toISOString());
  return c.json(counts, 201);
});

// Everything else: static assets, with SPA fallback for /provisions/* routes.
app.all('*', async (c) => {
  const url = new URL(c.req.url);
  if (url.pathname.startsWith(API)) return c.json({ error: 'Not found' }, 404);

  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (
    res.status === 404 &&
    url.pathname.startsWith('/provisions') &&
    !/\.[^/]+$/.test(url.pathname)
  ) {
    return c.env.ASSETS.fetch(new Request(new URL('/provisions/', url), c.req.raw));
  }
  return res;
});

/**
 * The Sunday job (hourly on Sundays, see wrangler.jsonc). Refreshes the flyers for one postal code that is
 * stale this week, and deletes plans and ticks past the retention window in the last run of the day.
 */
export async function runSunday(env: Env, now: Date = new Date()) {
  const flyers = await runScheduledIngest(env, now);
  // The flyer run and the regular-price batch share one invocation, so the batch gets what the flyers left.
  const site = await runScheduledSite(env, now, fetch, Math.min(SITE_BUDGET, SCHEDULED_SUBREQUEST_LIMIT - (flyers.summary?.requests ?? 0)));
  return { ...flyers, site };
}

// The scheduled job refreshes the flyers. Fetch serves the Hono app as before.
export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runSunday(env, new Date(event.scheduledTime)));
  },
};
