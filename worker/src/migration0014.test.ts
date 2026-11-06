// Migration 0014 (sync keys, and the mode of a regular-price run) on real SQLite: on a database at 0013 with a run in it.
// The run keeps its place as a server run, and the key table takes one row per household.
import { describe, expect, it } from 'vitest';
import { migrationFiles, newTestDb } from './testing/d1';

const MIGRATION = '0014_sync_keys.sql';

function sqlOf(name: string): string {
  const m = migrationFiles().find((f) => f.name === name);
  if (!m) throw new Error(`no migration ${name}`);
  return m.sql;
}

describe('migration 0014 on a database at 0013 with a run in it', () => {
  it('keeps the existing run as a server run, and adds the sync key table with several keys per household', () => {
    const { raw } = newTestDb('0013_ingredient_feedback.sql');
    raw.exec(
      "INSERT INTO site_price_runs (id, household_id, started_at, finished_at, ok, lookups, matched, errors) VALUES ('r1', 'h1', '2026-11-01T10:00:00Z', '2026-11-01T10:01:00Z', 1, 5, 3, '[]')",
    );
    raw.exec(sqlOf(MIGRATION));
    expect(raw.prepare('SELECT id, mode FROM site_price_runs').all()).toEqual([{ id: 'r1', mode: 'server' }]);
    raw.exec("INSERT INTO sync_keys (id, household_id, label, key_hash, created_at) VALUES ('k1', 'h1', 'Firefox on Windows', 'hash', 'now')");
    raw.exec("INSERT INTO sync_keys (id, household_id, label, key_hash, created_at) VALUES ('k2', 'h1', 'iPhone bookmark', 'other', 'now')");
    expect(() => raw.exec("INSERT INTO sync_keys (id, household_id, label, key_hash, created_at) VALUES ('k1', 'h2', 'x', 'more', 'now')")).toThrow();
    expect(raw.prepare('SELECT label, last_used_at FROM sync_keys ORDER BY id').all()).toEqual([
      { label: 'Firefox on Windows', last_used_at: null },
      { label: 'iPhone bookmark', last_used_at: null },
    ]);
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'sync_keys_household'").get()).toEqual({ name: 'sync_keys_household' });
  });
});
