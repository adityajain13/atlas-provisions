CREATE TABLE flyer_items (id TEXT PRIMARY KEY, store TEXT NOT NULL, raw_name TEXT NOT NULL, price_text TEXT NOT NULL, size_text TEXT, valid_from TEXT NOT NULL, valid_to TEXT NOT NULL, source TEXT NOT NULL, fetched_at TEXT NOT NULL);
CREATE INDEX flyer_items_valid ON flyer_items(valid_to);
CREATE TABLE item_matches (raw_key TEXT PRIMARY KEY, ingredient_id TEXT, pack_qty REAL, confidence REAL, confirmed INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
CREATE TABLE price_history (ingredient_id TEXT NOT NULL, store TEXT NOT NULL, date TEXT NOT NULL, price_per_unit REAL NOT NULL, on_sale INTEGER NOT NULL, source TEXT NOT NULL, PRIMARY KEY (ingredient_id, store, date, source));
CREATE TABLE meal_plans (week_of TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE meal_ratings (id TEXT PRIMARY KEY, meal_name TEXT NOT NULL, person_id TEXT NOT NULL, rating TEXT NOT NULL CHECK (rating IN ('up','down','never')), ingredient_ids TEXT NOT NULL, date TEXT NOT NULL);
