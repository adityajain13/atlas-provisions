// Migration 0008 on real SQLite: a database as it was before households (migrations 0001 to 0007, with data),
// then 0008, then the checks. An empty database gets the same migrations and no households.
import { describe, expect, it } from 'vitest';
import { defaultHousehold } from '@provisions/shared';
import { migrationFiles, newTestDb } from './testing/d1';

const MIGRATION = '0008_households.sql';

function sqlOf(name: string): string {
  const m = migrationFiles().find((f) => f.name === name);
  if (!m) throw new Error(`no migration ${name}`);
  return m.sql;
}

/** The household document as the app stored it before households, with a postal code and one person. */
const legacyHousehold = JSON.stringify({
  ...defaultHousehold(),
  people: [{ id: 'p1', name: 'Sam', dietTags: [], allergies: [] }],
  postalCode: 'M5V2T6',
});

/** A database as production had it before 0008: every earlier migration, with rows in each table. */
function legacyDb() {
  const { raw, DB } = newTestDb('0007_checks.sql');
  raw.exec(`
    INSERT INTO household (id, data, updated_at) VALUES (1, '${legacyHousehold.replace(/'/g, "''")}', '2026-10-01T10:00:00.000Z');
    INSERT INTO pantry_items (id, ingredient_id, qty, unit, added_on, expires_on, source)
      VALUES ('pan-1', 'milk', 1, 'l', '2026-10-01', '2026-10-08', 'manual'),
             ('pan-2', 'eggs', 12, 'each', '2026-10-02', '2026-10-20', 'receipt');
    INSERT INTO meal_plans (week_of, data, created_at) VALUES ('2026-10-25', '{"weekOf":"2026-10-25"}', '2026-10-20T12:00:00.000Z');
    INSERT INTO meal_ratings (id, meal_name, person_id, rating, ingredient_ids, date) VALUES ('r-1', 'Dal', 'p1', 'up', '[]', '2026-10-21');
    INSERT INTO checks (week_of, kind, item_id, checked, updated_at, updated_by)
      VALUES ('2026-10-25', 'list', 'milk', 1, '2026-10-25T09:00:00.000Z', 'owner@example.com'),
             ('2026-10-25', 'prep', 'onions', 0, '2026-10-25T09:05:00.000Z', NULL);
    INSERT INTO sessions (id_hash, email, created_at, expires_at, user_agent) VALUES
      ('h-late', 'partner@example.com', 1790000000000, 1900000000000, NULL),
      ('h-early', 'Owner@Example.com', 1780000000000, 1900000000000, NULL),
      ('h-again', ' OWNER@example.com ', 1785000000000, 1900000000000, NULL);
    INSERT INTO login_codes (email, code_hash, link_hash, created_at, expires_at, attempts)
      VALUES ('pending@example.com', 'x', 'y', 1, 2, 0);
    INSERT INTO flyer_items (id, store, raw_name, price_text, size_text, valid_from, valid_to, source, fetched_at) VALUES
      ('f-1', 'No Frills', 'Milk 2L', '$4.49', NULL, '2026-10-29', '2026-11-04', 'flipp', '2026-10-29T12:00:00.000Z'),
      ('f-2', 'FreshCo', 'Eggs 12', '$3.99', '12 ea', '2026-10-29', '2026-11-04', 'flipp', '2026-10-29T12:00:00.000Z');
    INSERT INTO price_history (ingredient_id, store, date, price_per_unit, on_sale, source)
      VALUES ('milk', 'No Frills', '2026-10-29', 2.24, 1, 'flipp');
    INSERT INTO item_matches (raw_key, ingredient_id, pack_qty, confidence, confirmed, updated_at)
      VALUES ('milk 2l', 'milk', 2, 0.9, 1, '2026-10-29T12:00:00.000Z');
    INSERT INTO ingest_runs (id, started_at, finished_at, ok, terms, items, stored, matched, errors, sample)
      VALUES ('run-1', '2026-10-29T12:00:00.000Z', '2026-10-29T12:03:00.000Z', 1, 0, 2, 2, 2, '[]', '[]');
  `);
  return { raw, DB };
}

const count = (raw: ReturnType<typeof newTestDb>['raw'], table: string, where = '1 = 1') =>
  (raw.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;

describe('migration 0008 on a database with data', () => {
  it('moves the household, its rows and its members into h1, and keeps every row', () => {
    const { raw } = legacyDb();
    const before = {
      household: count(raw, 'household'),
      pantry: count(raw, 'pantry_items'),
      plans: count(raw, 'meal_plans'),
      ratings: count(raw, 'meal_ratings'),
      checks: count(raw, 'checks'),
      sessions: count(raw, 'sessions'),
      flyers: count(raw, 'flyer_items'),
      prices: count(raw, 'price_history'),
      matches: count(raw, 'item_matches'),
      runs: count(raw, 'ingest_runs'),
    };
    const legacyRow = raw.prepare('SELECT data, updated_at FROM household WHERE id = 1').get();

    raw.exec(sqlOf(MIGRATION));

    // The old household row stays exactly as it was.
    expect(count(raw, 'household')).toBe(before.household);
    expect(raw.prepare('SELECT data, updated_at FROM household WHERE id = 1').get()).toEqual(legacyRow);

    // One household, h1, named Home, with the same document.
    const hh = raw.prepare("SELECT id, name, data, created_at, updated_at FROM households").all();
    expect(hh).toEqual([
      { id: 'h1', name: 'Home', data: legacyHousehold, created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-01T10:00:00.000Z' },
    ]);

    // Members: every distinct lower-cased address that has a session. The earliest is the owner. Pending
    // login codes are not members.
    const members = raw
      .prepare('SELECT household_id, email, role, joined_at FROM household_members ORDER BY joined_at')
      .all();
    expect(members).toEqual([
      { household_id: 'h1', email: 'owner@example.com', role: 'owner', joined_at: '2026-05-28T20:26:40.000Z' },
      { household_id: 'h1', email: 'partner@example.com', role: 'member', joined_at: '2026-09-21T14:13:20.000Z' },
    ]);

    // Every existing row lands in h1, and none is lost.
    expect(count(raw, 'pantry_items', "household_id = 'h1'")).toBe(before.pantry);
    expect(count(raw, 'meal_plans', "household_id = 'h1'")).toBe(before.plans);
    expect(count(raw, 'meal_ratings', "household_id = 'h1'")).toBe(before.ratings);
    expect(count(raw, 'checks', "household_id = 'h1'")).toBe(before.checks);
    expect(count(raw, 'sessions')).toBe(before.sessions);
    expect(count(raw, 'flyer_items')).toBe(before.flyers);
    expect(count(raw, 'price_history')).toBe(before.prices);
    expect(count(raw, 'item_matches')).toBe(before.matches);
    expect(count(raw, 'ingest_runs')).toBe(before.runs);
    expect(raw.prepare('SELECT week_of, data, created_at FROM meal_plans').all()).toEqual([
      { week_of: '2026-10-25', data: '{"weekOf":"2026-10-25"}', created_at: '2026-10-20T12:00:00.000Z' },
    ]);
    expect(raw.prepare('SELECT item_id, checked, updated_by FROM checks ORDER BY item_id').all()).toEqual([
      { item_id: 'milk', checked: 1, updated_by: 'owner@example.com' },
      { item_id: 'onions', checked: 0, updated_by: null },
    ]);

    // The keys now include the household: the same week can be planned for another household.
    raw.exec(`INSERT INTO meal_plans (household_id, week_of, data, created_at) VALUES ('h_other', '2026-10-25', '{}', 'now')`);
    expect(count(raw, 'meal_plans')).toBe(before.plans + 1);

    // Flyer prices are per postal code, and the existing ones belong to the h1 postal code.
    expect(raw.prepare('SELECT DISTINCT postal_code FROM flyer_items').all()).toEqual([{ postal_code: 'M5V2T6' }]);
    expect(raw.prepare('SELECT postal_code FROM ingest_runs').all()).toEqual([{ postal_code: 'M5V2T6' }]);
    raw.exec(`INSERT INTO flyer_items (postal_code, id, store, raw_name, price_text, valid_from, valid_to, source, fetched_at)
              VALUES ('M1M1M1', 'f-1', 'No Frills', 'Milk 2L', '$4.49', '2026-10-29', '2026-11-04', 'flipp', 'now')`);
    expect(count(raw, 'flyer_items')).toBe(before.flyers + 1);

    // Pantry and ratings default to h1, so an older Worker still writes to a household.
    raw.exec(`INSERT INTO pantry_items (id, ingredient_id, qty, unit, added_on, expires_on, source)
              VALUES ('pan-3', 'rice', 1, 'kg', '2026-10-30', '2026-12-30', 'manual')`);
    expect(raw.prepare("SELECT household_id FROM pantry_items WHERE id = 'pan-3'").get()).toEqual({ household_id: 'h1' });
  });

  it('gives the flyer rows with no attributable postal code an empty postal code, and keeps them', () => {
    const { raw } = legacyDb();
    raw.exec("UPDATE household SET data = json_remove(data, '$.postalCode')");
    raw.exec(sqlOf(MIGRATION));
    expect(raw.prepare('SELECT postal_code FROM flyer_items ORDER BY id').all()).toEqual([{ postal_code: '' }, { postal_code: '' }]);
    expect(raw.prepare('SELECT postal_code FROM ingest_runs').all()).toEqual([{ postal_code: null }]);
  });

  it('creates no household and no members when the old household row is missing', () => {
    const { raw } = newTestDb('0007_checks.sql');
    raw.exec("INSERT INTO sessions (id_hash, email, created_at, expires_at, user_agent) VALUES ('h', 'owner@example.com', 1, 2, NULL)");
    raw.exec(sqlOf(MIGRATION));
    expect(count(raw, 'households')).toBe(0);
    expect(count(raw, 'household_members')).toBe(0);
  });
});

describe('migration 0008 on an empty database', () => {
  it('applies every migration cleanly and leaves no households', () => {
    const { raw } = newTestDb();
    expect(count(raw, 'households')).toBe(0);
    expect(count(raw, 'household_members')).toBe(0);
    expect(count(raw, 'household_invites')).toBe(0);
    expect(count(raw, 'usage')).toBe(0);
    expect(count(raw, 'pantry_items')).toBe(0);
    expect(count(raw, 'flyer_items')).toBe(0);
  });

  it('keeps the key of each rebuilt table, so the same week and item cannot repeat within a household', () => {
    const { raw } = newTestDb();
    raw.exec("INSERT INTO meal_plans (household_id, week_of, data, created_at) VALUES ('h1', '2026-11-01', '{}', 'x')");
    expect(() =>
      raw.exec("INSERT INTO meal_plans (household_id, week_of, data, created_at) VALUES ('h1', '2026-11-01', '{}', 'y')"),
    ).toThrow(/UNIQUE|constraint/i);
    raw.exec("INSERT INTO checks (household_id, week_of, kind, item_id, checked, updated_at) VALUES ('h1', '2026-11-01', 'list', 'a', 1, 'x')");
    expect(() =>
      raw.exec("INSERT INTO checks (household_id, week_of, kind, item_id, checked, updated_at) VALUES ('h1', '2026-11-01', 'list', 'a', 0, 'y')"),
    ).toThrow(/UNIQUE|constraint/i);
  });

  it('is followed by the access, swap and price migrations, which are now the last on disk', () => {
    const names = migrationFiles().map((f) => f.name);
    expect(names[names.indexOf(MIGRATION) + 1]).toBe('0009_access.sql');
    expect(names[names.indexOf(MIGRATION) + 2]).toBe('0010_swap.sql');
    expect(names[names.indexOf(MIGRATION) + 3]).toBe('0011_price_household.sql');
    expect(migrationFiles().at(-1)?.name).toBe('0011_price_household.sql');
  });
});
