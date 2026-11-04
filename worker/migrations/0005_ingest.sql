-- One row per flyer import run (manual refresh or the Sunday cron). sample holds the first raw items, for debugging.
CREATE TABLE ingest_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  terms INTEGER NOT NULL,
  items INTEGER NOT NULL,
  stored INTEGER NOT NULL,
  matched INTEGER NOT NULL,
  errors TEXT NOT NULL,
  sample TEXT NOT NULL
);
CREATE INDEX ingest_runs_started ON ingest_runs(started_at);
