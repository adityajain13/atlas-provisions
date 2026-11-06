// Migration 0011 (household receipt prices) on real SQLite: on a database at 0010 with flyer and receipt prices in it.
// Rows are kept and marked shared (household ''), receipt rows can carry a pack size, and two households can record
// the same ingredient, store and day without replacing each other, while flyer rows still replace as before.
import { describe, expect, it } from 'vitest';
import { commitReceiptRows, householdReceiptPrices } from './db';
import { migrationFiles, newTestDb } from './testing/d1';

const MIGRATION = '0011_price_household.sql';

function sqlOf(name: string): string {
  const m = migrationFiles().find((f) => f.name === name);
  if (!m) throw new Error(`no migration ${name}`);
  return m.sql;
}

const rows = (raw: ReturnType<typeof newTestDb>['raw'], cols: string) =>
  raw.prepare(`SELECT ${cols} FROM price_history ORDER BY ingredient_id, store, date, source`).all();

describe('migration 0011 on a database at 0010 with prices in it', () => {
  it('keeps every price row, marks it shared, and leaves its pack size empty', () => {
    const { raw } = newTestDb('0010_swap.sql');
    raw.exec(`
      INSERT INTO price_history (ingredient_id, store, date, price_per_unit, on_sale, source) VALUES
        ('eggs-large', 'No Frills', '2026-10-20', 4.5, 1, 'flyer'),
        ('canned-tuna', 'Loblaws', '2026-10-28', 2.39, 0, 'receipt');
    `);
    const before = rows(raw, 'ingredient_id, store, date, price_per_unit, on_sale, source');
    raw.exec(sqlOf(MIGRATION));
    expect(rows(raw, 'ingredient_id, store, date, price_per_unit, on_sale, source, household_id, pack_qty')).toEqual(
      before.map((r) => ({ ...(r as object), household_id: '', pack_qty: null })),
    );
  });

  it('lets two households keep their own receipt price for the same ingredient, store and day', () => {
    const { raw } = newTestDb(MIGRATION);
    const insert = (household: string, price: number) =>
      raw.exec(
        `INSERT OR REPLACE INTO price_history (ingredient_id, store, date, price_per_unit, on_sale, source, household_id, pack_qty)
         VALUES ('canned-tuna', 'Loblaws', '2026-11-01', ${price}, 0, 'receipt', '${household}', 1)`,
      );
    insert('h1', 2.39);
    insert('h2', 2.79);
    const n = raw.prepare("SELECT count(*) AS n FROM price_history WHERE source = 'receipt'").get() as { n: number };
    expect(n.n).toBe(2);
  });

  it('still replaces a shared flyer row with the same key', () => {
    const { raw } = newTestDb(MIGRATION);
    const insert = (price: number) =>
      raw.exec(
        `INSERT OR REPLACE INTO price_history (ingredient_id, store, date, price_per_unit, on_sale, source)
         VALUES ('canned-tuna', 'Loblaws', '2026-11-01', ${price}, 1, 'flyer')`,
      );
    insert(2.39);
    insert(2.19);
    const n = raw.prepare("SELECT count(*) AS n, min(price_per_unit) AS p FROM price_history WHERE source = 'flyer'").get() as { n: number; p: number };
    expect(n).toEqual({ n: 1, p: 2.19 });
  });
});

describe('household receipt prices', () => {
  it('reads back only the household own receipts, with the pack size, inside the date range', async () => {
    const { DB } = newTestDb(MIGRATION);
    await commitReceiptRows(
      DB,
      'h1',
      {
        prices: [
          { ingredientId: 'canned-tuna', store: 'Loblaws', date: '2026-10-28', pricePerUnit: 2.39, packQty: 1 },
          { ingredientId: 'chicken-breast-boneless', store: 'Loblaws', date: '2026-07-01', pricePerUnit: 9, packQty: 0.84 },
        ],
        matches: [],
        pantry: [],
      },
      '2026-10-28T12:00:00Z',
    );
    await commitReceiptRows(
      DB,
      'h2',
      { prices: [{ ingredientId: 'canned-tuna', store: 'Loblaws', date: '2026-10-29', pricePerUnit: 1.5, packQty: 1 }], matches: [], pantry: [] },
      '2026-10-29T12:00:00Z',
    );
    const got = await householdReceiptPrices(DB, 'h1', '2026-08-01', '2026-11-05');
    expect(got).toEqual([{ ingredientId: 'canned-tuna', store: 'Loblaws', date: '2026-10-28', pricePerUnit: 2.39, packQty: 1 }]);
  });

  it('leaves out flyer rows and rows without a household', async () => {
    const { DB, raw } = newTestDb(MIGRATION);
    raw.exec(
      "INSERT INTO price_history (ingredient_id, store, date, price_per_unit, on_sale, source) VALUES ('canned-tuna', 'Loblaws', '2026-10-28', 2.2, 1, 'flyer')",
    );
    expect(await householdReceiptPrices(DB, 'h1', '2026-08-01', '2026-11-05')).toEqual([]);
  });
});
