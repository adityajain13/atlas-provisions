-- Regular shelf prices read from the Loblaw-family sites, per store location (see worker/src/pcexpress.ts).

-- Store locations per banner, cached for a week. data is the normalised list the picker searches.
CREATE TABLE site_locations (
  banner TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

-- One row per regular-price run for a household (manual or the Sunday job). sample holds the first raw results, for
-- debugging with ?debug=1. auth_needed is set when the site asked for a PC id sign-in.
CREATE TABLE site_price_runs (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  lookups INTEGER NOT NULL,
  matched INTEGER NOT NULL,
  errors TEXT NOT NULL,
  sample TEXT NOT NULL DEFAULT '[]',
  auth_needed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX site_price_runs_household ON site_price_runs(household_id, started_at);

-- Every ingredient looked up at a store location, matched or not, so a pair is not looked up again within six days.
-- A price row is written only for a match, so price_history alone cannot say what was looked up.
CREATE TABLE site_lookups (
  banner TEXT NOT NULL,
  store_id TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  looked_up_at TEXT NOT NULL,
  matched INTEGER NOT NULL,
  PRIMARY KEY (banner, store_id, ingredient_id)
);

-- Site prices are shared like flyer rows (household_id ''), but the same store name can be two locations. The
-- location is part of the key, so two households on different No Frills stores keep their own rows: site_store_id is
-- '' for every other source. It is NOT NULL and in the key for the same reason household_id is (see 0011): NULLs in a
-- key are distinct, so INSERT OR REPLACE would not replace. regular_price_per_unit is the store's regular price when a
-- sale price was shown; a sale row still tells us the regular price.
CREATE TABLE price_history_v2 (
  ingredient_id TEXT NOT NULL,
  store TEXT NOT NULL,
  date TEXT NOT NULL,
  price_per_unit REAL NOT NULL,
  on_sale INTEGER NOT NULL,
  source TEXT NOT NULL,
  household_id TEXT NOT NULL DEFAULT '',
  pack_qty REAL,
  site_store_id TEXT NOT NULL DEFAULT '',
  regular_price_per_unit REAL,
  PRIMARY KEY (ingredient_id, store, date, source, household_id, site_store_id)
);
INSERT INTO price_history_v2 (ingredient_id, store, date, price_per_unit, on_sale, source, household_id, pack_qty)
SELECT ingredient_id, store, date, price_per_unit, on_sale, source, household_id, pack_qty FROM price_history;
DROP TABLE price_history;
ALTER TABLE price_history_v2 RENAME TO price_history;
