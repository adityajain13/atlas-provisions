-- "Didn't go to plan?": what happened to a planned meal. One row per meal in a week; marking it again replaces the row,
-- and clearing deletes it. skipped: reason says why (ate out, or did not eat). replaced: made_name is what was made
-- instead, when something was; guests and guest_allergies are set when someone joined the meal (guest_allergies is a
-- JSON array). The row goes when its week is pruned, or when its meal is swapped or the week is planned again.
CREATE TABLE meal_status (
  household_id TEXT NOT NULL,
  week_of TEXT NOT NULL,
  meal_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('skipped', 'replaced')),
  reason TEXT,
  made_name TEXT,
  guests INTEGER,
  guest_allergies TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (household_id, week_of, meal_id)
);
