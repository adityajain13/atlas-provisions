-- Meal swapping. A plan keeps the plan it replaced in `previous`, so the last swap (or re-plan) can be undone.
ALTER TABLE meal_plans ADD COLUMN previous TEXT;

-- Swaps are counted as usage. SQLite cannot change a CHECK constraint in place, so usage is copied to a new table
-- that allows the 'swap' kind, and the old one is dropped. Rows and their primary key are unchanged.
CREATE TABLE usage_v2 (
  household_id TEXT NOT NULL,
  month TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('plan', 'receipt', 'prep', 'swap')),
  count INTEGER NOT NULL,
  PRIMARY KEY (household_id, month, kind)
);
INSERT INTO usage_v2 (household_id, month, kind, count)
SELECT household_id, month, kind, count FROM usage;
DROP TABLE usage;
ALTER TABLE usage_v2 RENAME TO usage;
