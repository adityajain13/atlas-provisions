import { Hono } from 'hono';
import {
  HouseholdSchema,
  defaultHousehold,
  matchFlyerItem,
  matchIngredient,
  scoreDeals,
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
  priceHistory,
  type HistoryInsert,
} from './db';

type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY?: string;
  DEV?: string;
};

const API = '/provisions/api';
const app = new Hono<{ Bindings: Env }>();

function formatZod(error: ZodError): string {
  return error.issues
    .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
    .join('; ');
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loadHousehold(db: D1Database): Promise<Household> {
  const row = await db.prepare('SELECT data FROM household WHERE id = 1').first<{ data: string }>();
  if (!row) return defaultHousehold();
  const parsed = HouseholdSchema.safeParse(JSON.parse(row.data));
  if (!parsed.success) throw new Error(`Stored household is invalid: ${formatZod(parsed.error)}`);
  return parsed.data;
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

  const household = await loadHousehold(c.env.DB);
  const flyerItems = await currentFlyerItems(c.env.DB, date);

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

  const history = await priceHistory(c.env.DB, addDays(date, -56));

  // Item rules name foods in free text. Map each to an ingredient id, skipping names that do not match.
  const ruleIds = (rule: 'always' | 'never') =>
    household.itemRules
      .filter((r) => r.rule === rule)
      .map((r) => matchIngredient(r.name)?.ingredientId)
      .filter((id): id is string => id !== undefined);

  const allergens = [...new Set(household.people.flatMap((p) => p.allergies))];

  const deals = scoreDeals(matched, {
    history,
    neverBuy: ruleIds('never'),
    alwaysBuy: ruleIds('always'),
    allergens,
    shoppingDate: date,
    householdSize: Math.max(1, household.people.length),
  });

  return c.json({ matched: matched.length, unmatched, deals });
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
