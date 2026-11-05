// Thin D1 access. Not unit tested: the logic lives in shared/ and is tested there.
import {
  CHECK_KINDS,
  HouseholdSchema,
  defaultHousehold,
  type CheckBulk,
  type CheckKind,
  type Checks,
  type FlyerUsed,
  type Household,
  type IngestMode,
  type IngestStatus,
} from '@provisions/shared';
import type {
  FlyerItem,
  HistoryPoint,
  MatchedItem,
  MealPlan,
  PantryItem,
  Rating,
  ReceiptCommitRows,
} from '@provisions/shared';

interface FlyerRow {
  id: string;
  store: string;
  raw_name: string;
  price_text: string;
  size_text: string | null;
  valid_from: string;
  valid_to: string;
  source: FlyerItem['source'];
}

interface HistoryRow {
  ingredient_id: string;
  store: string;
  date: string;
  price_per_unit: number;
}

export interface HistoryInsert extends HistoryPoint {
  onSale: boolean;
  source: string;
}

export async function insertFlyerItems(
  db: D1Database,
  items: FlyerItem[],
  fetchedAt: string = new Date().toISOString(),
): Promise<number> {
  if (items.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO flyer_items
       (id, store, raw_name, price_text, size_text, valid_from, valid_to, source, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  await db.batch(
    items.map((i) =>
      stmt.bind(
        i.id,
        i.store,
        i.rawName,
        i.priceText,
        i.sizeText ?? null,
        i.validFrom,
        i.validTo,
        i.source,
        fetchedAt,
      ),
    ),
  );
  return items.length;
}

// Shopping happens on Sunday, so the week is priced from the flyers valid that day.
/** Flyer items valid on `date` (valid_from <= date <= valid_to). */
export async function currentFlyerItems(db: D1Database, date: string): Promise<FlyerItem[]> {
  const { results } = await db
    .prepare('SELECT * FROM flyer_items WHERE valid_from <= ? AND valid_to >= ?')
    .bind(date, date)
    .all<FlyerRow>();
  return results.map((r) => ({
    id: r.id,
    store: r.store,
    rawName: r.raw_name,
    priceText: r.price_text,
    sizeText: r.size_text ?? undefined,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    source: r.source,
  }));
}

export async function priceHistory(db: D1Database, sinceDate: string): Promise<HistoryPoint[]> {
  const { results } = await db
    .prepare('SELECT ingredient_id, store, date, price_per_unit FROM price_history WHERE date >= ?')
    .bind(sinceDate)
    .all<HistoryRow>();
  return results.map((r) => ({
    ingredientId: r.ingredient_id,
    store: r.store,
    date: r.date,
    pricePerUnit: r.price_per_unit,
  }));
}

export async function insertPriceHistory(db: D1Database, rows: HistoryInsert[]): Promise<number> {
  if (rows.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO price_history
       (ingredient_id, store, date, price_per_unit, on_sale, source)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  await db.batch(
    rows.map((r) => stmt.bind(r.ingredientId, r.store, r.date, r.pricePerUnit, r.onSale ? 1 : 0, r.source)),
  );
  return rows.length;
}

/** Record today's matched flyer prices. Flyer rows are on sale by definition. */
export async function recordPrices(db: D1Database, matched: MatchedItem[], date: string): Promise<number> {
  if (matched.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO price_history
       (ingredient_id, store, date, price_per_unit, on_sale, source)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  await db.batch(
    matched.map((m) =>
      stmt.bind(m.ingredientId, m.store, date, m.pricePerUnit, m.source === 'flyer' || m.source === 'fixture' || m.source === 'flipp' ? 1 : 0, m.source),
    ),
  );
  return matched.length;
}

// ---- Meal plans (milestone 2B) ----

/** Saved plans whose week starts in [fromWeek, beforeWeek). */
export async function plansBetween(db: D1Database, fromWeek: string, beforeWeek: string): Promise<MealPlan[]> {
  const { results } = await db
    .prepare('SELECT data FROM meal_plans WHERE week_of >= ? AND week_of < ?')
    .bind(fromWeek, beforeWeek)
    .all<{ data: string }>();
  return results.flatMap((r) => {
    try {
      return [JSON.parse(r.data) as MealPlan];
    } catch {
      return [];
    }
  });
}

export async function loadPlan(db: D1Database, weekOf: string): Promise<MealPlan | null> {
  const row = await db.prepare('SELECT data FROM meal_plans WHERE week_of = ?').bind(weekOf).first<{ data: string }>();
  if (!row) return null;
  return JSON.parse(row.data) as MealPlan;
}

/** Insert or replace the plan for its week. */
export async function savePlan(db: D1Database, plan: MealPlan): Promise<void> {
  await db
    .prepare(
      `INSERT INTO meal_plans (week_of, data, created_at) VALUES (?, ?, ?)
       ON CONFLICT(week_of) DO UPDATE SET data = excluded.data, created_at = excluded.created_at`,
    )
    .bind(plan.weekOf, JSON.stringify(plan), plan.generatedAt)
    .run();
}

// ---- Pantry (milestone 3A) ----

interface PantryRow {
  id: string;
  ingredient_id: string;
  qty: number;
  unit: PantryItem['unit'];
  added_on: string;
  expires_on: string;
  source: PantryItem['source'];
}

interface RatingRow {
  id: string;
  meal_name: string;
  person_id: string;
  rating: Rating['rating'];
  ingredient_ids: string;
  date: string;
}

const toPantryItem = (r: PantryRow): PantryItem => ({
  id: r.id,
  ingredientId: r.ingredient_id,
  qty: r.qty,
  unit: r.unit,
  addedOn: r.added_on,
  expiresOn: r.expires_on,
  source: r.source,
});

export async function loadPantry(db: D1Database): Promise<PantryItem[]> {
  const { results } = await db
    .prepare('SELECT * FROM pantry_items ORDER BY expires_on, added_on, id')
    .all<PantryRow>();
  return results.map(toPantryItem);
}

export async function loadPantryItem(db: D1Database, id: string): Promise<PantryItem | null> {
  const row = await db.prepare('SELECT * FROM pantry_items WHERE id = ?').bind(id).first<PantryRow>();
  return row ? toPantryItem(row) : null;
}

export async function insertPantryItem(db: D1Database, item: PantryItem): Promise<void> {
  await db
    .prepare(
      `INSERT INTO pantry_items (id, ingredient_id, qty, unit, added_on, expires_on, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(item.id, item.ingredientId, item.qty, item.unit, item.addedOn, item.expiresOn, item.source)
    .run();
}

/** Set quantity and use-by date. Returns false when no item has that id. */
export async function updatePantryItem(db: D1Database, item: PantryItem): Promise<boolean> {
  const res = await db
    .prepare('UPDATE pantry_items SET qty = ?, expires_on = ? WHERE id = ?')
    .bind(item.qty, item.expiresOn, item.id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deletePantryItem(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM pantry_items WHERE id = ?').bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}

// ---- Meal ratings (milestone 3A) ----

const toRating = (r: RatingRow): Rating => ({
  id: r.id,
  mealName: r.meal_name,
  personId: r.person_id,
  rating: r.rating,
  ingredientIds: JSON.parse(r.ingredient_ids) as string[],
  date: r.date,
});

export async function loadRatings(db: D1Database): Promise<Rating[]> {
  const { results } = await db.prepare('SELECT * FROM meal_ratings').all<RatingRow>();
  return results.map(toRating);
}

/** One rating per meal name (case-insensitive) and person: the old one is replaced. */
export async function upsertRating(db: D1Database, rating: Rating): Promise<void> {
  await db.batch([
    db
      .prepare('DELETE FROM meal_ratings WHERE meal_name = ? COLLATE NOCASE AND person_id = ?')
      .bind(rating.mealName, rating.personId),
    db
      .prepare(
        `INSERT INTO meal_ratings (id, meal_name, person_id, rating, ingredient_ids, date)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        rating.id,
        rating.mealName,
        rating.personId,
        rating.rating,
        JSON.stringify(rating.ingredientIds),
        rating.date,
      ),
  ]);
}

// ---- Receipts (milestone 3B) ----

// D1 batches are kept small. A long receipt is written in chunks, so the chunks are not one
// transaction across the whole receipt.
const STATEMENTS_PER_BATCH = 50;

/** Writes the rows a confirmed receipt produced: prices, confirmed matches and pantry items. */
export async function commitReceiptRows(
  db: D1Database,
  rows: ReceiptCommitRows,
  now: string,
): Promise<{ prices: number; matches: number; pantryItems: number }> {
  const statements: D1PreparedStatement[] = [];

  for (const p of rows.prices) {
    statements.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO price_history (ingredient_id, store, date, price_per_unit, on_sale, source)
           VALUES (?, ?, ?, ?, 0, 'receipt')`,
        )
        .bind(p.ingredientId, p.store, p.date, p.pricePerUnit),
    );
  }

  for (const m of rows.matches) {
    statements.push(
      db
        .prepare(
          `INSERT INTO item_matches (raw_key, ingredient_id, pack_qty, confidence, confirmed, updated_at)
           VALUES (?, ?, ?, 1, 1, ?)
           ON CONFLICT(raw_key) DO UPDATE SET
             ingredient_id = excluded.ingredient_id,
             pack_qty = excluded.pack_qty,
             confidence = 1,
             confirmed = 1,
             updated_at = excluded.updated_at`,
        )
        .bind(m.rawKey, m.ingredientId, m.packQty, now),
    );
  }

  for (const item of rows.pantry) {
    statements.push(
      db
        .prepare(
          `INSERT INTO pantry_items (id, ingredient_id, qty, unit, added_on, expires_on, source)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(item.id, item.ingredientId, item.qty, item.unit, item.addedOn, item.expiresOn, item.source),
    );
  }

  for (let i = 0; i < statements.length; i += STATEMENTS_PER_BATCH) {
    await db.batch(statements.slice(i, i + STATEMENTS_PER_BATCH));
  }
  return { prices: rows.prices.length, matches: rows.matches.length, pantryItems: rows.pantry.length };
}

// ---- Household and flyer imports (milestone 4) ----

/** The stored household, or the default when none is saved. Throws when the stored document is invalid. */
export async function loadHousehold(db: D1Database): Promise<Household> {
  const row = await db.prepare('SELECT data FROM household WHERE id = 1').first<{ data: string }>();
  if (!row) return defaultHousehold();
  const parsed = HouseholdSchema.safeParse(JSON.parse(row.data));
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new Error(`Stored household is invalid: ${detail}`);
  }
  return parsed.data;
}

export interface IngestRunRow {
  id: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  mode: IngestMode;
  terms: number;
  flyers: FlyerUsed[];
  items: number;
  kept: number;
  stored: number;
  matched: number;
  errors: string[];
  sample: unknown[];
}

export async function insertIngestRun(db: D1Database, run: IngestRunRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ingest_runs (id, started_at, finished_at, ok, mode, terms, flyers, items, kept, stored, matched, errors, sample)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      run.id,
      run.startedAt,
      run.finishedAt,
      run.ok ? 1 : 0,
      run.mode,
      run.terms,
      JSON.stringify(run.flyers.slice(0, 50)),
      run.items,
      run.kept,
      run.stored,
      run.matched,
      JSON.stringify(run.errors.slice(0, 20)),
      JSON.stringify(run.sample.slice(0, 3)),
    )
    .run();
}

interface IngestRunDbRow {
  id: string;
  started_at: string;
  finished_at: string;
  ok: number;
  mode: string;
  terms: number;
  flyers: string;
  items: number;
  kept: number;
  stored: number;
  matched: number;
  errors: string;
  sample?: string;
}

function parseJsonArray(text: string | undefined): unknown[] {
  if (!text) return [];
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * The latest run. Without `debug` it has no sample and no flyer list. With `debug` it has both, for
 * pasting when the feed's shape looks different from what the import expects.
 */
export async function latestIngestRun(
  db: D1Database,
  opts: { debug?: boolean } = {},
): Promise<NonNullable<IngestStatus['lastRun']> | null> {
  const columns = 'id, started_at, finished_at, ok, mode, terms, flyers, items, kept, stored, matched, errors';
  const row = await db
    .prepare(`SELECT ${columns}${opts.debug ? ', sample' : ''} FROM ingest_runs ORDER BY started_at DESC LIMIT 1`)
    .first<IngestRunDbRow>();
  if (!row) return null;
  const flyers = parseJsonArray(row.flyers) as FlyerUsed[];
  const out: NonNullable<IngestStatus['lastRun']> = {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    ok: row.ok === 1,
    mode: row.mode === 'flyers' ? 'flyers' : 'search',
    terms: row.terms,
    flyerCount: flyers.length,
    items: row.items,
    kept: row.kept,
    stored: row.stored,
    matched: row.matched,
    errors: parseJsonArray(row.errors) as string[],
  };
  if (opts.debug) {
    out.sample = parseJsonArray(row.sample);
    out.flyers = flyers;
  }
  return out;
}

/** Flyer items valid on `date`, counted per store. */
export async function flyerCountsForDate(db: D1Database, date: string): Promise<{ store: string; count: number }[]> {
  const { results } = await db
    .prepare(
      'SELECT store, COUNT(*) AS n FROM flyer_items WHERE valid_from <= ? AND valid_to >= ? GROUP BY store ORDER BY store',
    )
    .bind(date, date)
    .all<{ store: string; n: number }>();
  return results.map((r) => ({ store: r.store, count: r.n }));
}

// ---- Shopping and prep ticks (migration 0007) ----

interface CheckRow {
  kind: CheckKind;
  item_id: string;
  checked: number;
  updated_at: string;
}

/** Every tick saved for the week. updatedAt is the latest write, or null when nothing is saved. */
export async function loadChecks(db: D1Database, weekOf: string): Promise<Checks> {
  const { results } = await db
    .prepare('SELECT kind, item_id, checked, updated_at FROM checks WHERE week_of = ?')
    .bind(weekOf)
    .all<CheckRow>();
  const out: Checks = { list: {}, prep: {}, updatedAt: null };
  for (const r of results) {
    out[r.kind][r.item_id] = r.checked === 1;
    if (out.updatedAt === null || r.updated_at > out.updatedAt) out.updatedAt = r.updated_at;
  }
  return out;
}

/** Sets one tick. The latest write wins, and the row records who and when. */
export async function setCheck(
  db: D1Database,
  weekOf: string,
  kind: CheckKind,
  itemId: string,
  checked: boolean,
  updatedBy: string,
  updatedAt: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO checks (week_of, kind, item_id, checked, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(week_of, kind, item_id) DO UPDATE SET
         checked = excluded.checked, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(weekOf, kind, itemId, checked ? 1 : 0, updatedAt, updatedBy)
    .run();
}

/** One-time move of ticks from a browser. Items already saved for the week are left alone. Returns the count sent. */
export async function insertMissingChecks(
  db: D1Database,
  weekOf: string,
  bulk: CheckBulk,
  updatedBy: string,
  updatedAt: string,
): Promise<number> {
  const stmts: D1PreparedStatement[] = [];
  for (const kind of CHECK_KINDS) {
    for (const [itemId, checked] of Object.entries(bulk[kind] ?? {})) {
      stmts.push(
        db
          .prepare(
            'INSERT OR IGNORE INTO checks (week_of, kind, item_id, checked, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .bind(weekOf, kind, itemId, checked ? 1 : 0, updatedAt, updatedBy),
      );
    }
  }
  // Batches stay small, so a long list is never one oversized request.
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return stmts.length;
}
