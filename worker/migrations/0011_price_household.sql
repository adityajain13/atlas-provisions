-- Receipt prices belong to the household that recorded them, and keep the pack size they were bought as, so a
-- receipt price can stand in for a flyer price (an estimate). Flyer rows are shared by every household: household_id
-- is '' for them. The key takes household_id too, so two households that buy the same thing at the same store on the
-- same day keep their own rows. A nullable column would not do that: SQLite treats NULLs in a key as distinct, so
-- INSERT OR REPLACE would stop replacing the shared flyer rows.
CREATE TABLE price_history_v2 (
  ingredient_id TEXT NOT NULL,
  store TEXT NOT NULL,
  date TEXT NOT NULL,
  price_per_unit REAL NOT NULL,
  on_sale INTEGER NOT NULL,
  source TEXT NOT NULL,
  household_id TEXT NOT NULL DEFAULT '',
  pack_qty REAL,
  PRIMARY KEY (ingredient_id, store, date, source, household_id)
);
INSERT INTO price_history_v2 (ingredient_id, store, date, price_per_unit, on_sale, source)
SELECT ingredient_id, store, date, price_per_unit, on_sale, source FROM price_history;
DROP TABLE price_history;
ALTER TABLE price_history_v2 RENAME TO price_history;
