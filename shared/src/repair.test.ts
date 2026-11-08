// Targeted repair: which meals each error names, what they cost, and when a repair is refused.
import { describe, expect, it } from 'vitest';
import { INGREDIENTS } from './catalog';
import { DAYS, SLOTS, type Day, type Slot } from './calendar';
import { defaultHousehold, type Household } from './index';
import { mealCosts, repairFor } from './repair';
import type { ListItem, MealPlan, PlannedMeal, SlotCell, ValidationIssue } from './plan';
import type { ValidateContext } from './validate';

const ALL_IDS = new Set(INGREDIENTS.map((i) => i.id));
const DAIRY = 'milk-2-percent';
const RICE = 'basmati-rice';

function household(over: Partial<Household> = {}): Household {
  const people = [
    { id: 'ann', name: 'Ann', dietTags: [], allergies: ['dairy'] },
    { id: 'ben', name: 'Ben', dietTags: [], allergies: [] },
  ];
  return { ...defaultHousehold(), people, ...over };
}

function cells(eaters = ['ann', 'ben']): SlotCell[] {
  return DAYS.flatMap((day) => SLOTS.map((slot) => ({ day, slot, eaters: [...eaters] })));
}

function meal(day: Day, slot: Slot, over: Partial<PlannedMeal> = {}): PlannedMeal {
  return {
    id: `${day}-${slot}`,
    day,
    slot,
    name: `${day} ${slot}`,
    eaters: ['ann', 'ben'],
    ingredients: [],
    activeMinutes: 10,
    steps: [],
    tags: [],
    ...over,
  };
}

/** One meal in every cell of the week, with nothing in them unless the caller changes a meal. */
function weekOf(changes: Record<string, Partial<PlannedMeal>> = {}): PlannedMeal[] {
  return DAYS.flatMap((day) => SLOTS.map((slot) => meal(day, slot, changes[`${day}-${slot}`] ?? {})));
}

function planOf(meals: PlannedMeal[], list: ListItem[] = []): MealPlan {
  return {
    weekOf: '2026-11-15',
    request: { weekOf: '2026-11-15', budget: 100, cravings: [], overrides: [], useItUp: false },
    meals,
    fixedMeals: [],
    list,
    stores: [],
    totalCost: 0,
    fixedCost: 0,
    issues: [],
    attempts: 1,
    generatedAt: '',
    notes: '',
  } as unknown as MealPlan;
}

function ctxFor(h: Household = household(), eaters = ['ann', 'ben'], over: Partial<ValidateContext> = {}): ValidateContext {
  return {
    household: h,
    cells: cells(eaters),
    fixed: { cost: 0, listItems: [], macrosByPerson: {}, leftovers: [], needs: [], issues: [] },
    available: ALL_IDS,
    neverBuy: new Set(),
    recentDinnerNames: [],
    neverMeals: [],
    ...over,
  };
}

const err = (check: ValidationIssue['check']): ValidationIssue => ({ check, severity: 'error', message: check });

describe('repairFor', () => {
  it('returns null when there are no errors', () => {
    const plan = planOf(weekOf());
    expect(repairFor(plan, ctxFor(), [{ check: 'waste', severity: 'warning', message: 'x' }])).toBeNull();
  });

  it('replaces the meal that uses an ingredient outside the offer, and refills its cell only', () => {
    const plan = planOf(weekOf({ 'sun-dinner': { ingredients: [{ ingredientId: 'not-real', qty: 1, unit: 'each' }] } }));
    const rep = repairFor(plan, ctxFor(), [err('unknown-ingredient')]);
    expect(rep).toEqual({
      replaceIds: ['sun-dinner'],
      refill: [{ day: 'sun', slot: 'dinner', eaters: ['ann', 'ben'] }],
      reason: 'unknown-ingredient',
    });
  });

  it('replaces the meal that uses a form the household does not keep, and only that one', () => {
    const plan = planOf(weekOf({ 'mon-dinner': { ingredients: [{ ingredientId: 'canned-tuna', qty: 1, unit: 'each' }] } }));
    const rep = repairFor(plan, ctxFor(household(), ['ann', 'ben'], { formBlocked: new Set(['canned-tuna']) }), [err('form')]);
    expect(rep?.replaceIds).toEqual(['mon-dinner']);
    expect(rep?.refill).toEqual([{ day: 'mon', slot: 'dinner', eaters: ['ann', 'ben'] }]);
  });

  it('replaces a meal named after an avoided dish', () => {
    const plan = planOf(weekOf({ 'tue-lunch': { name: 'Coleslaw wrap' } }));
    const rep = repairFor(plan, ctxFor(household(), ['ann', 'ben'], { avoidDishes: ['slaw'] }), [err('avoid-dish')]);
    expect(rep?.replaceIds).toEqual(['tue-lunch']);
  });

  it('replaces a meal named after a never-buy word', () => {
    const plan = planOf(weekOf({ 'mon-dinner': { name: 'Beef stir-fry' } }));
    const rep = repairFor(plan, ctxFor(household(), ['ann', 'ben'], { neverWords: ['beef'] }), [err('never-buy')]);
    expect(rep?.replaceIds).toEqual(['mon-dinner']);
  });

  it('replaces the meal an allergic person eats, and only that one', () => {
    const plan = planOf(weekOf({ 'tue-lunch': { eaters: ['ann'], ingredients: [{ ingredientId: DAIRY, qty: 1, unit: 'l' }] } }));
    const rep = repairFor(plan, ctxFor(), [err('allergen')]);
    expect(rep?.replaceIds).toEqual(['tue-lunch']);
  });

  it('replaces a meal rated never again, by name', () => {
    const plan = planOf(weekOf({ 'wed-dinner': { name: 'Old favourite' } }));
    const rep = repairFor(plan, ctxFor(household(), ['ann', 'ben'], { neverMeals: ['old favourite'] }), [err('never-again')]);
    expect(rep?.replaceIds).toEqual(['wed-dinner']);
  });

  it('replaces a meal over its own time cap, and not one within it', () => {
    const plan = planOf(weekOf({ 'thu-dinner': { activeMinutes: 40 }, 'fri-dinner': { activeMinutes: 10 } }));
    const ctx = ctxFor();
    ctx.cells = ctx.cells.map((c) => (c.day === 'thu' && c.slot === 'dinner' ? { ...c, maxMinutes: 30 } : c));
    const rep = repairFor(plan, ctx, [err('busy')]);
    expect(rep?.replaceIds).toEqual(['thu-dinner']);
  });

  it('over budget: replaces the two most expensive meals that are not leftovers, with the meals they link to', () => {
    // sun-dinner costs most and makes leftovers for mon-lunch, which comes with it; tue-dinner is the next dearest.
    const plan = planOf(
      weekOf({
        'sun-dinner': { ingredients: [{ ingredientId: RICE, qty: 9, unit: 'g' }], makesLeftoversFor: 'mon-lunch' },
        'mon-lunch': { usesLeftoversFrom: 'sun-dinner', activeMinutes: 5 },
        'tue-dinner': { ingredients: [{ ingredientId: RICE, qty: 1, unit: 'g' }] },
        'wed-dinner': { ingredients: [{ ingredientId: RICE, qty: 0.5, unit: 'g' }] },
      }),
      [{ ingredientId: RICE, name: 'Rice', category: 'pantry', store: 'FreshCo', packs: 1, packQty: 10, packPrice: 50, total: 50, usedIn: [] }],
    );
    const rep = repairFor(plan, ctxFor(), [err('budget')]);
    expect(rep?.replaceIds).toEqual(['sun-dinner', 'mon-lunch', 'tue-dinner']);
    expect(rep?.refill.map((c) => `${c.day}-${c.slot}`)).toEqual(['sun-dinner', 'mon-lunch', 'tue-dinner']);
    expect(rep?.reason).toBe('budget');
  });

  it('costs each meal by its share of each list item', () => {
    const plan = planOf(
      weekOf({
        'sun-dinner': { ingredients: [{ ingredientId: RICE, qty: 9, unit: 'g' }] },
        'tue-dinner': { ingredients: [{ ingredientId: RICE, qty: 1, unit: 'g' }] },
      }),
      [{ ingredientId: RICE, name: 'Rice', category: 'pantry', store: 'FreshCo', packs: 1, packQty: 10, packPrice: 50, total: 50, usedIn: [] }],
    );
    const costs = mealCosts(plan);
    expect(costs.get('sun-dinner')).toBeCloseTo(45);
    expect(costs.get('tue-dinner')).toBeCloseTo(5);
    expect(costs.get('mon-breakfast')).toBe(0);
  });

  it('slot coverage: refills an empty cell, and replaces both meals in a doubled cell', () => {
    const meals = weekOf().filter((m) => m.id !== 'sat-breakfast');
    meals.push(meal('mon', 'lunch', { id: 'extra-lunch' }));
    const rep = repairFor(planOf(meals), ctxFor(), [err('slot-coverage')]);
    expect(rep?.replaceIds).toEqual(['mon-lunch', 'extra-lunch']);
    expect(rep?.refill.map((c) => `${c.day}-${c.slot}`)).toEqual(['mon-lunch', 'sat-breakfast']);
  });

  it('refuses a repair when an error names no meal, such as a missing craving or a macro shortfall', () => {
    const plan = planOf(weekOf());
    expect(repairFor(plan, ctxFor(), [err('cravings')])).toBeNull();
    expect(repairFor(plan, ctxFor(), [err('macros')])).toBeNull();
    expect(repairFor(plan, ctxFor(), [err('busy'), err('macros')])).toBeNull();
  });

  it('variety under the minimum-vegetables rule rewrites the two dinners with the fewest vegetables', () => {
    const h = household({ varietyRules: { ...defaultHousehold().varietyRules, minVeg5: true } });
    const plan = planOf(
      weekOf({
        'sun-dinner': { ingredients: [{ ingredientId: 'broccoli', qty: 1, unit: 'kg' }, { ingredientId: 'carrots', qty: 1, unit: 'kg' }] },
        'mon-dinner': { ingredients: [{ ingredientId: RICE, qty: 1, unit: 'g' }] },
        'tue-dinner': { ingredients: [{ ingredientId: 'broccoli', qty: 1, unit: 'kg' }] },
      }),
    );
    // Only two vegetables in the whole week, so the rule is short: mon-dinner (none) and wed-dinner (none) are the two fewest.
    expect(repairFor(plan, ctxFor(h), [err('variety')])?.replaceIds).toEqual(['mon-dinner', 'wed-dinner']);
  });

  it('variety with no repeat or vegetable problem is refused', () => {
    expect(repairFor(planOf(weekOf()), ctxFor(), [err('variety')])).toBeNull();
  });

  it('cravings: rewrites the non-leftover dinners that lack the ingredient, untagged ones first, up to the minimum', () => {
    const h = household();
    // Two dinners feature chicken; a week of seven dinners needs three. The third is a craving-tagged dinner: an untagged one comes first.
    const plan = planOf(
      weekOf({
        'sun-dinner': { ingredients: [{ ingredientId: 'chicken-thigh-boneless', qty: 1, unit: 'kg' }] },
        'mon-dinner': { ingredients: [{ ingredientId: 'chicken-thigh-boneless', qty: 1, unit: 'kg' }] },
        'tue-dinner': { tags: ['craving'] },
        'wed-dinner': { usesLeftoversFrom: 'tue-lunch' },
      }),
    );
    const withCraving = { ...plan, request: { ...plan.request, cravings: ['chicken'] } };
    const rep = repairFor(withCraving, ctxFor(h), [err('cravings')]);
    // thu, fri, sat, and the tagged tue are candidates; the untagged thu comes first, so one dinner is picked and it is thu.
    expect(rep?.replaceIds).toEqual(['thu-dinner']);
    expect(rep?.reason).toBe('cravings');
  });

  it('cravings: refuses when every dinner is a leftover meal, so none can take the ingredient', () => {
    const leftovers = Object.fromEntries(DAYS.map((d) => [`${d}-dinner`, { usesLeftoversFrom: 'x' }]));
    const plan = planOf(weekOf(leftovers));
    expect(repairFor({ ...plan, request: { ...plan.request, cravings: ['chicken'] } }, ctxFor(), [err('cravings')])).toBeNull();
  });

  it('leftovers: replaces the meal whose leftover link is broken, and the meal it links to', () => {
    // mon-lunch says it eats sun-dinner's leftovers, but sun-dinner makes them for tue-lunch.
    const plan = planOf(
      weekOf({
        'sun-dinner': { makesLeftoversFor: 'tue-lunch' },
        'mon-lunch': { usesLeftoversFrom: 'sun-dinner', activeMinutes: 5 },
      }),
    );
    // The linked lunch (tue-lunch, which sun-dinner makes leftovers for) comes with them, as every leftover link does.
    const rep = repairFor(plan, ctxFor(), [err('leftovers')]);
    expect(rep?.replaceIds).toEqual(['sun-dinner', 'mon-lunch', 'tue-lunch']);
    expect(rep?.reason).toBe('leftovers');
  });

  it('budget: rewrites two meals when over by no more than 15% of the budget, and three when further over', () => {
    const base = planOf(
      weekOf({
        'sun-dinner': { ingredients: [{ ingredientId: RICE, qty: 9, unit: 'g' }] },
        'tue-dinner': { ingredients: [{ ingredientId: RICE, qty: 1, unit: 'g' }] },
        'wed-dinner': { ingredients: [{ ingredientId: RICE, qty: 0.5, unit: 'g' }] },
      }),
      [{ ingredientId: RICE, name: 'Rice', category: 'pantry', store: 'FreshCo', packs: 1, packQty: 10, packPrice: 50, total: 50, usedIn: [] }],
    );
    // A budget of 100: a total of 110 is 10% over (two meals); 130 is 30% over (three).
    const at = (totalCost: number) => ({ ...base, totalCost, request: { ...base.request, budget: 100 } });
    expect(repairFor(at(110), ctxFor(), [err('budget')])?.replaceIds).toEqual(['sun-dinner', 'tue-dinner']);
    expect(repairFor(at(130), ctxFor(), [err('budget')])?.replaceIds).toEqual(['sun-dinner', 'tue-dinner', 'wed-dinner']);
  });

  it('variety: the later of two dinners that repeat a protein on consecutive days is replaced', () => {
    const h = household({ varietyRules: { ...defaultHousehold().varietyRules, noRepeatProteinConsecutive: true } });
    const chicken = 'chicken-thigh-boneless';
    const plan = planOf(
      weekOf({
        'sun-dinner': { ingredients: [{ ingredientId: chicken, qty: 1, unit: 'kg' }] },
        'mon-dinner': { ingredients: [{ ingredientId: chicken, qty: 1, unit: 'kg' }] },
      }),
    );
    expect(repairFor(plan, ctxFor(h), [err('variety')])?.replaceIds).toEqual(['mon-dinner']);
  });
});

describe('targeted repair: assigned cravings, and one vegetarian meal', () => {
  it('a new plan rewrites only the assigned dinners that lack the craving ingredient', () => {
    const plan = planOf(
      weekOf({
        'sun-dinner': { ingredients: [{ ingredientId: 'chicken-thigh-boneless', qty: 1, unit: 'kg' }] },
        'tue-dinner': { ingredients: [{ ingredientId: 'chicken-thigh-boneless', qty: 1, unit: 'kg' }] },
      }),
    );
    const withCraving = { ...plan, request: { ...plan.request, cravings: ['chicken'] } };
    // Chicken was assigned to Monday, Tuesday and Thursday: Tuesday has it, so Monday and Thursday are written again.
    const ctx = ctxFor(household(), undefined, { cravingDinners: { mon: 'chicken', tue: 'chicken', thu: 'chicken' } });
    expect(repairFor(withCraving, ctx, [err('cravings')])?.replaceIds).toEqual(['mon-dinner', 'thu-dinner']);
  });

  it('one vegetarian meal: with no meatless lunch or dinner, one dinner is rewritten, the first without a craving in it', () => {
    const meat = { ingredients: [{ ingredientId: 'chicken-thigh-boneless', qty: 1, unit: 'kg' as const }] };
    const plan = planOf(weekOf(Object.fromEntries(DAYS.flatMap((d) => ['lunch', 'dinner'].map((s) => [`${d}-${s}`, meat])))));
    const h = household({ varietyRules: { ...defaultHousehold().varietyRules, oneVegDinner: true } });
    expect(repairFor(plan, ctxFor(h), [err('variety')])?.replaceIds).toEqual(['sun-dinner']);
  });
});
