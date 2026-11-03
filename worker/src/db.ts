// Thin D1 access. Not unit tested: the logic lives in shared/ and is tested there.
import type { FlyerItem, HistoryPoint, MatchedItem } from '@provisions/shared';

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

export async function currentFlyerItems(db: D1Database, date: string): Promise<FlyerItem[]> {
  const { results } = await db
    .prepare('SELECT * FROM flyer_items WHERE valid_to >= ?')
    .bind(date)
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
      stmt.bind(m.ingredientId, m.store, date, m.pricePerUnit, m.source === 'flyer' || m.source === 'fixture' ? 1 : 0, m.source),
    ),
  );
  return matched.length;
}
