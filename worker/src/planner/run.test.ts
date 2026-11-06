import { describe, expect, it, vi } from 'vitest';
import {
  CUISINES,
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
import { REGULAR_LIMIT, runPlanner, validationContext, weekFrame, type PlanProgress } from './run';

const matched: MatchedItem[] = (flyer as FlyerItem[])
  .map(matchFlyerItem)
  .filter((m): m is MatchedItem => m !== null);

const deals: Deal[] = scoreDeals(matched, {
  history: [],
  neverBuy: [],
  alwaysBuy: [],
  allergens: [],
  shoppingDate: '2026-11-15',
  householdSize: 2,
});

// The top-ranked deal, so every fake plan uses an id that really is on offer.
const DEAL_ID = deals[0]!.ingredientId;
const DEAL_UNIT_QTY = INGREDIENT_BY_ID[DEAL_ID]!.baseUnit === 'each' ? 1 : 0.1;
// The fake meals rotate through a few kilogram deals, three cells each, so no one ingredient is in more than three meals
// (the repeat limit). Every one is kilograms, so the quantity stays DEAL_UNIT_QTY.
const SPREAD_IDS = [...new Set(deals.map((d) => d.ingredientId))]
  .filter((id) => INGREDIENT_BY_ID[id]!.baseUnit === 'kg')
  .slice(0, 8);
/** The ingredient for the cell at `cellIndex` when a fake meal uses DEAL_ID. */
const spreadId = (cellIndex: number) => SPREAD_IDS[Math.floor(cellIndex / 3) % SPREAD_IDS.length]!;

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
  return { weekOf: '2026-11-15', budget: 150, cravings: [], overrides: [], useItUp: true, ...over };
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
      ingredients: [{ id: ingredientId === DEAL_ID ? spreadId(i) : ingredientId, qty }],
      activeMinutes: 20,
      steps: ['Cook'],
      tags: [],
    })),
  };
}

/** Client that returns the scripted plans in order and records a snapshot of each payload. */
function fakeClient(plans: RawPlan[]) {
  const seen: { system: unknown; payload: { feedback?: { check: string; severity: string }[] } }[] = [];
  const submitPlan = vi.fn(async (system: unknown, payload: unknown) => {
    seen.push({ system, payload: structuredClone(payload) as (typeof seen)[number]['payload'] });
    const plan = plans[Math.min(seen.length - 1, plans.length - 1)];
    if (!plan) throw new Error('no scripted plan');
    return plan;
  });
  const client: PlannerClient = { submitPlan };
  return { client, submitPlan, seen };
}


/**
 * A model that answers each call with `answer(payload, call)`. Each payload is kept, so tests can see what was asked.
 * A repair's payload names only the slots it asks for, so an answer that fills only those is what the model would give.
 */
function scriptedModel(answer: (payload: { slots: { id: string }[] }, call: number) => RawPlan) {
  const seen: { system: unknown; payload: { feedback?: { check: string; severity: string }[]; slots: { id: string }[] } & Record<string, unknown> }[] = [];
  const submitPlan = vi.fn(async (system: unknown, payload: unknown) => {
    seen.push({ system, payload: structuredClone(payload) as (typeof seen)[number]['payload'] });
    return answer(payload as { slots: { id: string }[] }, seen.length);
  });
  const client: PlannerClient = { submitPlan };
  return { client, submitPlan, seen };
}

/** Meals for the given slots only, each using `ingredientId` at `qty(slotId)`. Meal ids follow the full week's cell order. */
function mealsForSlots(all: SlotCell[], slots: { id: string }[], ingredientId: string, qty: (slotId: string) => number): RawPlan {
  return {
    notes: 'fake',
    meals: slots.map((slot) => {
      const i = all.findIndex((c) => `${c.day}-${c.slot}` === slot.id);
      return {
        id: `m${i}`,
        slotId: slot.id,
        name: `Meal ${slot.id}`,
        ingredients: [{ id: ingredientId === DEAL_ID ? spreadId(i) : ingredientId, qty: qty(slot.id) }],
        activeMinutes: 20,
        steps: ['Cook'],
        tags: [],
      };
    }),
  };
}

describe('runPlanner', () => {
  it('repairs a plan far over budget by rewriting its three most expensive meals, then keeps the valid one', async () => {
    const h = household();
    const req = request({ budget: 150 });
    const cells = cellsOf(h, req);
    // The first two cells are far over budget; the rest of the week is cheap.
    const expensive = (slotId: string) => (slotId === `${cells[0]!.day}-${cells[0]!.slot}` || slotId === `${cells[1]!.day}-${cells[1]!.slot}` ? 200 : DEAL_UNIT_QTY);
    const { client, submitPlan, seen } = scriptedModel((payload, call) =>
      call === 1 ? mealsForSlots(cells, cells.map((c) => ({ id: `${c.day}-${c.slot}` })), DEAL_ID, expensive) : mealsForSlots(cells, payload.slots, DEAL_ID, () => DEAL_UNIT_QTY),
    );

    const plan = await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [] });

    expect(submitPlan).toHaveBeenCalledTimes(2);
    expect(seen[0]!.payload.feedback).toBeUndefined(); // a first attempt has no feedback
    // The repair asks only for the expensive slots (the gap is over 15% of the budget, so three), and says so with the errors as feedback.
    expect(seen[1]!.payload.slots.map((s) => s.id).slice(0, 2)).toEqual([`${cells[0]!.day}-${cells[0]!.slot}`, `${cells[1]!.day}-${cells[1]!.slot}`]);
    expect(seen[1]!.payload.slots).toHaveLength(3);
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
    // One made-up ingredient in every meal is also over the repeat limit, so repetition errors are expected too.
    expect(errors.every((i) => i.check === 'unknown-ingredient' || i.check === 'repetition')).toBe(true);
    expect(errors.some((i) => i.check === 'unknown-ingredient')).toBe(true);
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

  it('sends never-buy names to the planner, and errors on a meal named after one', async () => {
    const h = household({ itemRules: [{ id: 'r1', name: 'beef', rule: 'never' }] });
    const req = request();
    const cells = cellsOf(h, req);
    const raw = planFor(cells, DEAL_ID, DEAL_UNIT_QTY);
    raw.meals[0]!.name = 'Beef stir-fry';
    const { client, seen } = fakeClient([raw]);

    const plan = await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [], maxAttempts: 1 });

    expect(plan.issues.find((i) => i.check === 'never-buy')).toMatchObject({ severity: 'error' });
    expect(seen[0]!.payload).toMatchObject({ neverBuyWords: ['beef'] });
  });

  it('plans a meal whose name only has the word inside another word, with no never-buy error', async () => {
    const h = household({ itemRules: [{ id: 'r1', name: 'beef', rule: 'never' }] });
    const req = request();
    const cells = cellsOf(h, req);
    const raw = planFor(cells, DEAL_ID, DEAL_UNIT_QTY);
    raw.meals[0]!.name = 'Beefy chili';
    const { client } = fakeClient([raw]);

    const plan = await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [], maxAttempts: 1 });

    expect(plan.issues.some((i) => i.check === 'never-buy')).toBe(false);
  });
});

describe('runPlanner: pantry and ratings', () => {
  it('offers pantry stock, takes it off the list, and asks for stock due soon to be used', async () => {
    const h = household();
    const req = request({ useItUp: true });
    const cells = cellsOf(h, req);
    const pantry = [
      {
        id: 'p1',
        ingredientId: DEAL_ID,
        qty: 1000,
        unit: INGREDIENT_BY_ID[DEAL_ID]!.baseUnit,
        addedOn: '2026-11-10',
        expiresOn: '2026-11-13',
        source: 'manual' as const,
      },
    ];
    const { client, seen } = fakeClient([planFor(cells, DEAL_ID, DEAL_UNIT_QTY)]);

    const plan = await runPlanner({
      household: h,
      request: req,
      deals,
      matched,
      client,
      recentDinnerNames: [],
      neverBuy: [],
      pantry,
      today: '2026-11-12',
    });

    const payload = seen[0]!.payload as unknown as { available: { id: string; source: string; packQty: number }[]; useFirst: string[] };
    expect(payload.available.find((a) => a.id === DEAL_ID)).toMatchObject({ source: 'pantry', packQty: 1000 });
    expect(payload.useFirst).toContain(DEAL_ID);
    expect(plan.list.find((i) => i.ingredientId === DEAL_ID)).toBeUndefined();
    expect(plan.issues.filter((i) => i.check === 'use-it-up')).toEqual([]);
  });

  it('ignores pantry stock past its use-by date', async () => {
    const h = household();
    const req = request();
    const cells = cellsOf(h, req);
    const pantry = [
      { id: 'old', ingredientId: DEAL_ID, qty: 1000, unit: INGREDIENT_BY_ID[DEAL_ID]!.baseUnit, addedOn: '2026-10-01', expiresOn: '2026-10-08', source: 'manual' as const },
    ];
    const { client, seen } = fakeClient([planFor(cells, DEAL_ID, DEAL_UNIT_QTY)]);

    await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [], pantry, today: '2026-11-12' });

    const payload = seen[0]!.payload as unknown as { available: { source: string }[]; useFirst: string[] };
    expect(payload.available.some((a) => a.source === 'pantry')).toBe(false);
    expect(payload.useFirst).toBeUndefined();
  });

  it('sends favourites and avoid to the planner, and flags a never-again meal', async () => {
    const h = household();
    const req = request();
    const cells = cellsOf(h, req);
    const ratings = { favourites: ['Chili'], avoid: ['Fish tacos'], never: ['Meal thu dinner'] };
    const { client, seen } = fakeClient([planFor(cells, DEAL_ID, DEAL_UNIT_QTY)]);

    const plan = await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [], ratings, today: '2026-11-12' });

    const payload = seen[0]!.payload as unknown as { favourites: string[]; avoid: string[] };
    expect(payload.favourites).toEqual(['Chili']);
    expect(payload.avoid).toEqual(['Fish tacos', 'Meal thu dinner']);
    expect(plan.issues.some((i) => i.check === 'never-again' && i.severity === 'error')).toBe(true);
  });
});

describe('runPlanner: prep in the same call', () => {
  /** A prep list for one step, serving the given meal ids. */
  const prepWith = (task: string, forMeals: string[]) => ({ day: 'sun', steps: [{ task, minutes: 10, forMeals }] });
  const isPrepIssue = (i: { check: string }) => i.check === 'prep';
  const PREP_MISSING = { check: 'prep', severity: 'warning', message: "Prep plan wasn't included; tap Regenerate prep." };

  it('returns the prep from the same call, with ids, rounded minutes and only this plan\'s meal ids', async () => {
    const h = household();
    const req = request();
    const cells = cellsOf(h, req);
    const raw: RawPlan = {
      ...planFor(cells, DEAL_ID, DEAL_UNIT_QTY),
      prep: {
        day: 'sun',
        steps: [
          { id: 'whatever', task: 'Cook rice', minutes: 20.4, forMeals: ['m0', 'ghost-meal'], storage: 'fridge, 4 days' },
          { id: 'x', task: 'Chop onion', minutes: 5, forMeals: ['m1'] },
        ],
      },
    };
    const { client, submitPlan, seen } = fakeClient([raw]);

    const plan = await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [] });

    expect(submitPlan).toHaveBeenCalledTimes(1);
    expect(plan.prep).toEqual({
      day: 'sun',
      steps: [
        { id: 'prep-1', task: 'Cook rice', minutes: 20, forMeals: ['m0'], day: 'sun', storage: { method: 'fridge', how: '', keepsDays: 4 } },
        { id: 'prep-2', task: 'Chop onion', minutes: 5, forMeals: ['m1'], day: 'sun' },
      ],
      totalMinutes: 25,
    });
    expect(plan.issues.filter(isPrepIssue)).toEqual([]);
    expect((seen[0]!.payload as unknown as { prepDay: string }).prepDay).toBe('sun');
  });

  it('takes the prep from the attempt that is retried and then kept', async () => {
    const h = household();
    const req = request({ budget: 150 });
    const cells = cellsOf(h, req);
    const expensive = (slotId: string) => (slotId === `${cells[0]!.day}-${cells[0]!.slot}` ? 200 : DEAL_UNIT_QTY);
    const first: RawPlan = { ...mealsForSlots(cells, cells.map((c) => ({ id: `${c.day}-${c.slot}` })), DEAL_ID, expensive), prep: prepWith('First attempt prep', ['m0']) };
    const { client, submitPlan } = scriptedModel((payload, call) =>
      call === 1
        ? first
        : { ...mealsForSlots(cells, payload.slots, DEAL_ID, () => DEAL_UNIT_QTY), prep: prepWith('Second attempt prep', ['m0']) },
    );

    const plan = await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [] });

    expect(submitPlan).toHaveBeenCalledTimes(2);
    expect(plan.prep?.steps.map((s) => s.task)).toEqual(['Second attempt prep']);
  });

  it('keeps the prep of the attempt with the fewest errors, not the last attempt', async () => {
    const h = household();
    const req = request();
    const cells = cellsOf(h, req);
    const withBadCells = (n: number, task: string): RawPlan => {
      const plan = planFor(cells, DEAL_ID, DEAL_UNIT_QTY);
      plan.meals.slice(0, n).forEach((m) => (m.ingredients = [{ id: 'not-a-real-ingredient', qty: 1 }]));
      return { ...plan, prep: prepWith(task, ['m0']) };
    };
    const { client } = fakeClient([withBadCells(cells.length, 'Worst attempt'), withBadCells(1, 'Best attempt'), withBadCells(3, 'Last attempt')]);

    const plan = await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [] });

    expect(plan.attempts).toBe(3);
    expect(plan.issues.filter((i) => i.severity === 'error')).toHaveLength(1);
    expect(plan.prep?.steps.map((s) => s.task)).toEqual(['Best attempt']);
  });

  it.each([
    ['is missing', undefined],
    ['is the wrong shape', { steps: [{ task: '', minutes: 5, forMeals: [] }] }],
  ])('warns and does not retry when the prep %s', async (_label, prep) => {
    const h = household();
    const req = request();
    const cells = cellsOf(h, req);
    const raw: RawPlan = { ...planFor(cells, DEAL_ID, DEAL_UNIT_QTY), prep };
    const { client, submitPlan } = fakeClient([raw]);

    const plan = await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [] });

    expect(submitPlan).toHaveBeenCalledTimes(1);
    expect(plan.attempts).toBe(1);
    expect(plan.prep).toBeUndefined();
    expect(plan.issues.filter(isPrepIssue)).toEqual([PREP_MISSING]);
    expect(plan.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('sends no prep day and no prep warning when the household has no prep day', async () => {
    const h = household({ prepDay: null });
    const req = request();
    const cells = cellsOf(h, req);
    const raw: RawPlan = { ...planFor(cells, DEAL_ID, DEAL_UNIT_QTY), prep: prepWith('Ignored prep', ['m0']) };
    const { client, seen } = fakeClient([raw]);

    const plan = await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [] });

    expect((seen[0]!.payload as unknown as { prepDay?: unknown }).prepDay).toBeUndefined();
    expect(plan.prep).toBeUndefined();
    expect(plan.issues.filter(isPrepIssue)).toEqual([]);
  });
});

describe('runPlanner: targeted repair', () => {
  const SUN_DINNER = 'sun-dinner';

  it('a repair writes only the meal that failed, and the rest of the week is sent back as it was', async () => {
    const h = household();
    const req = request();
    const cells = cellsOf(h, req);
    const first = planFor(cells, DEAL_ID, DEAL_UNIT_QTY);
    first.meals = first.meals.map((m) => (m.slotId === SUN_DINNER ? { ...m, ingredients: [{ id: 'not-a-real-ingredient', qty: 1 }] } : m));
    const { client, submitPlan, seen } = scriptedModel((payload, call) =>
      call === 1 ? first : mealsForSlots(cells, payload.slots, DEAL_ID, () => DEAL_UNIT_QTY),
    );

    const plan = await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [] });

    expect(submitPlan).toHaveBeenCalledTimes(2);
    const repair = seen[1]!.payload as unknown as { slots: { id: string }[]; keptMeals: { id: string; name: string }[]; replacing: string[] };
    expect(repair.slots.map((s) => s.id)).toEqual([SUN_DINNER]);
    expect(repair.replacing).toEqual(['Meal sun dinner']);
    expect(repair.keptMeals).toHaveLength(cells.length - 1);
    const sunDinnerId = first.meals.find((m) => m.slotId === SUN_DINNER)!.id;
    expect(repair.keptMeals.some((k) => k.id === sunDinnerId)).toBe(false);
    // Every kept meal comes back in the plan with the same id, name and ingredients.
    const kept = plan.meals.filter((m) => `${m.day}-${m.slot}` !== SUN_DINNER);
    expect(kept.map((m) => [m.id, m.name, m.ingredients])).toEqual(
      repair.keptMeals.map((k) => [k.id, k.name, first.meals.find((r) => r.id === k.id)!.ingredients.map((i) => ({ ingredientId: i.id, qty: i.qty, unit: expect.any(String) }))]),
    );
    expect(plan.meals).toHaveLength(cells.length);
    expect(plan.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('reports each step in order: writing, checking, fixing the meals over budget, then checking again', async () => {
    const h = household();
    const req = request({ budget: 150 });
    const cells = cellsOf(h, req);
    const expensive = (slotId: string) => (slotId === `${cells[0]!.day}-${cells[0]!.slot}` || slotId === `${cells[1]!.day}-${cells[1]!.slot}` ? 200 : DEAL_UNIT_QTY);
    const events: PlanProgress[] = [];
    const { client } = scriptedModel((payload, call) =>
      call === 1 ? mealsForSlots(cells, cells.map((c) => ({ id: `${c.day}-${c.slot}` })), DEAL_ID, expensive) : mealsForSlots(cells, payload.slots, DEAL_ID, () => DEAL_UNIT_QTY),
    );

    await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [], onProgress: (p) => events.push(p) });

    expect(events).toEqual([
      { stage: 'writing', attempt: 1 },
      { stage: 'checking', attempt: 1 },
      { stage: 'fixing', attempt: 2, meals: 3, reason: 'budget' },
      { stage: 'checking', attempt: 2 },
    ]);
  });

  it('gives up after three attempts when repairs keep failing, and records each attempt', async () => {
    const h = household();
    const req = request();
    const cells = cellsOf(h, req);
    const { client, submitPlan } = scriptedModel((payload) => mealsForSlots(cells, payload.slots, 'not-a-real-ingredient', () => 1));

    const plan = await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [] });

    expect(submitPlan).toHaveBeenCalledTimes(3);
    expect(plan.attempts).toBe(3);
    expect(plan.timings?.attempts.map((a) => a.mode)).toEqual(['full', 'repair', 'repair']);
    expect(plan.timings?.attempts.map((a) => a.replaced)).toEqual([cells.length, cells.length, cells.length]);
    expect(plan.timings?.attempts.every((a) => a.errors > 0)).toBe(true);
  });

  it('a plan that is right first time records one full attempt, and a total time', async () => {
    const h = household();
    const req = request();
    const cells = cellsOf(h, req);
    const { client } = scriptedModel(() => planFor(cells, DEAL_ID, DEAL_UNIT_QTY));
    let clock = 0;

    const plan = await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [], now: () => (clock += 5) });

    expect(plan.timings?.attempts).toEqual([{ ms: 5, mode: 'full', replaced: cells.length, errors: 0 }]);
    expect(plan.timings?.totalMs).toBeGreaterThan(0);
  });

  it('a week with nothing to plan records no attempts', async () => {
    const h = household({ people: [] });
    const req = request();
    const { client, submitPlan } = scriptedModel(() => ({ notes: '', meals: [] }));

    const plan = await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [] });

    expect(submitPlan).not.toHaveBeenCalled();
    expect(plan.timings).toEqual({ totalMs: 0, attempts: [] });
  });
});

describe('weekFrame: food forms and dishes', () => {
  const request: PlanRequest = { weekOf: '2026-11-15', budget: 150, cravings: [], overrides: [], useItUp: false };
  const dealOf = (ingredientId: string): Deal => ({
    ingredientId,
    store: 'No Frills',
    pricePerUnit: 3,
    packQty: 1,
    packPrice: 3,
    discountPct: 0.2,
    baseline: 4,
    validTo: '2026-11-18',
    score: 0.5,
  });

  it('takes the forms the household does not keep out of the deals and what the planner may use', () => {
    const h = household({ forms: { fish: ['fresh', 'frozen'] }, avoidDishes: ['slaw'] });
    const frame = weekFrame({
      household: h,
      request,
      deals: [dealOf('canned-tuna'), dealOf('salmon-fillet')],
      matched: [],
      neverBuy: [],
      recentDinnerNames: [],
      today: '2026-11-15',
    });
    expect(frame.formBlocked.has('canned-tuna')).toBe(true);
    expect(frame.deals.map((d) => d.ingredientId)).toEqual(['salmon-fillet']);
    expect(frame.available.filter((a) => a.source === 'deal').map((a) => a.id)).toEqual(['salmon-fillet']);
    const ctx = validationContext(frame);
    expect(ctx.formBlocked?.has('canned-tuna')).toBe(true);
    expect(ctx.avoidDishes).toEqual(['slaw']);
  });

  it('keeps every form when the household has not chosen any', () => {
    const frame = weekFrame({
      household: household(),
      request,
      deals: [dealOf('canned-tuna')],
      matched: [],
      neverBuy: [],
      recentDinnerNames: [],
      today: '2026-11-15',
    });
    expect(frame.formBlocked.size).toBe(0);
    expect(frame.available.filter((a) => a.source === 'deal').map((a) => a.id)).toEqual(['canned-tuna']);
  });
});

describe('ingredient changes reach the planner', () => {
  it('sends the household feedback signals with every planner call', async () => {
    const h = household();
    const req = request();
    const cells = cellsOf(h, req);
    const feedback = { oftenSkipped: ['cilantro'], preferredSwaps: [{ from: 'sour-cream', to: 'Greek yogurt', toId: 'greek-yogurt' }] };
    const { client, seen } = fakeClient([planFor(cells, DEAL_ID, DEAL_UNIT_QTY)]);

    await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [], feedback });

    const payload = seen[0]!.payload as unknown as { ingredientFeedback: unknown };
    expect(payload.ingredientFeedback).toEqual(feedback);
  });
});

describe('regular items offered to the planner', () => {
  it('are capped at REGULAR_LIMIT, even when every cuisine is often', () => {
    const everyCuisineOften = Object.fromEntries(CUISINES.map((c) => [c.key, 'often' as const]));
    const frame = weekFrame({
      household: household({ cuisines: everyCuisineOften }),
      request: request(),
      deals,
      matched,
      recentDinnerNames: [],
      neverBuy: [],
      today: '2026-11-06',
    });
    const regular = frame.available.filter((a) => a.source === 'regular');
    expect(regular).toHaveLength(REGULAR_LIMIT);
    expect(new Set(regular.map((a) => a.id)).size).toBe(regular.length);
  });
});

describe('runPlanner: cravings the household never buys, the time limit, and a week with no prep day', () => {
  it('drops a craving the never-buy list names, with a warning, and does not send it to the planner', async () => {
    const h = household({ itemRules: [{ id: 'nb1', name: 'beef', rule: 'never' }] });
    const req = request({ cravings: ['beef stir-fry'] });
    const cells = cellsOf(h, req);
    const { client, seen } = scriptedModel((payload) => mealsForSlots(cells, payload.slots, DEAL_ID, () => DEAL_UNIT_QTY));

    const plan = await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [] });

    expect(seen[0]!.payload).not.toHaveProperty('cravings');
    expect(plan.request.cravings).toEqual([]);
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ check: 'cravings', severity: 'warning', message: 'Craving "beef stir-fry" is on your never-buy list, so it is not planned.' }),
    );
  });

  it('starts no new attempt once 150 seconds have passed, and returns the best attempt so far with its errors', async () => {
    const h = household({ prepDay: null });
    const req = request();
    const cells = cellsOf(h, req);
    const bad = planFor(cells, 'not-a-real-ingredient', 1);
    let clock = 0;
    const submitPlan = vi.fn(async () => {
      clock += 100_000; // each call takes 100 s on the clock
      return bad;
    });

    const plan = await runPlanner({ household: h, request: req, deals, matched, client: { submitPlan }, recentDinnerNames: [], neverBuy: [], now: () => clock });

    expect(submitPlan).toHaveBeenCalledTimes(2); // the second attempt ends at 200 s, so no third starts
    expect(plan.attempts).toBe(2);
    expect(plan.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('sends a system prompt without the prep rules when the household has no prep day', async () => {
    const h = household({ prepDay: null });
    const req = request();
    const cells = cellsOf(h, req);
    const { client, seen } = scriptedModel((payload) => mealsForSlots(cells, payload.slots, DEAL_ID, () => DEAL_UNIT_QTY));

    await runPlanner({ household: h, request: req, deals, matched, client, recentDinnerNames: [], neverBuy: [], maxAttempts: 1 });

    const system = seen[0]!.system as { cached: string; uncached?: string };
    expect(system.cached).not.toContain('Prep rule:');
    expect(system.uncached).toBeUndefined();
  });

  it('never offers an ingredient the never-buy list covers, even from pantry stock', () => {
    const h = household();
    const req = request();
    const pantry = [{ id: 'p1', ingredientId: DEAL_ID, qty: 1, unit: INGREDIENT_BY_ID[DEAL_ID]!.baseUnit, addedOn: '2026-11-10', expiresOn: '2026-12-10', source: 'manual' as const }];
    const frame = weekFrame({ household: h, request: req, deals, matched, neverBuy: [DEAL_ID], pantry, recentDinnerNames: [], today: '2026-11-12' });
    expect(frame.available.some((a) => a.id === DEAL_ID)).toBe(false);
  });
});

