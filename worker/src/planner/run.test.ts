import { describe, expect, it, vi } from 'vitest';
import {
  INGREDIENT_BY_ID,
  defaultHousehold,
  expandWeek,
  matchFlyerItem,
  scoreDeals,
  type Deal,
  type FixedMeal,
  type FlyerItem,
  type Household,
  type MatchedItem,
  type PlanRequest,
  type RawPlan,
  type SlotCell,
} from '@provisions/shared';
import flyer from '../../fixtures/flyer-sample.json';
import type { PlannerClient } from './claude';
import { runPlanner } from './run';

const matched: MatchedItem[] = (flyer as FlyerItem[])
  .map(matchFlyerItem)
  .filter((m): m is MatchedItem => m !== null);

const deals: Deal[] = scoreDeals(matched, {
  history: [],
  neverBuy: [],
  alwaysBuy: [],
  allergens: [],
  shoppingDate: '2026-11-12',
  householdSize: 2,
});

// The top-ranked deal, so every fake plan uses an id that really is on offer.
const DEAL_ID = deals[0]!.ingredientId;
const DEAL_UNIT_QTY = INGREDIENT_BY_ID[DEAL_ID]!.baseUnit === 'each' ? 1 : 0.1;

function household(over: Partial<Household> = {}): Household {
  const h = defaultHousehold();
  const stores = h.stores.map((s) => ({ ...s, enabled: ['No Frills', 'FreshCo', 'Walmart'].includes(s.name) }));
  return {
    ...h,
    stores,
    people: [
      { id: 'ann', name: 'Ann', dietTags: [], allergies: [] },
      { id: 'ben', name: 'Ben', dietTags: [], allergies: [] },
    ],
    ...over,
  };
}

function request(over: Partial<PlanRequest> = {}): PlanRequest {
  return { weekOf: '2026-11-12', budget: 150, cravings: [], overrides: [], useItUp: true, ...over };
}

function cellsOf(h: Household, req: PlanRequest): SlotCell[] {
  return expandWeek(h, req).cells;
}

/** One meal per cell, each using `ingredientId` at `qty`. */
function planFor(cells: SlotCell[], ingredientId: string, qty: number): RawPlan {
  return {
    notes: 'fake',
    meals: cells.map((c, i) => ({
      id: `m${i}`,
      slotId: `${c.day}-${c.slot}`,
      name: `Meal ${c.day} ${c.slot}`,
      ingredients: [{ id: ingredientId, qty }],
      activeMinutes: 20,
      steps: ['Cook'],
      tags: [],
    })),
  };
}

/** Client that returns the scripted plans in order and records a snapshot of each payload. */
function fakeClient(plans: RawPlan[]) {
  const seen: { system: string; payload: { feedback: { check: string; severity: string }[] | null } }[] = [];
  const submitPlan = vi.fn(async (system: string, payload: unknown) => {
    seen.push({ system, payload: structuredClone(payload) as (typeof seen)[number]['payload'] });
    const plan = plans[Math.min(seen.length - 1, plans.length - 1)];
    if (!plan) throw new Error('no scripted plan');
    return plan;
  });
  const client: PlannerClient = { submitPlan };
  return { client, submitPlan, seen };
}

describe('runPlanner', () => {
  it('retries with the errors as feedback after an over-budget plan, then keeps the valid one', async () => {
    const h = household();
    const req = request({ budget: 150 });
    const cells = cellsOf(h, req);
    const { client, submitPlan, seen } = fakeClient([
      planFor(cells, DEAL_ID, 200), // far over budget
      planFor(cells, DEAL_ID, DEAL_UNIT_QTY),
    ]);

    const plan = await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [] });

    expect(submitPlan).toHaveBeenCalledTimes(2);
    expect(seen[0]!.payload.feedback).toBeNull();
    expect(seen[1]!.payload.feedback?.some((i) => i.check === 'budget' && i.severity === 'error')).toBe(true);
    expect(plan.attempts).toBe(2);
    expect(plan.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(plan.meals).toHaveLength(cells.length);
    expect(plan.totalCost).toBeLessThanOrEqual(req.budget);
  });

  it('gives up after three attempts and keeps the errors when every plan is invalid', async () => {
    const h = household();
    const req = request();
    const cells = cellsOf(h, req);
    const bad = planFor(cells, 'not-a-real-ingredient', 1);
    const { client, submitPlan } = fakeClient([bad]);

    const plan = await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [] });

    expect(submitPlan).toHaveBeenCalledTimes(3);
    expect(plan.attempts).toBe(3);
    const errors = plan.issues.filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((i) => i.check === 'unknown-ingredient')).toBe(true);
  });

  it('keeps the attempt with the fewest errors, not the last one', async () => {
    const h = household();
    const req = request();
    const cells = cellsOf(h, req);
    // Errors per attempt: all cells bad, then one cell bad, then three cells bad.
    const withBadCells = (n: number): RawPlan => {
      const plan = planFor(cells, DEAL_ID, DEAL_UNIT_QTY);
      plan.meals.slice(0, n).forEach((m) => (m.ingredients = [{ id: 'not-a-real-ingredient', qty: 1 }]));
      return plan;
    };
    const { client } = fakeClient([withBadCells(cells.length), withBadCells(1), withBadCells(3)]);

    const plan = await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [] });

    expect(plan.attempts).toBe(3);
    expect(plan.issues.filter((i) => i.severity === 'error')).toHaveLength(1);
  });

  it('does not call the model when there are no plannable cells', async () => {
    const h = household({ people: [] });
    const req = request();
    const { client, submitPlan } = fakeClient([{ notes: '', meals: [] }]);

    const plan = await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [] });

    expect(submitPlan).not.toHaveBeenCalled();
    expect(plan.meals).toEqual([]);
    expect(plan.attempts).toBe(0);
  });

  it('costs fixed meals, lists them, and leaves their people out of the planned cells', async () => {
    const fixedMeal: FixedMeal = {
      id: 'yogurt',
      name: 'Yogurt and granola',
      personIds: ['ann'],
      days: ['mon'],
      slot: 'breakfast',
      ingredients: [{ name: 'Greek yogurt', qty: 150, unit: 'g' }],
      active: true,
    };
    const h = household({ fixedMeals: [fixedMeal] });
    const req = request();
    const cells = cellsOf(h, req);
    const { client, seen } = fakeClient([planFor(cells, DEAL_ID, DEAL_UNIT_QTY)]);

    const plan = await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [] });

    expect(plan.fixedMeals).toEqual([
      { id: 'yogurt@mon-breakfast', name: 'Yogurt and granola', day: 'mon', slot: 'breakfast', eaters: ['ann'] },
    ]);
    expect(plan.fixedCost).toBeGreaterThan(0);
    const payload = seen[0]!.payload as unknown as { fixedMeals: { name: string }[]; remainingBudget: number };
    expect(payload.fixedMeals[0]!.name).toBe('Yogurt and granola');
    expect(payload.remainingBudget).toBeCloseTo(req.budget - plan.fixedCost, 2);
    // Ben eats Monday breakfast alone in the planned cell.
    expect(cells.find((c) => c.day === 'mon' && c.slot === 'breakfast')!.eaters).toEqual(['ben']);
  });

  it('reports a never-buy ingredient from the household rules as an error', async () => {
    const h = household();
    const req = request();
    const cells = cellsOf(h, req);
    const { client } = fakeClient([planFor(cells, DEAL_ID, DEAL_UNIT_QTY)]);

    const plan = await runPlanner({
      household: h,
      request: req,
      deals,
      matched,
      client,
      recentDinnerNames: [],
      neverBuy: [DEAL_ID],
      maxAttempts: 1,
    });

    expect(plan.issues.some((i) => i.check === 'never-buy' && i.severity === 'error')).toBe(true);
  });
});
