// Migration 0012 (regular prices from the sites) on real SQLite: on a database at 0011 with prices in it. Existing rows
// are kept, site rows for two locations of one store name do not replace each other, and the flyer rule still holds.
import { describe, expect, it } from 'vitest';
import { migrationFiles, newTestDb } from './testing/d1';

const MIGRATION = '0012_site_prices.sql';

function sqlOf(name: string): string {
  const m = migrationFiles().find((f) => f.name === name);
  if (!m) throw new Error(`no migration ${name}`);
  return m.sql;
}

describe('migration 0012 on a database at 0011 with prices in it', () => {
  it('keeps every price row, with an empty location and no regular price', () => {
    const { raw } = newTestDb('0011_price_household.sql');
    raw.exec(`
      INSERT INTO price_history (ingredient_id, store, date, price_per_unit, on_sale, source, household_id, pack_qty) VALUES
        ('eggs-large', 'No Frills', '2026-10-20', 4.5, 1, 'flyer', '', NULL),
        ('canned-tuna', 'Loblaws', '2026-10-28', 2.39, 0, 'receipt', 'h1', 1);
    `);
    raw.exec(sqlOf(MIGRATION));
    expect(
      raw.prepare('SELECT ingredient_id, store, date, price_per_unit, on_sale, source, household_id, pack_qty, site_store_id, regular_price_per_unit FROM price_history ORDER BY ingredient_id').all(),
    ).toEqual([
      { ingredient_id: 'canned-tuna', store: 'Loblaws', date: '2026-10-28', price_per_unit: 2.39, on_sale: 0, source: 'receipt', household_id: 'h1', pack_qty: 1, site_store_id: '', regular_price_per_unit: null },
      { ingredient_id: 'eggs-large', store: 'No Frills', date: '2026-10-20', price_per_unit: 4.5, on_sale: 1, source: 'flyer', household_id: '', pack_qty: null, site_store_id: '', regular_price_per_unit: null },
    ]);
  });

  it('keeps two locations of one store name apart on the same day, for the same ingredient', () => {
    const { raw } = newTestDb(MIGRATION);
    const insert = (storeId: string, price: number) =>
      raw.exec(
        `INSERT OR REPLACE INTO price_history (ingredient_id, store, date, price_per_unit, on_sale, source, household_id, pack_qty, site_store_id, regular_price_per_unit)
         VALUES ('ground-beef', 'No Frills', '2026-11-03', ${price}, 0, 'site', '', 1, '${storeId}', ${price + 1})`,
      );
    insert('1234', 12);
    insert('5678', 13);
    expect(raw.prepare("SELECT site_store_id, price_per_unit FROM price_history WHERE source = 'site' ORDER BY site_store_id").all()).toEqual([
      { site_store_id: '1234', price_per_unit: 12 },
      { site_store_id: '5678', price_per_unit: 13 },
    ]);
  });

  it('still replaces a site row for the same location, day and ingredient', () => {
    const { raw } = newTestDb(MIGRATION);
    const insert = (price: number) =>
      raw.exec(
        `INSERT OR REPLACE INTO price_history (ingredient_id, store, date, price_per_unit, on_sale, source, household_id, pack_qty, site_store_id)
         VALUES ('ground-beef', 'No Frills', '2026-11-03', ${price}, 0, 'site', '', 1, '1234')`,
      );
    insert(12);
    insert(11.5);
    expect(raw.prepare("SELECT count(*) AS n, min(price_per_unit) AS p FROM price_history WHERE source = 'site'").get()).toEqual({ n: 1, p: 11.5 });
  });

  it('still replaces a shared flyer row with the same key', () => {
    const { raw } = newTestDb(MIGRATION);
    const insert = (price: number) =>
      raw.exec(
        `INSERT OR REPLACE INTO price_history (ingredient_id, store, date, price_per_unit, on_sale, source, household_id, pack_qty, site_store_id)
         VALUES ('canned-tuna', 'Loblaws', '2026-11-01', ${price}, 1, 'flyer', '', NULL, '')`,
      );
    insert(2.39);
    insert(2.19);
    expect(raw.prepare("SELECT count(*) AS n, min(price_per_unit) AS p FROM price_history WHERE source = 'flyer'").get()).toEqual({ n: 1, p: 2.19 });
  });

  it('creates the location cache, the run log and the lookup table', () => {
    const { raw } = newTestDb(MIGRATION);
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'site_%' ORDER BY name").all();
    expect(tables).toEqual([{ name: 'site_locations' }, { name: 'site_lookups' }, { name: 'site_price_runs' }]);
  });
});
