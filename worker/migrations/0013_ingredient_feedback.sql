-- What the household changed in a planned meal: an ingredient skipped, or replaced with something else. One row per
-- meal and ingredient in a week; marking it again replaces the row, and "used as planned" deletes it. The planner reads
-- the last 90 days of rows (see shared/src/feedback.ts). replacement is free text, set only for kind 'replaced'.
CREATE TABLE ingredient_feedback (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  week_of TEXT NOT NULL,
  meal_id TEXT NOT NULL,
  meal_name TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('skipped', 'replaced')),
  replacement TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (household_id, week_of, meal_id, ingredient_id)
);
CREATE INDEX ingredient_feedback_household ON ingredient_feedback(household_id, created_at);
