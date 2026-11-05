-- Shopping-list and prep ticks, shared across the household. Last write wins per item.
CREATE TABLE checks (week_of TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('list','prep')), item_id TEXT NOT NULL, checked INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT, PRIMARY KEY (week_of, kind, item_id));
