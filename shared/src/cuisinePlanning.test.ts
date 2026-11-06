import { describe, expect, it } from 'vitest';
import { INGREDIENT_BY_ID, INGREDIENTS } from './catalog';
import { defaultHousehold, type Household } from './index';
import { buildList, toPlannedMeals, validate, type ValidateContext } from './validate';
import { typicalOffer, typicalOffers, estimateBasisFor, type Offer } from './offers';
import type { Deal } from './scoring';
import type { FixedCost } from './fixed';
import type { MealPlan, PlannedMeal, RawMeal, SlotCell } from './plan';

const noFixed: FixedCost = { cost: 0, listItems: [], macrosByPerson: {}, leftovers: [], needs: [], issues: [] };

function dinner(id: string, ingredients: { ingredientId: string; qty: number; unit: 'kg' | 'l' | 'each' }[], cuisine?: string, slot: 'lunch' | 'dinner' = 'dinner', day: PlannedMeal['day'] = 'mon'): PlannedMeal {
  return {
    id,
    day,
    slot,
    name: id,
    eaters: ['ann'],
    ingredients,
    activeMinutes: 10,
    steps: [],
    tags: [],
    ...(cuisine ? { cuisine } : {}),
  };
}

const estimate = (ingredientId: string, store: string, price: number, basis: 'site' | 'receipt'): Offer => ({
  ingredientId,
  store,
  pricePerUnit: price,
  packQty: 1,
  packPrice: price,
  estimate: { basis, date: '2026-11-01' },
});

describe('typical prices', () => {
  it('prices a per-kilogram item in 0.1 kg steps, a per-item one by the item, and a pack by its pack size', () => {
    const chicken = typicalOffer(INGREDIENT_BY_ID['chicken-thigh-boneless']!, 'Loblaws')!;
    expect(chicken).toMatchObject({ packQty: 0.1, store: 'Loblaws', estimate: { basis: 'typical' } });
    expect(chicken.packPrice).toBeCloseTo(0.799, 6);
    expect(chicken.pricePerUnit).toBeCloseTo(7.99, 6);

    const eggs = typicalOffer(INGREDIENT_BY_ID['eggs-large']!, 'Loblaws')!;
    expect(eggs).toMatchObject({ packQty: 1, packPrice: 5.49 });

    const cumin = typicalOffer(INGREDIENT_BY_ID['ground-cumin']!, 'Loblaws')!;
    expect(cumin.packQty).toBeCloseTo(0.085, 6);
    expect(cumin.packPrice).toBeCloseTo(3.49, 6);
  });

  it('gives no typical offers without a store, and one for every ingredient with a store', () => {
    expect(typicalOffers(undefined)).toEqual([]);
    expect(typicalOffers('Loblaws')).toHaveLength(INGREDIENTS.length);
  });

  it('takes the first basis any estimate has: site, then receipt, then typical', () => {
    const typical = typicalOffers('Loblaws').filter((o) => o.ingredientId === 'eggs-large');
    expect(estimateBasisFor('eggs-large', typical)).toBe('typical');
    expect(estimateBasisFor('eggs-large', [...typical, estimate('eggs-large', 'Loblaws', 5, 'receipt')])).toBe('receipt');
    expect(estimateBasisFor('eggs-large', [...typical, estimate('eggs-large', 'Loblaws', 5, 'receipt'), estimate('eggs-large', 'No Frills', 4, 'site')])).toBe('site');
    expect(estimateBasisFor('paneer', typical)).toBeUndefined();
  });
});

describe('buildList: pricing priority for an item no flyer prices', () => {
  const meal = dinner('m1', [{ ingredientId: 'eggs-large', qty: 1, unit: 'each' }]);
  const typical = typicalOffers('Loblaws');
  const priceOf = (estimates: Offer[]) => {
    const item = buildList([meal], noFixed, [], [], ['Loblaws'], 2, [], [], { estimates }).find((i) => i.ingredientId === 'eggs-large')!;
    return { price: item.packPrice, basis: item.estimate?.basis, store: item.store };
  };

  it('uses a site price over a receipt and a typical price', () => {
    expect(priceOf([estimate('eggs-large', 'Loblaws', 4.0, 'site'), estimate('eggs-large', 'Loblaws', 5.0, 'receipt'), ...typical])).toEqual({
      price: 4.0,
      basis: 'site',
      store: 'Loblaws',
    });
  });

  it('uses a receipt price over a typical price when there is no site price', () => {
    expect(priceOf([estimate('eggs-large', 'Loblaws', 5.0, 'receipt'), ...typical])).toEqual({ price: 5.0, basis: 'receipt', store: 'Loblaws' });
  });

  it('uses the typical price when nothing else is known', () => {
    expect(priceOf(typical)).toEqual({ price: 5.49, basis: 'typical', store: 'Loblaws' });
  });

  it('prices a flyer deal above every estimate', () => {
    const deal: Deal = { ingredientId: 'eggs-large', store: 'Loblaws', pricePerUnit: 3.49, packQty: 1, packPrice: 3.49, discountPct: 0.3, baseline: 5, validTo: '2026-12-31', score: 0.5 };
    const item = buildList([meal], noFixed, [deal], [], ['Loblaws'], 2, [], [], { estimates: typical }).find((i) => i.ingredientId === 'eggs-large')!;
    expect(item.packPrice).toBe(3.49);
    expect(item.estimate).toBeUndefined();
  });
});

describe('buildList: kept staples are free and never listed', () => {
  it('leaves an on-hand ingredient off the list, even when a meal uses it', () => {
    const meal = dinner('m1', [
      { ingredientId: 'eggs-large', qty: 1, unit: 'each' },
      { ingredientId: 'ground-cumin', qty: 0.01, unit: 'kg' },
    ]);
    const estimates = typicalOffers('Loblaws');
    const without = buildList([meal], noFixed, [], [], ['Loblaws'], 2, [], [], { estimates });
    expect(without.map((i) => i.ingredientId)).toContain('ground-cumin');
    const withOnHand = buildList([meal], noFixed, [], [], ['Loblaws'], 2, [], [], { estimates, onHand: ['ground-cumin'] });
    expect(withOnHand.map((i) => i.ingredientId)).not.toContain('ground-cumin');
    expect(withOnHand.map((i) => i.ingredientId)).toContain('eggs-large');
  });
});

describe('toPlannedMeals: cuisine labels', () => {
  const cells: SlotCell[] = [{ day: 'mon', slot: 'dinner', eaters: ['ann'] }];
  const raw = (cuisine?: string): RawMeal => ({
    id: 'mon-dinner',
    slotId: 'mon-dinner',
    name: 'Dal',
    ingredients: [{ id: 'chana-dal', qty: 0.2 }],
    activeMinutes: 30,
    steps: [],
    tags: [],
    ...(cuisine !== undefined ? { cuisine } : {}),
  });

  it('keeps the cuisine as its key, whether the planner wrote the key or the label', () => {
    expect(toPlannedMeals([raw('indian')], cells).meals[0]!.cuisine).toBe('indian');
    expect(toPlannedMeals([raw('Indian')], cells).meals[0]!.cuisine).toBe('indian');
  });

  it('leaves the cuisine off when the planner wrote none or one the household does not know', () => {
    expect(toPlannedMeals([raw()], cells).meals[0]!.cuisine).toBeUndefined();
    expect(toPlannedMeals([raw('Klingon')], cells).meals[0]!.cuisine).toBeUndefined();
  });
});

describe('validate: cuisine warnings', () => {
  const household: Household = defaultHousehold();
  const plan = (meals: PlannedMeal[]): MealPlan => ({
    weekOf: '2026-11-15',
    request: { weekOf: '2026-11-15', budget: 150, cravings: [], overrides: [], useItUp: false },
    meals,
    fixedMeals: [],
    list: [],
    stores: [],
    totalCost: 0,
    fixedCost: 0,
    issues: [],
    attempts: 1,
    generatedAt: '2026-11-06T00:00:00Z',
    notes: '',
  });
  const ctx: ValidateContext = {
    household,
    cells: [],
    fixed: noFixed,
    available: new Set(),
    neverBuy: new Set(),
    recentDinnerNames: [],
  };
  const cuisineIssues = (meals: PlannedMeal[], h: Household = household) =>
    validate(plan(meals), { ...ctx, household: h }).filter((i) => i.check === 'cuisine');

  it('warns, and does not error, for a dinner from a cuisine the household never eats', () => {
    const h = { ...household, cuisines: { ...household.cuisines, thai: 'never' as const } };
    const issues = cuisineIssues([dinner('d1', [], 'thai')], h);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('warning');
    expect(issues[0]!.message).toContain('Thai');
  });

  it('warns once a cuisine takes more than three dinners, and not at three', () => {
    const three = [dinner('a', [], 'italian', 'dinner', 'mon'), dinner('b', [], 'italian', 'dinner', 'tue'), dinner('c', [], 'italian', 'dinner', 'wed')];
    expect(cuisineIssues(three)).toEqual([]);
    const four = [...three, dinner('d', [], 'italian', 'dinner', 'thu')];
    const issues = cuisineIssues(four);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('warning');
    expect(issues[0]!.message).toContain('4 dinners');
  });

  it('does not count lunches toward the three-dinner limit', () => {
    const meals = [
      dinner('a', [], 'italian', 'dinner', 'mon'),
      dinner('b', [], 'italian', 'dinner', 'tue'),
      dinner('c', [], 'italian', 'dinner', 'wed'),
      dinner('l1', [], 'italian', 'lunch', 'thu'),
      dinner('l2', [], 'italian', 'lunch', 'fri'),
    ];
    expect(cuisineIssues(meals)).toEqual([]);
  });

  it('says nothing about a meal with no cuisine', () => {
    expect(cuisineIssues([dinner('a', [])])).toEqual([]);
  });
});
