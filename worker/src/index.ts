import { Hono } from 'hono';
import {
  CheckBulkSchema,
  CheckPutSchema,
  HouseholdSchema,
  INGREDIENT_BY_ID,
  PantryCreateSchema,
  PantryPatchSchema,
  PlanRequestSchema,
  RatingInputSchema,
  ReceiptCommitSchema,
  defaultExpiry,
  defaultHousehold,
  PLAN_WINDOW_MESSAGE,
  isPlannableWeek,
  isSundayIso,
  matchFlyerItem,
  matchIngredient,
  newId,
  planReceiptCommit,
  planWeekOf,
  ratingSignals,
  retentionCutoff,
  recentDinnerNames,
  addDaysIso,
  scoreDeals,
  torontoDate,
  type Deal,
  type IngestRunSummary,
  type PriceSource,
  type FlyerItem,
  type Household,
  type MatchedItem,
  type PantryItem,
  type Rating,
} from '@provisions/shared';
import type { ZodError } from 'zod';
import flyerFixture from '../fixtures/flyer-sample.json';
import historyFixture from '../fixtures/history-sample.json';
import {
  commitReceiptRows,
  currentFlyerItems,
  overlappingFlyerItems,
  pruneWeeksBefore,
  insertMissingChecks,
  deletePantryItem,
  flyerCountsForDate,
  insertFlyerItems,
  insertPantryItem,
  insertPriceHistory,
  latestIngestRun,
  loadChecks,
  loadHousehold,
  loadPantry,
  loadPantryItem,
  loadPlan,
  loadRatings,
  plansBetween,
  priceHistory,
  savePlan,
  setCheck,
  updatePantryItem,
  upsertRating,
  type HistoryInsert,
} from './db';
import { anthropicClient, anthropicPrepClient } from './planner/claude';
import { runIngest } from './ingest';
import { attachPrep } from './planner/prep';
import { runPlanner } from './planner/run';
import { MAX_RECEIPT_IMAGE_CHARS, parseReceiptImage } from './receipts';
import { authRoutes, type AuthEnv } from './auth';
import { requireSession, type SessionVars } from './authMiddleware';

type Env = AuthEnv & {
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY?: string;
  PLANNER_MODEL?: string;
  PREP_MODEL?: string;
  RECEIPT_MODEL?: string;
  EXTRACT_MODEL?: string;
};

const API = '/provisions/api';
const DEFAULT_PLANNER_MODEL = 'claude-sonnet-5-5';
const DEFAULT_PREP_MODEL = 'claude-haiku-5-5';
export const app = new Hono<{ Bindings: Env; Variables: SessionVars }>();

// Sign-in is required for every API route except health and /auth/* (checked in the middleware).
app.use(`${API}/*`, requireSession);
app.route(`${API}/auth`, authRoutes);

function formatZod(error: ZodError): string {
  return error.issues
    .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
    .join('; ');
}

/**
 * The flyer items that price a week starting on `weekOf`. The flyers valid that Sunday come first. When
 * none are out yet, the flyers that overlap the week are used, and then the flyers valid today.
 */
async function flyerItemsFor(
  db: D1Database,
  weekOf: string,
  today: string,
): Promise<{ items: FlyerItem[]; source: PriceSource }> {
  const onDay = await currentFlyerItems(db, weekOf);
  if (onDay.length > 0) return { items: onDay, source: 'week' };
  const overlap = await overlappingFlyerItems(db, weekOf, addDaysIso(weekOf, 6));
  if (overlap.length > 0) return { items: overlap, source: 'overlap' };
  return { items: await currentFlyerItems(db, today), source: 'current' };
}

/**
 * Matched and scored flyer items for a shopping date, from enabled stores. Used by /deals and the
 * planner. Also returns the household and the never-buy ingredient ids. The planner passes the
 * plan week's Sunday, so the week is priced from the flyers valid that day.
 */
async function loadDeals(
  env: Env,
  date: string,
): Promise<{
  household: Household;
  matched: MatchedItem[];
  unmatched: string[];
  deals: Deal[];
  neverBuy: string[];
  priceSource: PriceSource;
}> {
  const household = await loadHousehold(env.DB);
  const { items: flyerItems, source: priceSource } = await flyerItemsFor(env.DB, date, torontoDate());

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

  const history = await priceHistory(env.DB, addDaysIso(date, -56));

  // Item rules name foods in free text. Map each to an ingredient id, skipping names that do not match.
  const ruleIds = (rule: 'always' | 'never') =>
    household.itemRules
      .filter((r) => r.rule === rule)
      .map((r) => matchIngredient(r.name)?.ingredientId)
      .filter((id): id is string => id !== undefined);
  const neverBuy = ruleIds('never');

  const allergens = [...new Set(household.people.flatMap((p) => p.allergies))];

  const deals = scoreDeals(matched, {
    history,
    neverBuy,
    alwaysBuy: ruleIds('always'),
    allergens,
    shoppingDate: date,
    householdSize: Math.max(1, household.people.length),
  });

  return { household, matched, unmatched, deals, neverBuy, priceSource };
}

app.get(`${API}/health`, (c) => c.json({ ok: true }));

app.get(`${API}/household`, async (c) => {
  const row = await c.env.DB.prepare('SELECT data FROM household WHERE id = 1').first<{
    data: string;
  }>();
  if (!row) return c.json(defaultHousehold());

  let raw: unknown;
  try {
    raw = JSON.parse(row.data);
  } catch {
    return c.text('Stored household is not valid JSON', 500);
  }
  const parsed = HouseholdSchema.safeParse(raw);
  if (!parsed.success) return c.text(`Stored household is invalid: ${formatZod(parsed.error)}`, 500);
  return c.json(parsed.data);
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

  await c.env.DB.prepare(
    `INSERT INTO household (id, data, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  )
    .bind(JSON.stringify(parsed.data), new Date().toISOString())
    .run();

  return c.json(parsed.data);
});

// Dev only: load the flyer and price-history fixtures. Needs DEV=1 (see .dev.vars.example).
app.post(`${API}/dev/load-fixtures`, async (c) => {
  if (c.env.DEV !== '1') return c.json({ error: 'Not found' }, 404);

  const flyerCount = await insertFlyerItems(c.env.DB, flyerFixture as FlyerItem[]);
  const historyCount = await insertPriceHistory(c.env.DB, historyFixture as HistoryInsert[]);
  return c.json({ flyerItems: flyerCount, priceHistory: historyCount });
});

// Ranked deals for a shopping date: flyer items matched, scored against history and household rules.
app.get(`${API}/deals`, async (c) => {
  const date = c.req.query('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.text('date must be YYYY-MM-DD', 400);

  const { matched, unmatched, deals } = await loadDeals(c.env, date);
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

  try {
    const { household, matched, deals, neverBuy, priceSource } = await loadDeals(c.env, request.weekOf);
    // Plans starting up to 21 days before the week can hold dinners in the 14-day window.
    const earlier = await plansBetween(c.env.DB, addDaysIso(request.weekOf, -21), request.weekOf);
    const today = torontoDate();
    const pantry = await loadPantry(c.env.DB);
    const ratings = ratingSignals(await loadRatings(c.env.DB), household.people, today);
    // One Claude call makes the meals and, when a prep day is set, the prep list.
    const plan = await runPlanner({
      household,
      request,
      deals,
      matched,
      neverBuy,
      recentDinnerNames: recentDinnerNames(earlier, request.weekOf),
      pantry,
      ratings,
      today,
      client: anthropicClient(apiKey, c.env.PLANNER_MODEL ?? DEFAULT_PLANNER_MODEL),
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
    await savePlan(c.env.DB, plan);
    return c.json(plan);
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

  try {
    const plan = await loadPlan(c.env.DB, weekOf);
    if (!plan) return c.text('No plan for this week', 404);
    const household = await loadHousehold(c.env.DB);
    if (!household.prepDay) return c.text('Set a prep day in Household first', 400);

    const updated = await attachPrep(
      plan,
      household.prepDay,
      anthropicPrepClient(apiKey, c.env.PREP_MODEL ?? DEFAULT_PREP_MODEL),
    );
    await savePlan(c.env.DB, updated);
    return c.json(updated);
  } catch (e) {
    return c.text(e instanceof Error ? e.message : 'Prep failed', 500);
  }
});

// ---- Flyer import (milestone 4) ----

// Searches Flipp now. Takes up to a minute or so.
app.post(`${API}/flyers/refresh`, async (c) => {
  try {
    return c.json(await runIngest(c.env));
  } catch (e) {
    return c.text(e instanceof Error ? e.message : 'Flyer refresh failed', 500);
  }
});

// The latest run and the prices valid today, per store. ?debug=1 adds the run's sample and flyers.
app.get(`${API}/flyers/status`, async (c) => {
  const lastRun = await latestIngestRun(c.env.DB, { debug: c.req.query('debug') === '1' });
  const currentItems = await flyerCountsForDate(c.env.DB, torontoDate());
  return c.json({ lastRun, currentItems });
});

// ---- Pantry (milestone 3A) ----

app.get(`${API}/pantry`, async (c) => {
  return c.json(await loadPantry(c.env.DB));
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
  await insertPantryItem(c.env.DB, item);
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

  const current = await loadPantryItem(c.env.DB, c.req.param('id'));
  if (!current) return c.text('No pantry item with that id', 404);

  const item: PantryItem = {
    ...current,
    qty: parsed.data.qty ?? current.qty,
    expiresOn: parsed.data.expiresOn ?? current.expiresOn,
  };
  await updatePantryItem(c.env.DB, item);
  return c.json(item);
});

app.delete(`${API}/pantry/:id`, async (c) => {
  const removed = await deletePantryItem(c.env.DB, c.req.param('id'));
  if (!removed) return c.text('No pantry item with that id', 404);
  return c.json({ ok: true });
});

// ---- Meal ratings (milestone 3A) ----

app.get(`${API}/ratings`, async (c) => {
  return c.json(await loadRatings(c.env.DB));
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

  const household = await loadHousehold(c.env.DB);
  if (!household.people.some((p) => p.id === parsed.data.personId)) {
    return c.text(`Unknown person: ${parsed.data.personId}`, 400);
  }

  const rating: Rating = { id: newId(), date: torontoDate(), ...parsed.data };
  await upsertRating(c.env.DB, rating);
  return c.json(rating, 201);
});

app.get(`${API}/plan/:weekOf`, async (c) => {
  const weekOf = c.req.param('weekOf');
  if (!isSundayIso(weekOf)) return c.text('weekOf must be a Sunday (YYYY-MM-DD)', 400);
  const plan = await loadPlan(c.env.DB, weekOf);
  if (!plan) return c.text('No plan for this week', 404);
  return c.json(plan);
});

// ---- Shopping and prep ticks, shared across the household ----

// Every tick saved for the week.
app.get(`${API}/checks/:weekOf`, async (c) => {
  const weekOf = c.req.param('weekOf');
  if (!isSundayIso(weekOf)) return c.text('weekOf must be a Sunday (YYYY-MM-DD)', 400);
  return c.json(await loadChecks(c.env.DB, weekOf));
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
  await setCheck(c.env.DB, weekOf, parsed.data.kind, parsed.data.itemId, parsed.data.checked, c.get('email'), updatedAt);
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

  const received = await insertMissingChecks(c.env.DB, weekOf, parsed.data, c.get('email'), new Date().toISOString());
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

  const result = await parseReceiptImage(image, c.env);
  if (!result.ok) return c.text(result.message, result.status);
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
  const counts = await commitReceiptRows(c.env.DB, rows, new Date().toISOString());
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

// The Sunday job: refresh the flyers, then delete plans and ticks past the retention window.
export async function runSunday(env: Env): Promise<IngestRunSummary> {
  try {
    return await runIngest(env);
  } finally {
    await pruneWeeksBefore(env.DB, retentionCutoff(new Date()));
  }
}

// The Sunday cron (wrangler.jsonc) refreshes the flyers. Fetch serves the Hono app as before.
export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runSunday(env));
  },
};
