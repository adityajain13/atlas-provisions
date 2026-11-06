// Migration 0015 (meal status) on real SQLite: on a database at 0014 with a saved plan in it. The plan is kept as it is,
// and the status table takes one row per meal in a week, with only the two statuses.
import { describe, expect, it } from 'vitest';
import { migrationFiles, newTestDb } from './testing/d1';

const MIGRATION = '0015_meal_status.sql';

function sqlOf(name: string): string {
  const m = migrationFiles().find((f) => f.name === name);
  if (!m) throw new Error(`no migration ${name}`);
  return m.sql;
}

describe('migration 0015 on a database at 0014 with a plan in it', () => {
  it('keeps the saved plan, and adds the status table with one row per household, week and meal', () => {
    const { raw } = newTestDb('0014_sync_keys.sql');
    raw.exec("INSERT INTO meal_plans (household_id, week_of, data, created_at) VALUES ('h1', '2026-11-08', '{\"weekOf\":\"2026-11-08\"}', 'x')");
    raw.exec(sqlOf(MIGRATION));

    expect(raw.prepare('SELECT week_of, data FROM meal_plans').all()).toEqual([{ week_of: '2026-11-08', data: '{"weekOf":"2026-11-08"}' }]);

    raw.exec("INSERT INTO meal_status (household_id, week_of, meal_id, status, reason, created_at) VALUES ('h1', '2026-11-08', 'mon-dinner', 'skipped', 'ate-out', 'now')");
    expect(() =>
      raw.exec("INSERT INTO meal_status (household_id, week_of, meal_id, status, created_at) VALUES ('h1', '2026-11-08', 'mon-dinner', 'replaced', 'now')"),
    ).toThrow(/UNIQUE|constraint/i);
    expect(() =>
      raw.exec("INSERT INTO meal_status (household_id, week_of, meal_id, status, created_at) VALUES ('h1', '2026-11-08', 'tue-lunch', 'eaten', 'now')"),
    ).toThrow(/CHECK|constraint/i);
    raw.exec("INSERT INTO meal_status (household_id, week_of, meal_id, status, created_at) VALUES ('h2', '2026-11-08', 'mon-dinner', 'replaced', 'now')");
    expect(raw.prepare('SELECT household_id, meal_id, status FROM meal_status ORDER BY household_id').all()).toEqual([
      { household_id: 'h1', meal_id: 'mon-dinner', status: 'skipped' },
      { household_id: 'h2', meal_id: 'mon-dinner', status: 'replaced' },
    ]);
  });
});
