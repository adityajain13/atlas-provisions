// Migration 0010 (meal swapping) on real SQLite: on a database at 0009 with plans and usage in it. Plans and usage
// rows are kept, the new column starts empty, and usage accepts the 'swap' kind.
import { describe, expect, it } from 'vitest';
import { migrationFiles, newTestDb } from './testing/d1';

const MIGRATION = '0010_swap.sql';

function sqlOf(name: string): string {
  const m = migrationFiles().find((f) => f.name === name);
  if (!m) throw new Error(`no migration ${name}`);
  return m.sql;
}

const count = (raw: ReturnType<typeof newTestDb>['raw'], table: string) =>
  (raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

const columnsOf = (raw: ReturnType<typeof newTestDb>['raw'], table: string) =>
  (raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe('migration 0010 on a fresh database', () => {
  it('adds previous to meal_plans and allows the swap kind in usage', () => {
    const { raw } = newTestDb();
    expect(columnsOf(raw, 'meal_plans')).toContain('previous');
    expect(() => raw.exec("INSERT INTO usage (household_id, month, kind, count) VALUES ('h1', '2026-11', 'swap', 1)")).not.toThrow();
  });

  it('still refuses an unknown usage kind', () => {
    const { raw } = newTestDb();
    expect(() =>
      raw.exec("INSERT INTO usage (household_id, month, kind, count) VALUES ('h1', '2026-11', 'bogus', 1)"),
    ).toThrow(/CHECK|constraint/i);
  });

  it('keeps one usage row per household, month and kind', () => {
    const { raw } = newTestDb();
    raw.exec("INSERT INTO usage (household_id, month, kind, count) VALUES ('h1', '2026-11', 'swap', 1)");
    expect(() =>
      raw.exec("INSERT INTO usage (household_id, month, kind, count) VALUES ('h1', '2026-11', 'swap', 2)"),
    ).toThrow(/UNIQUE|constraint/i);
  });

  it('is followed by the price migration, which is now the last on disk', () => {
    expect(migrationFiles().at(-2)?.name).toBe(MIGRATION);
    expect(migrationFiles().at(-1)?.name).toBe('0011_price_household.sql');
  });
});

describe('migration 0010 on a database at 0009 with plans and usage in it', () => {
  it('keeps every plan and usage row, and starts previous empty', () => {
    const { raw } = newTestDb('0009_access.sql');
    raw.exec(`
      INSERT INTO households (id, name, data, created_at, updated_at) VALUES ('h1', 'Home', '{}', 'x', 'x');
      INSERT INTO meal_plans (household_id, week_of, data, created_at) VALUES ('h1', '2026-11-01', '{"weekOf":"2026-11-01"}', 'x');
      INSERT INTO meal_plans (household_id, week_of, data, created_at) VALUES ('h1', '2026-11-08', '{"weekOf":"2026-11-08"}', 'y');
      INSERT INTO usage (household_id, month, kind, count) VALUES ('h1', '2026-11', 'plan', 3);
      INSERT INTO usage (household_id, month, kind, count) VALUES ('h1', '2026-11', 'receipt', 2);
      INSERT INTO usage (household_id, month, kind, count) VALUES ('h2', '2026-10', 'prep', 5);
    `);
    const before = {
      plans: raw.prepare('SELECT household_id, week_of, data, created_at FROM meal_plans ORDER BY week_of').all(),
      usage: raw.prepare('SELECT household_id, month, kind, count FROM usage ORDER BY household_id, month, kind').all(),
    };

    raw.exec(sqlOf(MIGRATION));

    expect(raw.prepare('SELECT household_id, week_of, data, created_at FROM meal_plans ORDER BY week_of').all()).toEqual(
      before.plans,
    );
    expect(raw.prepare('SELECT household_id, month, kind, count FROM usage ORDER BY household_id, month, kind').all()).toEqual(
      before.usage,
    );
    expect(raw.prepare('SELECT week_of, previous FROM meal_plans ORDER BY week_of').all()).toEqual([
      { week_of: '2026-11-01', previous: null },
      { week_of: '2026-11-08', previous: null },
    ]);
    expect(count(raw, 'usage')).toBe(3);
  });

  it('keeps the primary key on usage, so one row per household, month and kind still holds', () => {
    const { raw } = newTestDb('0009_access.sql');
    raw.exec("INSERT INTO usage (household_id, month, kind, count) VALUES ('h1', '2026-11', 'plan', 1)");
    raw.exec(sqlOf(MIGRATION));
    expect(() => raw.exec("INSERT INTO usage (household_id, month, kind, count) VALUES ('h1', '2026-11', 'plan', 2)")).toThrow(
      /UNIQUE|constraint/i,
    );
  });
});
