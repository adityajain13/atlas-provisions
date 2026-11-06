// What the deal and planner reads return for one household: receipts stay with the household that recorded them,
// ratings older than the window are left out except down and never, and the 0016 indexes are in place.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RATING_WINDOW_DAYS, householdReceiptPrices, loadRatings, priceHistory } from './db';
import { newTestDb } from './testing/d1';
import { addDaysIso } from '@provisions/shared';

const TODAY = '2026-11-06';

describe('price history is scoped to the household asking', () => {
  it("leaves household B's receipts out of household A's deal history, and keeps A's own and the shared flyer rows", async () => {
    const { raw, DB } = newTestDb();
    const price = (ingredient: string, store: string, source: string, household: string, value: number) =>
      raw
        .prepare(
          `INSERT INTO price_history (ingredient_id, store, date, price_per_unit, on_sale, source, household_id, pack_qty)
           VALUES (?, ?, '2026-11-01', ?, 0, ?, ?, 1)`,
        )
        .run(ingredient, store, value, source, household);
    price('milk', 'No Frills', 'flyer', '', 4);
    price('milk', 'Walmart', 'receipt', 'a', 3.5);
    price('eggs', 'Walmart', 'receipt', 'b', 2);
    price('butter', 'No Frills', 'site', '', 6);

    const forA = await priceHistory(DB, 'a', '2026-10-01');
    expect(forA.map((h) => `${h.ingredientId}@${h.store}:${h.pricePerUnit}`).sort()).toEqual(['milk@No Frills:4', 'milk@Walmart:3.5']);

    const forB = await priceHistory(DB, 'b', '2026-10-01');
    expect(forB.map((h) => `${h.ingredientId}@${h.store}:${h.pricePerUnit}`).sort()).toEqual(['eggs@Walmart:2', 'milk@No Frills:4']);

    const forNobody = await priceHistory(DB, 'c', '2026-10-01');
    expect(forNobody.map((h) => h.ingredientId)).toEqual(['milk']);
  });

  it("does not move household A's receipt estimates when household B records a price for the same item", async () => {
    const { raw, DB } = newTestDb();
    raw
      .prepare(
        `INSERT INTO price_history (ingredient_id, store, date, price_per_unit, on_sale, source, household_id, pack_qty)
         VALUES ('milk', 'Walmart', '2026-11-01', 3.5, 0, 'receipt', 'a', 1)`,
      )
      .run();
    const before = await householdReceiptPrices(DB, 'a', '2026-10-01', TODAY);
    raw
      .prepare(
        `INSERT INTO price_history (ingredient_id, store, date, price_per_unit, on_sale, source, household_id, pack_qty)
         VALUES ('milk', 'Walmart', '2026-11-02', 1.25, 0, 'receipt', 'b', 1)`,
      )
      .run();
    expect(await householdReceiptPrices(DB, 'a', '2026-10-01', TODAY)).toEqual(before);
    expect((await priceHistory(DB, 'a', '2026-10-01')).map((h) => h.pricePerUnit)).toEqual([3.5]);
  });
});

describe('ratings read by the planner', () => {
  function rate(raw: ReturnType<typeof newTestDb>['raw'], id: string, meal: string, rating: string, date: string) {
    raw
      .prepare(
        `INSERT INTO meal_ratings (household_id, id, meal_name, person_id, rating, ingredient_ids, date)
         VALUES ('h1', ?, ?, 'p1', ?, '[]', ?)`,
      )
      .run(id, meal, rating, date);
  }

  it('reads ratings from the window, plus every down and never rating', async () => {
    const { raw, DB } = newTestDb();
    const since = addDaysIso(TODAY, -RATING_WINDOW_DAYS);
    rate(raw, 'r1', 'Old up', 'up', addDaysIso(TODAY, -200));
    rate(raw, 'r2', 'Recent up', 'up', addDaysIso(TODAY, -10));
    rate(raw, 'r3', 'Old down', 'down', addDaysIso(TODAY, -300));
    rate(raw, 'r4', 'Old never', 'never', addDaysIso(TODAY, -400));

    const windowed = await loadRatings(DB, 'h1', since);
    expect(windowed.map((r) => r.id).sort()).toEqual(['r2', 'r3', 'r4']);

    const all = await loadRatings(DB, 'h1');
    expect(all.map((r) => r.id).sort()).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  it('keeps a rating dated exactly on the window start', async () => {
    const { raw, DB } = newTestDb();
    const since = addDaysIso(TODAY, -RATING_WINDOW_DAYS);
    rate(raw, 'edge', 'Edge', 'up', since);
    expect((await loadRatings(DB, 'h1', since)).map((r) => r.id)).toEqual(['edge']);
  });
});

describe('migration 0016 indexes', () => {
  it('creates the date and week indexes on the tables the queries scan', () => {
    const { raw } = newTestDb();
    const names = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map((r) => r.name);
    for (const name of ['price_history_date', 'price_history_hh', 'meal_plans_week', 'checks_week', 'meal_status_week']) {
      expect(names).toContain(name);
    }
  });

  it('is safe to apply twice', () => {
    const { raw } = newTestDb();
    expect(() => raw.exec(readFileSync('worker/migrations/0016_indexes.sql', 'utf8'))).not.toThrow();
  });
});
