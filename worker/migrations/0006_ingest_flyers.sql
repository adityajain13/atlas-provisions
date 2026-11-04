-- Flyer import (flyers mode, with search as the fallback): which path ran, the flyers it used, and the
-- number of raw items kept for the household's stores.
ALTER TABLE ingest_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'search';
ALTER TABLE ingest_runs ADD COLUMN flyers TEXT NOT NULL DEFAULT '[]';
ALTER TABLE ingest_runs ADD COLUMN kept INTEGER NOT NULL DEFAULT 0;
