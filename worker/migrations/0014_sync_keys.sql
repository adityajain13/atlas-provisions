-- Sync keys for the browser sync of T&T prices (the Atlas Provisions Sync extension, one per browser, and the iPhone
-- bookmark). A household has up to ten keys, each with a label, so one device's key never replaces another's. A key is
-- stored as a SHA-256 of itself: the key is shown once, when it is made. Revoking deletes the row.
CREATE TABLE sync_keys (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  label TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX sync_keys_household ON sync_keys(household_id);

-- How a regular-price run was read: 'server' for the app's own batch (the default for every row before this), or
-- 'browser' for a T&T sync run from the signed-in browser. The Loblaw-family status and cooldown read only 'server' runs.
ALTER TABLE site_price_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'server';
