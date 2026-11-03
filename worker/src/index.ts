import { Hono } from 'hono';
import {
  HouseholdSchema,
  PlanRequestSchema,
  defaultHousehold,
  isThursdayIso,
  matchFlyerItem,
  matchIngredient,
  recentDinnerNames,
  addDaysIso,
  scoreDeals,
  type Deal,
  type FlyerItem,
  type Household,
  type MatchedItem,
} from '@provisions/shared';
import type { ZodError } from 'zod';
import flyerFixture from '../fixtures/flyer-sample.json';
import historyFixture from '../fixtures/history-sample.json';
import {
  currentFlyerItems,
  insertFlyerItems,
  insertPriceHistory,
  loadPlan,
  plansBetween,
  priceHistory,
  savePlan,
  type HistoryInsert,
} from './db';
import { anthropicClient } from './planner/claude';
import { runPlanner } from './planner/run';

type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY?: string;
  PLANNER_MODEL?: string;
  DEV?: string;
};

const API = '/provisions/api';
const DEFAULT_PLANNER_MODEL = 'claude-sonnet-5-5';
const app = new Hono<{ Bindings: Env }>();

function formatZod(error: ZodError): string {
  return error.issues
    .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
    .join('; ');
}

async function loadHousehold(db: D1Database): Promise<Household> {
  const row = await db.prepare('SELECT data FROM household WHERE id = 1').first<{ data: string }>();
  if (!row) return defaultHousehold();
  const parsed = HouseholdSchema.safeParse(JSON.parse(row.data));
  if (!parsed.success) throw new Error(`Stored household is invalid: ${formatZod(parsed.error)}`);
  return parsed.data;
}

/**
 * Matched and scored flyer items for a shopping date, from enabled stores. Used by /deals and the
 * planner. Also returns the household and the never-buy ingredient ids.
 */
async function loadDeals(
  env: Env,
  date: string,
): Promise<{ household: Household; matched: MatchedItem[]; unmatched: string[]; deals: Deal[]; neverBuy: string[] }> {
  const household = await loadHousehold(env.DB);
  const flyerItems = await currentFlyerItems(env.DB, date);

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

  return { household, matched, unmatched, deals, neverBuy };
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

  try {
    const { household, matched, deals, neverBuy } = await loadDeals(c.env, request.weekOf);
    // Plans starting up to 21 days before the week can hold dinners in the 14-day window.
    const earlier = await plansBetween(c.env.DB, addDaysIso(request.weekOf, -21), request.weekOf);
    const plan = await runPlanner({
      household,
      request,
      deals,
      matched,
      neverBuy,
      recentDinnerNames: recentDinnerNames(earlier, request.weekOf),
      client: anthropicClient(apiKey, c.env.PLANNER_MODEL ?? DEFAULT_PLANNER_MODEL),
    });
    await savePlan(c.env.DB, plan);
    return c.json(plan);
  } catch (e) {
    return c.text(e instanceof Error ? e.message : 'Planner failed', 500);
  }
});

app.get(`${API}/plan/:weekOf`, async (c) => {
  const weekOf = c.req.param('weekOf');
  if (!isThursdayIso(weekOf)) return c.text('weekOf must be a Thursday (YYYY-MM-DD)', 400);
  const plan = await loadPlan(c.env.DB, weekOf);
  if (!plan) return c.text('No plan for this week', 404);
  return c.json(plan);
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

export default app;
