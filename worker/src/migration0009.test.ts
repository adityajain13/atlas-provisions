// Migration 0009 (the app's access list) on real SQLite: on a fresh database, and on one that already has 0008's
// households and sign-ins. Existing access is unchanged: nothing is seeded.
import { describe, expect, it } from 'vitest';
import { migrationFiles, newTestDb } from './testing/d1';

const MIGRATION = '0009_access.sql';

function sqlOf(name: string): string {
  const m = migrationFiles().find((f) => f.name === name);
  if (!m) throw new Error(`no migration ${name}`);
  return m.sql;
}

const count = (raw: ReturnType<typeof newTestDb>['raw'], table: string) =>
  (raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('migration 0009 on a fresh database', () => {
  it('creates the access list, empty, with the columns the routes use', () => {
    const { raw } = newTestDb();
    expect(count(raw, 'allowed_emails')).toBe(0);
    const columns = (raw.prepare('PRAGMA table_info(allowed_emails)').all() as { name: string; notnull: number; pk: number }[])
      .map((c) => [c.name, c.notnull, c.pk]);
    expect(columns).toEqual([
      ['email', 0, 1],
      ['added_by', 1, 0],
      ['added_at', 1, 0],
      ['note', 0, 0],
    ]);
  });

  it('keeps one row per address', () => {
    const { raw } = newTestDb();
    raw.exec("INSERT INTO allowed_emails (email, added_by, added_at) VALUES ('a@example.com', 'x@example.com', 'now')");
    expect(() =>
      raw.exec("INSERT INTO allowed_emails (email, added_by, added_at) VALUES ('a@example.com', 'x@example.com', 'later')"),
    ).toThrow(/UNIQUE|constraint/i);
  });

  it('is followed by the swap, price, site price and ingredient feedback migrations, which are now the last on disk', () => {
    expect(migrationFiles().at(-5)?.name).toBe(MIGRATION);
    expect(migrationFiles().at(-4)?.name).toBe('0010_swap.sql');
    expect(migrationFiles().at(-3)?.name).toBe('0011_price_household.sql');
    expect(migrationFiles().at(-2)?.name).toBe('0012_site_prices.sql');
    expect(migrationFiles().at(-1)?.name).toBe('0013_ingredient_feedback.sql');
  });
});

describe('migration 0009 on a database with 0008 applied and data in it', () => {
  it('adds the list without touching households, members or sign-ins', () => {
    const { raw } = newTestDb('0008_households.sql');
    raw.exec(`
      INSERT INTO households (id, name, data, created_at, updated_at) VALUES ('h1', 'Home', '{}', 'x', 'x');
      INSERT INTO household_members (household_id, email, role, joined_at) VALUES ('h1', 'owner@example.com', 'owner', 'x');
      INSERT INTO sessions (id_hash, email, created_at, expires_at, user_agent) VALUES ('h', 'owner@example.com', 1, 2, NULL);
    `);
    const before = {
      households: count(raw, 'households'),
      members: count(raw, 'household_members'),
      sessions: count(raw, 'sessions'),
    };

    raw.exec(sqlOf(MIGRATION));

    expect({
      households: count(raw, 'households'),
      members: count(raw, 'household_members'),
      sessions: count(raw, 'sessions'),
    }).toEqual(before);
    expect(count(raw, 'allowed_emails')).toBe(0);
  });
});
