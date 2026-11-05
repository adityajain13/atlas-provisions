-- Households. Each signed-in address belongs to one household, and a household has its own document, pantry,
-- ratings, plans, ticks and monthly usage. Flyer prices are shared by postal code; price history and receipt
-- matches stay global.
--
-- Existing data moves into one household, 'h1' ("Home"). Everyone who has signed in is a member of it; the
-- earliest to sign in is its owner. Every existing row gets household_id 'h1'.
--
-- The old household table is legacy: it is left as it was and nothing reads it after this migration.
-- With no existing data (an empty database) the INSERT ... SELECT statements create nothing.

CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO households (id, name, data, created_at, updated_at)
SELECT 'h1', 'Home', data, updated_at, updated_at FROM household WHERE id = 1;

-- One household per address. Members are everyone with a session, keyed by their lower-cased address.
CREATE TABLE household_members (
  household_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (email)
);
CREATE INDEX household_members_household ON household_members(household_id);

INSERT INTO household_members (household_id, email, role, joined_at)
SELECT
  'h1',
  email,
  CASE WHEN position = 1 THEN 'owner' ELSE 'member' END,
  joined_at
FROM (
  SELECT
    lower(trim(email)) AS email,
    strftime('%Y-%m-%dT%H:%M:%fZ', min(created_at) / 1000.0, 'unixepoch') AS joined_at,
    row_number() OVER (ORDER BY min(created_at), lower(trim(email))) AS position
  FROM sessions
  GROUP BY lower(trim(email))
)
WHERE EXISTS (SELECT 1 FROM households WHERE id = 'h1');

CREATE TABLE household_invites (
  household_id TEXT NOT NULL,
  email TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (household_id, email)
);
CREATE INDEX household_invites_email ON household_invites(email);

-- Plans, prep refreshes and receipt scans counted per household per Toronto month.
CREATE TABLE usage (
  household_id TEXT NOT NULL,
  month TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('plan', 'receipt', 'prep')),
  count INTEGER NOT NULL,
  PRIMARY KEY (household_id, month, kind)
);

-- Scoped by household. DEFAULT 'h1' keeps the previous Worker working for the minute between this
-- migration and its deploy. Every query in the current Worker sets household_id explicitly.
ALTER TABLE pantry_items ADD COLUMN household_id TEXT NOT NULL DEFAULT 'h1';
CREATE INDEX pantry_items_household ON pantry_items(household_id);

ALTER TABLE meal_ratings ADD COLUMN household_id TEXT NOT NULL DEFAULT 'h1';
CREATE INDEX meal_ratings_household ON meal_ratings(household_id);

-- meal_plans and checks are keyed by week, so the household has to join the primary key. SQLite cannot
-- change a primary key in place, so each table is copied to a new one and renamed.
CREATE TABLE meal_plans_v2 (
  household_id TEXT NOT NULL DEFAULT 'h1',
  week_of TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (household_id, week_of)
);
INSERT INTO meal_plans_v2 (household_id, week_of, data, created_at)
SELECT 'h1', week_of, data, created_at FROM meal_plans;
DROP TABLE meal_plans;
ALTER TABLE meal_plans_v2 RENAME TO meal_plans;

CREATE TABLE checks_v2 (
  household_id TEXT NOT NULL DEFAULT 'h1',
  week_of TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('list', 'prep')),
  item_id TEXT NOT NULL,
  checked INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (household_id, week_of, kind, item_id)
);
INSERT INTO checks_v2 (household_id, week_of, kind, item_id, checked, updated_at, updated_by)
SELECT 'h1', week_of, kind, item_id, checked, updated_at, updated_by FROM checks;
DROP TABLE checks;
ALTER TABLE checks_v2 RENAME TO checks;

-- Flyer items are per postal code: one flyer item can appear under several postal codes, so the key is
-- (postal_code, id). The current h1 postal code is the postal code of every existing row. Rows that cannot
-- be attributed to one get '' and are never shown; they are cache, and the next run for a postal code
-- replaces them.
ALTER TABLE flyer_items ADD COLUMN postal_code TEXT;
UPDATE flyer_items
SET postal_code = (SELECT upper(replace(json_extract(data, '$.postalCode'), ' ', '')) FROM households WHERE id = 'h1')
WHERE postal_code IS NULL;

CREATE TABLE flyer_items_v2 (
  postal_code TEXT NOT NULL DEFAULT '',
  id TEXT NOT NULL,
  store TEXT NOT NULL,
  raw_name TEXT NOT NULL,
  price_text TEXT NOT NULL,
  size_text TEXT,
  valid_from TEXT NOT NULL,
  valid_to TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (postal_code, id)
);
INSERT INTO flyer_items_v2 (postal_code, id, store, raw_name, price_text, size_text, valid_from, valid_to, source, fetched_at)
SELECT COALESCE(postal_code, ''), id, store, raw_name, price_text, size_text, valid_from, valid_to, source, fetched_at
FROM flyer_items;
DROP TABLE flyer_items;
ALTER TABLE flyer_items_v2 RENAME TO flyer_items;
CREATE INDEX flyer_items_valid ON flyer_items(valid_to);
CREATE INDEX flyer_items_postal ON flyer_items(postal_code, valid_to);

-- Each import run belongs to the postal code it read. Existing runs are the h1 postal code's.
ALTER TABLE ingest_runs ADD COLUMN postal_code TEXT;
UPDATE ingest_runs
SET postal_code = (SELECT upper(replace(json_extract(data, '$.postalCode'), ' ', '')) FROM households WHERE id = 'h1')
WHERE postal_code IS NULL;
CREATE INDEX ingest_runs_postal ON ingest_runs(postal_code, started_at);
