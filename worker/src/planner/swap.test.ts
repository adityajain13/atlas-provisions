// runSwap with a scripted client: the kept meals stay as they were, the freed slots are filled, the whole week is
// checked, and prep falls back to the saved steps when the model returns none. No network.
import { describe, expect, it, vi } from 'vitest';
import {
  DAYS,
  INGREDIENT_BY_ID,
  SLOTS,
  defaultHousehold,
  matchFlyerItem,
  scoreDeals,
  type Day,
  type Deal,
  type FlyerItem,
  type Household,
  type MatchedItem,
  type MealPlan,
  type PlanRequest,
  type PlannedMeal,
  type PrepPlan,
  type RawMeal,
  type RawPlan,
  type Slot,
} from '@provisions/shared';
import flyer from '../../fixtures/flyer-sample.json';
import type { PlannerClient } from './claude';
import { SWAP_PROMPT, SYSTEM_PROMPT, type PlannerPayload } from './prompt';
import { evaluateWeek, PREP_MISSING, weekFrame } from './run';
import { runSwap } from './swap';

const matched: MatchedItem[] = (flyer as FlyerItem[]).map(matchFlyerItem).filter((m): m is MatchedItem => m !== null);
const deals: Deal[] = scoreDeals(matched, {
  history: [],
  neverBuy: [],
  alwaysBuy: [],
  allergens: [],
  shoppingDate: '2026-11-15',
  householdSize: 2,
});
const DEAL_ID = deals[0]!.ingredientId;
const DEAL_UNIT_QTY = INGREDIENT_BY_ID[DEAL_ID]!.baseUnit === 'each' ? 1 : 0.1;
// Meals rotate through a few kilogram deals, three cells each, so no one ingredient is in more than three meals (the
// repeat limit). Every one is kilograms, so the quantity stays DEAL_UNIT_QTY.
const SPREAD_IDS = [...new Set(deals.map((d) => d.ingredientId))]
  .filter((id) => INGREDIENT_BY_ID[id]!.baseUnit === 'kg')
  .slice(0, 8);
/** The ingredient for the cell at `cellIndex` in the week, in day-then-slot order. */
const spreadId = (cellIndex: number) => SPREAD_IDS[Math.floor(cellIndex / 3) % SPREAD_IDS.length]!;
const cellIndexOf = (day: Day, slot: Slot) => DAYS.indexOf(day) * SLOTS.length + SLOTS.indexOf(slot);
const WEEK = '2026-11-15';

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
    prepDay: null,
    ...over,
  };
}

const request = (over: Partial<PlanRequest> = {}): PlanRequest => ({
  weekOf: WEEK,
  budget: 150,
  cravings: [],
  overrides: [],
  useItUp: false,
  ...over,
});

const slotId = (day: Day, slot: Slot) => `${day}-${slot}`;
const label = (day: Day, slot: Slot) => `${day[0]!.toUpperCase()}${day.slice(1)} ${slot}`;

/**
 * A saved week, built without the model: one meal per cell with the household's ingredient, and a leftover chain
 * Mon dinner -> Tue lunch. Built through the same frame and evaluation the planner uses.
 */
function savedWeek(h: Household, req: PlanRequest, over: Partial<MealPlan> = {}): MealPlan {
  const frame = weekFrame({ household: h, request: req, deals, matched, neverBuy: [], recentDinnerNames: [] });
  const meals: PlannedMeal[] = frame.cells.map((c, index) => {
    const id = slotId(c.day, c.slot);
    const link: Partial<PlannedMeal> =
      id === 'mon-dinner' ? { makesLeftoversFor: 'tue-lunch' } : id === 'tue-lunch' ? { usesLeftoversFrom: 'mon-dinner' } : {};
    const leftover = id === 'tue-lunch';
    return {
      id,
      day: c.day,
      slot: c.slot,
      name: label(c.day, c.slot),
      eaters: [...c.eaters],
      ingredients: leftover ? [] : [{ ingredientId: spreadId(index), qty: DEAL_UNIT_QTY, unit: 'kg' }],
      activeMinutes: leftover ? 5 : 20,
      steps: ['Cook'],
      tags: leftover ? ['leftovers'] : [],
      ...link,
    };
  });
  return { ...evaluateWeek(frame, meals, [], 'saved'), ...over };
}

const rawMeal = (day: Day, slot: Slot, extra: Partial<RawMeal> = {}): RawMeal => ({
  id: slotId(day, slot),
  slotId: slotId(day, slot),
  name: `New ${label(day, slot)}`,
  ingredients: [{ id: spreadId(cellIndexOf(day, slot)), qty: DEAL_UNIT_QTY }],
  activeMinutes: 20,
  steps: ['Cook'],
  tags: [],
  ...extra,
});

/** The new meals for the given cells, in order. */
const newMealsFor = (cells: [Day, Slot][], extra: (day: Day, slot: Slot) => Partial<RawMeal> = () => ({})): RawMeal[] =>
  cells.map(([d, s]) => rawMeal(d, s, extra(d, s)));

/** Client that returns the scripted answers in order and records each payload and system prompt. */
function scripted(answers: RawPlan[]) {
  const seen: { system: string; payload: PlannerPayload }[] = [];
  const submitPlan = vi.fn(async (system: string, payload: unknown) => {
    seen.push({ system, payload: structuredClone(payload) as PlannerPayload });
    const answer = answers[Math.min(seen.length - 1, answers.length - 1)];
    if (!answer) throw new Error('no scripted answer');
    return answer;
  });
  const client: PlannerClient = { submitPlan };
  return { client, submitPlan, seen };
}

const kept = (plan: MealPlan, ids: string[]) => plan.meals.filter((m) => ids.includes(m.id));

describe('runSwap', () => {
  it('replaces the chosen meal and the lunch linked to it, and keeps every other meal exactly as it was', async () => {
    const h = household();
    const req = request();
    const saved = savedWeek(h, req);
    const before = JSON.stringify(saved.meals.filter((m) => m.id !== 'mon-dinner' && m.id !== 'tue-lunch'));
    const answer: RawPlan = {
      notes: 'swapped',
      meals: newMealsFor([
        ['mon', 'dinner'],
        ['tue', 'lunch'],
      ], (d, s) => (d === 'mon' && s === 'dinner' ? { makesLeftoversFor: 'tue-lunch' } : d === 'tue' ? { usesLeftoversFrom: 'mon-dinner' } : {})),
    };
    const { client, seen } = scripted([answer]);

    const out = await runSwap({ household: h, plan: saved, mealIds: ['mon-dinner'], deals, matched, neverBuy: [], recentDinnerNames: [], client });

    expect(out.swapped).toEqual(['mon-dinner', 'tue-lunch']);
    expect(out.added).toEqual(['mon-dinner', 'tue-lunch']);
    expect(JSON.stringify(out.plan.meals.filter((m) => m.id !== 'mon-dinner' && m.id !== 'tue-lunch'))).toBe(before);
    expect(out.plan.meals).toHaveLength(21);
    expect(out.plan.meals.find((m) => m.id === 'mon-dinner')!.name).toBe('New Mon dinner');
    expect(out.plan.meals.find((m) => m.id === 'tue-lunch')!.usesLeftoversFrom).toBe('mon-dinner');
    expect(out.plan.issues.filter((i) => i.severity === 'error')).toEqual([]);

    // The model saw only the freed slots, the kept meals, and the swap rules.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.system).toBe(`${SYSTEM_PROMPT}\n${SWAP_PROMPT}`);
    expect(seen[0]!.payload.slots.map((s) => s.id).sort()).toEqual(['mon-dinner', 'tue-lunch']);
    expect(seen[0]!.payload.keptMeals).toHaveLength(19);
    expect(seen[0]!.payload.replacing).toEqual([label('mon', 'dinner'), label('tue', 'lunch')]);
  });

  it('fills the linked lunch too when only the leftover lunch is chosen', async () => {
    const h = household();
    const saved = savedWeek(h, request());
    const { client } = scripted([{ notes: '', meals: newMealsFor([['mon', 'dinner'], ['tue', 'lunch']]) }]);

    const out = await runSwap({ household: h, plan: saved, mealIds: ['tue-lunch'], deals, matched, neverBuy: [], recentDinnerNames: [], client });

    expect(out.swapped).toEqual(['mon-dinner', 'tue-lunch']);
    expect(out.plan.meals.find((m) => m.id === 'mon-dinner')!.name).toBe('New Mon dinner');
  });

  it('sends the household note to the planner', async () => {
    const h = household();
    const saved = savedWeek(h, request());
    const { client, seen } = scripted([{ notes: '', meals: newMealsFor([['wed', 'dinner']]) }]);

    await runSwap({ household: h, plan: saved, mealIds: ['wed-dinner'], note: 'quicker, no fish', deals, matched, neverBuy: [], recentDinnerNames: [], client });

    expect(seen[0]!.payload.swapNote).toBe('quicker, no fish');
  });

  it('gives a new meal a fresh id when it collides with a kept meal, and renames links among the new meals', async () => {
    const h = household();
    const saved = savedWeek(h, request());
    // The model reuses the id of the kept Wed dinner for the new Mon dinner, and links the new Tue lunch to a kept meal.
    const { client } = scripted([
      {
        notes: '',
        meals: [
          rawMeal('mon', 'dinner', { id: 'wed-dinner', makesLeftoversFor: 'tue-lunch' }),
          rawMeal('tue', 'lunch', { id: 'tue-lunch', usesLeftoversFrom: 'sun-dinner' }),
        ],
      },
    ]);

    const out = await runSwap({ household: h, plan: saved, mealIds: ['mon-dinner'], deals, matched, neverBuy: [], recentDinnerNames: [], client });

    const ids = out.plan.meals.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(out.plan.meals.find((m) => m.id === 'wed-dinner')!.name).toBe(label('wed', 'dinner'));
    const newMon = out.plan.meals.find((m) => m.name === 'New Mon dinner')!;
    const newTue = out.plan.meals.find((m) => m.name === 'New Tue lunch')!;
    expect(newMon.id).toBe('wed-dinner-2');
    expect(newMon.makesLeftoversFor).toBe(newTue.id);
    expect(newTue.usesLeftoversFrom).toBeUndefined(); // sun-dinner is kept, not new, so the link is dropped
    expect(out.added).toEqual(['wed-dinner-2', 'tue-lunch']);
  });

  it('refuses a new meal for a slot that is not being swapped, and retries with that as feedback', async () => {
    const h = household();
    const saved = savedWeek(h, request());
    const { client, submitPlan, seen } = scripted([
      { notes: '', meals: [...newMealsFor([['wed', 'dinner']]), rawMeal('fri', 'dinner')] }, // Fri dinner is kept
      { notes: '', meals: newMealsFor([['wed', 'dinner']]) },
    ]);

    const out = await runSwap({ household: h, plan: saved, mealIds: ['wed-dinner'], deals, matched, neverBuy: [], recentDinnerNames: [], client });

    expect(submitPlan).toHaveBeenCalledTimes(2);
    expect(seen[1]!.payload.feedback?.some((i) => i.message.includes('is not being swapped'))).toBe(true);
    expect(out.plan.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(out.plan.attempts).toBe(2);
    expect(kept(out.plan, ['fri-dinner'])[0]!.name).toBe(label('fri', 'dinner'));
  });

  it('retries when a new meal breaks a check, and keeps the valid attempt', async () => {
    const h = household();
    const saved = savedWeek(h, request());
    const { client, submitPlan, seen } = scripted([
      { notes: '', meals: [rawMeal('wed', 'dinner', { ingredients: [{ id: 'not-a-real-ingredient', qty: 1 }] })] },
      { notes: '', meals: newMealsFor([['wed', 'dinner']]) },
    ]);

    const out = await runSwap({ household: h, plan: saved, mealIds: ['wed-dinner'], deals, matched, neverBuy: [], recentDinnerNames: [], client });

    expect(submitPlan).toHaveBeenCalledTimes(2);
    expect(seen[1]!.payload.feedback?.some((i) => i.check === 'unknown-ingredient' && i.severity === 'error')).toBe(true);
    expect(out.plan.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('keeps the prep steps that serve only kept meals when the model returns no prep', async () => {
    const h = household({ prepDay: 'sun' });
    const prep: PrepPlan = {
      day: 'sun',
      totalMinutes: 30,
      steps: [
        { id: 'prep-1', task: 'Cook rice', minutes: 20, forMeals: ['thu-dinner'], day: 'sun', storage: { method: 'fridge', how: '', keepsDays: 4 } },
        { id: 'prep-2', task: 'Chop onion', minutes: 10, forMeals: ['mon-dinner'], day: 'sun' },
      ],
    };
    const saved = savedWeek(h, request(), { prep });
    const { client } = scripted([{ notes: '', meals: newMealsFor([['mon', 'dinner'], ['tue', 'lunch']]) }]);

    const out = await runSwap({ household: h, plan: saved, mealIds: ['mon-dinner'], deals, matched, neverBuy: [], recentDinnerNames: [], client });

    expect(out.plan.prep?.steps.map((s) => [s.id, s.task])).toEqual([['prep-1', 'Cook rice']]);
    expect(out.plan.prep?.totalMinutes).toBe(20);
    expect(out.plan.issues).toContainEqual(PREP_MISSING);
  });

  it('takes the prep from the model when it comes back, and adds no prep warning', async () => {
    const h = household({ prepDay: 'sun' });
    const saved = savedWeek(h, request(), {
      prep: { day: 'sun', totalMinutes: 0, steps: [] },
    });
    const { client, seen } = scripted([
      {
        notes: '',
        meals: newMealsFor([['mon', 'dinner'], ['tue', 'lunch']]),
        prep: { day: 'sun', steps: [{ task: 'Make the dal', minutes: 25, forMeals: ['mon-dinner', 'tue-lunch'], day: 'sun', storage: { method: 'fridge', how: 'airtight container', keepsDays: 3 } }] },
      },
    ]);

    const out = await runSwap({ household: h, plan: saved, mealIds: ['mon-dinner'], deals, matched, neverBuy: [], recentDinnerNames: [], client });

    expect(seen[0]!.system).toContain(SWAP_PROMPT);
    expect(out.plan.prep?.steps.map((s) => s.task)).toEqual(['Make the dal']);
    expect(out.plan.issues.some((i) => i.check === 'prep')).toBe(false);
  });

  it('does not call the model when the freed slots have left the schedule, and drops the replaced meals', async () => {
    const h = household();
    // The week was planned with Mon dinner and Tue lunch; the schedule has since eaten out both.
    const saved: MealPlan = {
      ...savedWeek(h, request()),
      request: request({
        overrides: [
          { day: 'mon', slot: 'dinner', eatingOut: true },
          { day: 'tue', slot: 'lunch', eatingOut: true },
        ],
      }),
    };
    const { client, submitPlan } = scripted([{ notes: '', meals: [] }]);

    const out = await runSwap({ household: h, plan: saved, mealIds: ['mon-dinner'], deals, matched, neverBuy: [], recentDinnerNames: [], client });

    expect(submitPlan).not.toHaveBeenCalled();
    expect(out.swapped).toEqual(['mon-dinner', 'tue-lunch']);
    expect(out.added).toEqual([]);
    expect(out.plan.meals.some((m) => m.id === 'mon-dinner')).toBe(false);
    expect(out.plan.meals).toHaveLength(19);
  });

  it('keeps the price source and the price warnings of the saved plan', async () => {
    const h = household();
    const saved = savedWeek(h, request(), {
      priceSource: 'current',
      issues: [{ check: 'prices', severity: 'warning', message: 'Prices are estimates.' }],
    });
    const { client } = scripted([{ notes: '', meals: newMealsFor([['wed', 'dinner']]) }]);

    const out = await runSwap({ household: h, plan: saved, mealIds: ['wed-dinner'], deals, matched, neverBuy: [], recentDinnerNames: [], client });

    expect(out.plan.priceSource).toBe('current');
    expect(out.plan.issues).toContainEqual({ check: 'prices', severity: 'warning', message: 'Prices are estimates.' });
  });
});
