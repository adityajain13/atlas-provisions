import { describe, expect, it } from 'vitest';
import { INGREDIENTS } from './catalog';
import { DAYS, SLOTS, type Day, type Slot } from './calendar';
import { buildList, toPlannedMeals, validate, type ValidateContext } from './validate';
import { defaultHousehold, type Household } from './index';
import { expandWeek } from './grid';
import type { PantryItem } from './pantry';
import type { PlanRequest } from './plan';
import type { FixedCost } from './fixed';
import type { ListItem, MealPlan, PlannedMeal, RawMeal, SlotCell } from './plan';
import type { Deal } from './scoring';
import type { MatchedItem } from './match';

const ALL_IDS = new Set(INGREDIENTS.map((i) => i.id));
const NO_FIXED: FixedCost = { cost: 0, listItems: [], macrosByPerson: {}, leftovers: [], needs: [], issues: [] };

const people = [
  { id: 'ann', name: 'Ann', dietTags: [], allergies: ['dairy'] },
  { id: 'ben', name: 'Ben', dietTags: [], allergies: [] },
];

function household(over: Partial<Household> = {}): Household {
  return { ...defaultHousehold(), people, ...over };
}

/** Every cell of a week, with both people eating. */
function allCells(eaters = ['ann', 'ben']): SlotCell[] {
  return DAYS.flatMap((day) => SLOTS.map((slot) => ({ day, slot, eaters: [...eaters] })));
}

function meal(day: Day, slot: Slot, extra: Partial<PlannedMeal> = {}): PlannedMeal {
  return {
    id: `${day}-${slot}`,
    day,
    slot,
    name: `Plain ${day} ${slot}`,
    eaters: ['ann', 'ben'],
    ingredients: [{ ingredientId: 'broccoli', qty: 0.2, unit: 'kg' }],
    activeMinutes: 20,
    steps: ['Cook'],
    tags: [],
    ...extra,
  };
}

/** A plan that passes every check: each cell has one plain broccoli meal. */
function cleanMeals(cells = allCells()): PlannedMeal[] {
  return cells.map((c) => meal(c.day, c.slot, { eaters: [...c.eaters] }));
}

function planOf(meals: PlannedMeal[], over: Partial<MealPlan> = {}, requestOver: Partial<MealPlan['request']> = {}): MealPlan {
  return {
    weekOf: '2026-11-15',
    request: { weekOf: '2026-11-15', budget: 150, cravings: [], overrides: [], useItUp: true, ...requestOver },
    meals,
    fixedMeals: [],
    list: [],
    stores: [],
    totalCost: 0,
    fixedCost: 0,
    issues: [],
    attempts: 1,
    generatedAt: '2026-11-12T00:00:00.000Z',
    notes: '',
    ...over,
  };
}

function ctxOf(over: Partial<ValidateContext> = {}): ValidateContext {
  return {
    household: household(),
    cells: allCells(),
    fixed: NO_FIXED,
    available: ALL_IDS,
    neverBuy: new Set(),
    recentDinnerNames: [],
    ...over,
  };
}

function item(ingredientId: string, over: Partial<ListItem> = {}): ListItem {
  return {
    ingredientId,
    name: ingredientId,
    category: 'produce',
    store: 'No Frills',
    packs: 1,
    packQty: 1,
    packPrice: 1,
    total: 1,
    usedIn: [],
    ...over,
  };
}

const checksOf = (issues: { check: string; severity: string }[], severity: 'error' | 'warning' = 'error') =>
  issues.filter((i) => i.severity === severity).map((i) => i.check);

describe('validate: clean plan', () => {
  it('reports nothing for a plan that meets every rule', () => {
    expect(validate(planOf(cleanMeals()), ctxOf())).toEqual([]);
  });
});

describe('validate: unknown-ingredient and never-buy', () => {
  it('flags an id that is not in the available list', () => {
    const meals = cleanMeals();
    meals[0]!.ingredients = [{ ingredientId: 'not-a-real-id', qty: 1, unit: 'kg' }];
    const issues = validate(planOf(meals), ctxOf({ available: new Set(['broccoli']) }));
    const hit = issues.find((i) => i.check === 'unknown-ingredient');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('error');
    expect(hit!.message).toContain('not-a-real-id');
  });

  it('accepts ids that are available', () => {
    expect(checksOf(validate(planOf(cleanMeals()), ctxOf({ available: new Set(['broccoli']) })))).toEqual([]);
  });

  it('flags an ingredient on the never-buy list', () => {
    const issues = validate(planOf(cleanMeals()), ctxOf({ neverBuy: new Set(['broccoli']) }));
    expect(checksOf(issues)).toContain('never-buy');
  });
});

describe('validate: allergen', () => {
  it('flags an allergic person eating a meal with the allergen', () => {
    const meals = cleanMeals();
    meals[0]!.ingredients = [{ ingredientId: 'cheddar', qty: 0.1, unit: 'kg' }];
    const issues = validate(planOf(meals), ctxOf());
    const hit = issues.find((i) => i.check === 'allergen');
    expect(hit).toBeDefined();
    expect(hit!.message).toContain('Ann is allergic to dairy');
    expect(hit!.message).toContain('Cheddar');
  });

  it('does not flag the allergen when the allergic person is not eating that meal', () => {
    const meals = cleanMeals();
    meals[0]!.ingredients = [{ ingredientId: 'cheddar', qty: 0.1, unit: 'kg' }];
    meals[0]!.eaters = ['ben'];
    expect(checksOf(validate(planOf(meals), ctxOf()))).not.toContain('allergen');
  });

  it('does not flag a meal with no allergen for an allergic person', () => {
    expect(checksOf(validate(planOf(cleanMeals()), ctxOf()))).not.toContain('allergen');
  });
});

describe('validate: slot-coverage', () => {
  it('flags a cell with no meal', () => {
    const meals = cleanMeals().filter((m) => !(m.day === 'thu' && m.slot === 'dinner'));
    const issues = validate(planOf(meals), ctxOf());
    const hit = issues.find((i) => i.check === 'slot-coverage');
    expect(hit!.message).toContain('No meal for Thursday dinner');
  });

  it('flags two meals for one cell', () => {
    const meals = [...cleanMeals(), meal('thu', 'dinner', { id: 'extra' })];
    expect(validate(planOf(meals), ctxOf()).some((i) => i.message.includes('2 meals for Thursday dinner'))).toBe(true);
  });

  it('flags a meal for a slot that nobody eats', () => {
    const cells = allCells().filter((c) => !(c.day === 'sat' && c.slot === 'lunch'));
    const meals = [...cleanMeals(cells), meal('sat', 'lunch', { id: 'orphan', name: 'Orphan lunch' })];
    const issues = validate(planOf(meals), ctxOf({ cells }));
    expect(issues.some((i) => i.check === 'slot-coverage' && i.message.includes('Orphan lunch'))).toBe(true);
  });
});

describe('validate: toPlannedMeals', () => {
  const raw = (over: Partial<RawMeal> = {}): RawMeal => ({
    id: 'r1',
    slotId: 'thu-dinner',
    name: 'Chili',
    ingredients: [{ id: 'broccoli', qty: 0.3 }],
    activeMinutes: 25,
    steps: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    tags: ['craving'],
    ...over,
  });

  it('maps slotId to day, slot and cell eaters, and takes the unit from the catalogue', () => {
    const cells = [{ day: 'thu' as Day, slot: 'dinner' as Slot, eaters: ['ann', 'ben'] }];
    const { meals, issues } = toPlannedMeals([raw()], cells);
    expect(issues).toEqual([]);
    expect(meals[0]).toMatchObject({ id: 'r1', day: 'thu', slot: 'dinner', eaters: ['ann', 'ben'], activeMinutes: 25 });
    expect(meals[0]!.ingredients).toEqual([{ ingredientId: 'broccoli', qty: 0.3, unit: 'kg' }]);
    expect(meals[0]!.steps).toHaveLength(6);
  });

  it('drops a meal whose slotId is not a cell and reports a slot-coverage error', () => {
    const { meals, issues } = toPlannedMeals([raw({ slotId: 'sat-lunch' })], [{ day: 'thu', slot: 'dinner', eaters: ['ann'] }]);
    expect(meals).toEqual([]);
    expect(issues[0]).toMatchObject({ check: 'slot-coverage', severity: 'error' });
  });

  it('drops non-positive and non-finite quantities', () => {
    const cells = [{ day: 'thu' as Day, slot: 'dinner' as Slot, eaters: ['ann'] }];
    const { meals } = toPlannedMeals(
      [raw({ ingredients: [{ id: 'broccoli', qty: 0 }, { id: 'spinach', qty: Number.NaN }, { id: 'carrots', qty: 1 }] })],
      cells,
    );
    expect(meals[0]!.ingredients.map((i) => i.ingredientId)).toEqual(['carrots']);
  });
});

describe('validate: budget', () => {
  it('flags a plan over budget and names the two most expensive items', () => {
    const list = [item('salmon-fillet', { name: 'Salmon fillet', total: 19.2 }), item('cheddar', { name: 'Cheddar', total: 8 }), item('broccoli', { name: 'Broccoli', total: 1 })];
    const issues = validate(planOf(cleanMeals(), { totalCost: 164.2, list }, { budget: 150 }), ctxOf());
    const hit = issues.find((i) => i.check === 'budget');
    expect(hit!.severity).toBe('error');
    expect(hit!.message).toBe(
      'Over budget by $14.20. Most expensive: Salmon fillet ($19.20), Cheddar ($8.00). Swap one meal that uses salmon fillet for a cheaper protein.',
    );
  });

  it('passes when the total is at the budget', () => {
    expect(checksOf(validate(planOf(cleanMeals(), { totalCost: 150 }, { budget: 150 }), ctxOf()))).not.toContain('budget');
  });
});

describe('validate: macros', () => {
  // Chicken thigh is 19.3 g protein per 100 g. Each meal is 0.2 kg split two ways, so Ben gets
  // 19.3 g per meal: 21 meals is 405 g a week, or about 58 g a day.
  const chickenMeals = () => cleanMeals().map((m) => ({ ...m, ingredients: [{ ingredientId: 'chicken-thigh-boneless', qty: 0.2, unit: 'kg' as const }] }));

  it('warns when the average daily protein is under 85% of the target', () => {
    const h = household({ people: [people[0]!, { ...people[1]!, proteinTargetG: 100 }] });
    const issues = validate(planOf(chickenMeals()), ctxOf({ household: h }));
    const hit = issues.find((i) => i.check === 'macros');
    expect(hit!.severity).toBe('warning');
    expect(hit!.message).toContain('Ben averages 58 g');
  });

  it('does not warn when the target is met', () => {
    const h = household({ people: [people[0]!, { ...people[1]!, proteinTargetG: 50 }] });
    expect(checksOf(validate(planOf(chickenMeals()), ctxOf({ household: h })), 'warning')).not.toContain('macros');
  });

  it('ignores people with no protein target', () => {
    expect(checksOf(validate(planOf(chickenMeals()), ctxOf()), 'warning')).not.toContain('macros');
  });

  it('counts fixed-meal protein toward the target', () => {
    const h = household({ people: [people[0]!, { ...people[1]!, proteinTargetG: 50 }] });
    // Broccoli gives Ben about 59 g of protein a week, so 400 g from a fixed meal clears 50 g a day.
    const fixed: FixedCost = { ...NO_FIXED, macrosByPerson: { ben: { protein: 400, kcal: 0 } } };
    const withoutFixed = validate(planOf(cleanMeals()), ctxOf({ household: h }));
    const withFixed = validate(planOf(cleanMeals()), ctxOf({ household: h, fixed }));
    expect(checksOf(withoutFixed, 'warning')).toContain('macros');
    expect(checksOf(withFixed, 'warning')).not.toContain('macros');
  });
});

describe('validate: waste', () => {
  // Salmon fillet has a 2-day shelf life.
  const salmonList = (packs: number) => [item('salmon-fillet', { name: 'Salmon fillet', packs, packQty: 1, total: 19 })];

  it('warns when more than 30% of a short-life pack is unused', () => {
    const issues = validate(planOf(cleanMeals(), { list: salmonList(2) }), ctxOf());
    expect(issues.find((i) => i.check === 'waste')!.message).toContain('Salmon fillet: 2 kg bought but only 0 kg used');
  });

  it('does not warn when almost all of the pack is used', () => {
    const meals = cleanMeals();
    meals[0]!.ingredients = [{ ingredientId: 'salmon-fillet', qty: 1.9, unit: 'kg' }];
    expect(checksOf(validate(planOf(meals, { list: salmonList(2) }), ctxOf()), 'warning')).not.toContain('waste');
  });

  it('ignores long-life ingredients', () => {
    const list = [item('butter', { name: 'Butter', packs: 2, packQty: 1 })];
    expect(checksOf(validate(planOf(cleanMeals(), { list }), ctxOf()), 'warning')).not.toContain('waste');
  });

  it('counts fixed-meal use', () => {
    const fixed: FixedCost = { ...NO_FIXED, needs: [{ ingredientId: 'salmon-fillet', qty: 1.9, usedIn: ['x'] }] };
    expect(checksOf(validate(planOf(cleanMeals(), { list: salmonList(2) }), ctxOf({ fixed })), 'warning')).not.toContain('waste');
  });
});

describe('validate: busy', () => {
  it('errors when active minutes exceed a cell maxMinutes', () => {
    const cells = allCells().map((c) => (c.day === 'thu' && c.slot === 'dinner' ? { ...c, maxMinutes: 25 } : c));
    const meals = cleanMeals(cells).map((m) => (m.day === 'thu' && m.slot === 'dinner' ? { ...m, activeMinutes: 35 } : m));
    const issues = validate(planOf(meals), ctxOf({ cells }));
    expect(issues.find((i) => i.check === 'busy')!.message).toContain('takes 35 active minutes, but Thursday dinner allows 25');
  });

  it('passes when active minutes are within maxMinutes', () => {
    const cells = allCells().map((c) => (c.day === 'thu' && c.slot === 'dinner' ? { ...c, maxMinutes: 40 } : c));
    const meals = cleanMeals(cells).map((m) => (m.day === 'thu' && m.slot === 'dinner' ? { ...m, activeMinutes: 35 } : m));
    expect(checksOf(validate(planOf(meals), ctxOf({ cells })))).not.toContain('busy');
  });

  it('warns for a weeknight dinner over 40 minutes', () => {
    const meals = cleanMeals().map((m) => (m.day === 'mon' && m.slot === 'dinner' ? { ...m, activeMinutes: 45 } : m));
    expect(checksOf(validate(planOf(meals), ctxOf()), 'warning')).toContain('busy');
  });

  it('does not apply the weeknight limit at weekends', () => {
    const meals = cleanMeals().map((m) => (m.day === 'sat' && m.slot === 'dinner' ? { ...m, activeMinutes: 60 } : m));
    expect(checksOf(validate(planOf(meals), ctxOf()), 'warning')).not.toContain('busy');
  });
});

describe('validate: cravings', () => {
  const withCraving = (name: string, tags: string[] = []) => {
    const meals = cleanMeals();
    meals[0] = { ...meals[0]!, name, tags };
    return meals;
  };

  it('is satisfied by a meal whose name shares a 4+ letter word with the craving', () => {
    const issues = validate(planOf(withCraving('Butter chicken with rice'), {}, { cravings: ['butter chicken'] }), ctxOf());
    expect(checksOf(issues, 'warning')).not.toContain('cravings');
  });

  it('warns when no meal matches the craving', () => {
    const issues = validate(planOf(withCraving('Plain stew'), {}, { cravings: ['pad thai'] }), ctxOf());
    expect(issues.find((i) => i.check === 'cravings')!.message).toContain('"pad thai"');
  });

  it('is satisfied by an unclaimed meal tagged craving', () => {
    const issues = validate(planOf(withCraving('Plain stew', ['craving']), {}, { cravings: ['pad thai'] }), ctxOf());
    expect(checksOf(issues, 'warning')).not.toContain('cravings');
  });

  it('does not let one tagged meal satisfy two cravings', () => {
    const issues = validate(planOf(withCraving('Plain stew', ['craving']), {}, { cravings: ['pad thai', 'tacos'] }), ctxOf());
    expect(checksOf(issues, 'warning').filter((c) => c === 'cravings')).toHaveLength(1);
  });

  it('ignores 3-letter words such as "and" when matching', () => {
    const issues = validate(planOf(withCraving('Bean and corn'), {}, { cravings: ['lamb and rice'] }), ctxOf());
    expect(checksOf(issues, 'warning')).toContain('cravings');
  });
});

describe('validate: variety rules', () => {
  const rules = (over: Record<string, boolean>) => household({ varietyRules: { noRepeatProteinConsecutive: false, noRepeatDinner14: false, minVeg5: false, oneVegDinner: false, ...over } });

  it('noRepeatProteinConsecutive errors on the same protein two dinners in a row', () => {
    const meals = cleanMeals().map((m) => {
      if (m.day === 'thu' && m.slot === 'dinner') return { ...m, ingredients: [{ ingredientId: 'chicken-thigh-boneless', qty: 0.2, unit: 'kg' as const }] };
      if (m.day === 'fri' && m.slot === 'dinner') return { ...m, ingredients: [{ ingredientId: 'chicken-breast-boneless', qty: 0.2, unit: 'kg' as const }] };
      return m;
    });
    const issues = validate(planOf(meals), ctxOf({ household: rules({ noRepeatProteinConsecutive: true }) }));
    expect(issues.find((i) => i.check === 'variety')!.message).toContain('Thursday and Friday dinners both use chicken');
  });

  it('noRepeatProteinConsecutive passes with different proteins', () => {
    const meals = cleanMeals().map((m) => {
      if (m.day === 'thu' && m.slot === 'dinner') return { ...m, ingredients: [{ ingredientId: 'chicken-thigh-boneless', qty: 0.2, unit: 'kg' as const }] };
      if (m.day === 'fri' && m.slot === 'dinner') return { ...m, ingredients: [{ ingredientId: 'sirloin-steak', qty: 0.2, unit: 'kg' as const }] };
      return m;
    });
    expect(checksOf(validate(planOf(meals), ctxOf({ household: rules({ noRepeatProteinConsecutive: true }) })))).not.toContain('variety');
  });

  it('noRepeatDinner14 errors when a dinner was served recently', () => {
    const meals = cleanMeals().map((m) => (m.day === 'mon' && m.slot === 'dinner' ? { ...m, name: 'Red lentil dal' } : m));
    const issues = validate(planOf(meals), ctxOf({ household: rules({ noRepeatDinner14: true }), recentDinnerNames: ['red lentil dal'] }));
    expect(issues.some((i) => i.check === 'variety' && i.message.includes('last 14 days'))).toBe(true);
  });

  it('noRepeatDinner14 passes when nothing was served recently', () => {
    const issues = validate(planOf(cleanMeals()), ctxOf({ household: rules({ noRepeatDinner14: true }), recentDinnerNames: ['Chili'] }));
    expect(checksOf(issues)).not.toContain('variety');
  });

  it('minVeg5 errors with fewer than five vegetables and suggests unused ones', () => {
    const issues = validate(planOf(cleanMeals()), ctxOf({ household: rules({ minVeg5: true }) }));
    const hit = issues.find((i) => i.check === 'variety');
    expect(hit!.message).toContain('Only 1 vegetables this week');
    expect(hit!.message).toMatch(/Add .+ to a meal\./);
  });

  it('minVeg5 counts distinct vegetables and ignores fruit', () => {
    const veg = ['broccoli', 'spinach', 'carrots', 'zucchini', 'celery'];
    const meals = cleanMeals().map((m, i) => ({ ...m, ingredients: [{ ingredientId: veg[i % veg.length]!, qty: 0.1, unit: 'kg' as const }, { ingredientId: 'bananas', qty: 0.1, unit: 'kg' as const }] }));
    expect(checksOf(validate(planOf(meals), ctxOf({ household: rules({ minVeg5: true }) })))).not.toContain('variety');
  });

  it('oneVegDinner errors when every dinner has a meat or fish', () => {
    const meals = cleanMeals().map((m) => (m.slot === 'dinner' ? { ...m, ingredients: [{ ingredientId: 'chicken-thigh-boneless', qty: 0.2, unit: 'kg' as const }] } : m));
    const issues = validate(planOf(meals), ctxOf({ household: rules({ oneVegDinner: true }) }));
    expect(issues.some((i) => i.check === 'variety' && i.message.includes('No dinner is vegetarian'))).toBe(true);
  });

  it('oneVegDinner passes with a dinner of vegetarian ingredients', () => {
    const meals = cleanMeals().map((m) => (m.slot === 'dinner' && m.day === 'tue' ? { ...m, ingredients: [{ ingredientId: 'lentils-red-dry', qty: 0.2, unit: 'kg' as const }] } : m));
    expect(checksOf(validate(planOf(meals), ctxOf({ household: rules({ oneVegDinner: true }) })))).not.toContain('variety');
  });

  it('no variety check runs when the rules are off', () => {
    const meals = cleanMeals().map((m) => (m.slot === 'dinner' ? { ...m, ingredients: [{ ingredientId: 'chicken-thigh-boneless', qty: 0.2, unit: 'kg' as const }] } : m));
    expect(checksOf(validate(planOf(meals), ctxOf()))).not.toContain('variety');
  });
});

describe('validate: unpriced items', () => {
  it('warns about a list item that no enabled store sells', () => {
    const list = [item('broccoli', { store: 'Unpriced', packs: 0, packQty: 0, packPrice: 0, total: 0 })];
    const issues = validate(planOf(cleanMeals(), { list }), ctxOf());
    expect(issues.some((i) => i.check === 'unknown-ingredient' && i.severity === 'warning')).toBe(true);
  });
});

// ---------- buildList ----------

function deal(ingredientId: string, store: string, pricePerUnit: number, packQty = 1): Deal {
  return { ingredientId, store, pricePerUnit, packQty, packPrice: pricePerUnit * packQty, discountPct: 0, baseline: pricePerUnit, validTo: '2026-11-18', score: 0 };
}

const oneMeal = (ingredients: { id: string; qty: number }[]): PlannedMeal[] => [
  {
    id: 'm1',
    day: 'thu',
    slot: 'dinner',
    name: 'Test',
    eaters: ['ann'],
    ingredients: ingredients.map((i) => ({ ingredientId: i.id, qty: i.qty, unit: 'kg' as const })),
    activeMinutes: 10,
    steps: [],
    tags: [],
  },
];

describe('buildList: store choice', () => {
  // broccoli: A $5, B $3. spinach: A $1, B $4. Both needed 1 kg.
  const deals = [deal('broccoli', 'A', 5), deal('broccoli', 'B', 3), deal('spinach', 'A', 1), deal('spinach', 'B', 4)];
  const meals = oneMeal([{ id: 'broccoli', qty: 1 }, { id: 'spinach', qty: 1 }]);

  it('with maxStores 1, buys everything at the single cheapest store', () => {
    const list = buildList(meals, NO_FIXED, deals, [], ['A', 'B'], 1);
    expect(new Set(list.map((i) => i.store))).toEqual(new Set(['A']));
    expect(list.reduce((s, i) => s + i.total, 0)).toBe(6);
  });

  it('with maxStores 2, takes the cheapest store for each ingredient', () => {
    const list = buildList(meals, NO_FIXED, deals, [], ['A', 'B'], 2);
    expect(list.find((i) => i.ingredientId === 'broccoli')!.store).toBe('B');
    expect(list.find((i) => i.ingredientId === 'spinach')!.store).toBe('A');
    expect(list.reduce((s, i) => s + i.total, 0)).toBe(4);
  });

  it('prefers fewer stores when two choices cost the same', () => {
    const tied = [deal('broccoli', 'A', 3), deal('broccoli', 'B', 3), deal('spinach', 'A', 1), deal('spinach', 'B', 4)];
    const list = buildList(meals, NO_FIXED, tied, [], ['A', 'B'], 2);
    expect(new Set(list.map((i) => i.store))).toEqual(new Set(['A']));
  });

  it('ignores stores that are not enabled', () => {
    const list = buildList(meals, NO_FIXED, deals, [], ['A'], 2);
    expect(new Set(list.map((i) => i.store))).toEqual(new Set(['A']));
  });

  it('rounds packs up and uses the pack price', () => {
    const big = [deal('broccoli', 'A', 2, 1.5)];
    const list = buildList(oneMeal([{ id: 'broccoli', qty: 2 }]), NO_FIXED, big, [], ['A'], 1);
    expect(list[0]).toMatchObject({ packs: 2, total: 6 });
  });

  it('adds fixed-meal needs to the same ingredient before rounding packs', () => {
    const fixed: FixedCost = { ...NO_FIXED, needs: [{ ingredientId: 'broccoli', qty: 0.7, usedIn: ['f1'] }] };
    const list = buildList(oneMeal([{ id: 'broccoli', qty: 0.5 }]), fixed, [deal('broccoli', 'A', 2)], [], ['A'], 1);
    expect(list[0]).toMatchObject({ packs: 2, total: 4, usedIn: ['m1', 'f1'] });
  });

  it('marks an ingredient with no enabled store as Unpriced', () => {
    const list = buildList(oneMeal([{ id: 'broccoli', qty: 1 }]), NO_FIXED, [], [], ['A'], 1);
    expect(list[0]).toMatchObject({ store: 'Unpriced', total: 0, needed: 1 });
  });

  it('sorts by store subtotal, then category order, then name', () => {
    const d = [deal('broccoli', 'A', 1), deal('carrots', 'A', 1), deal('garlic', 'B', 10)];
    const list = buildList(oneMeal([{ id: 'broccoli', qty: 1 }, { id: 'carrots', qty: 1 }, { id: 'garlic', qty: 1 }]), NO_FIXED, d, [], ['A', 'B'], 2);
    expect(list.map((i) => i.store)).toEqual(['B', 'A', 'A']);
  });
});

describe('buildList: price-match hint', () => {
  // With maxStores 1, the subset {A} covers spinach, which only A sells, so A is chosen for
  // broccoli even though B is cheaper for broccoli. That is the case a price-match hint is for.
  const deals = [deal('broccoli', 'A', 5), deal('broccoli', 'B', 3), deal('spinach', 'A', 1)];
  const meals = oneMeal([{ id: 'broccoli', qty: 1 }, { id: 'spinach', qty: 1 }]);

  it('appears when the chosen store matches prices and an unchosen store is at least 10% cheaper', () => {
    const list = buildList(meals, NO_FIXED, deals, [], ['A', 'B'], 1, ['A']);
    const broccoli = list.find((i) => i.ingredientId === 'broccoli')!;
    expect(broccoli.store).toBe('A');
    expect(broccoli.priceMatch).toEqual({ fromStore: 'B', pricePerUnit: 3 });
  });

  it('does not appear for a store that does not match prices', () => {
    const list = buildList(meals, NO_FIXED, deals, [], ['A', 'B'], 1, ['B']);
    expect(list.find((i) => i.ingredientId === 'broccoli')!.priceMatch).toBeUndefined();
  });

  it('does not appear when the gap is under 10%', () => {
    const close = [deal('broccoli', 'A', 5), deal('broccoli', 'B', 4.8), deal('spinach', 'A', 1)];
    const list = buildList(meals, NO_FIXED, close, [], ['A', 'B'], 1, ['A']);
    expect(list.find((i) => i.ingredientId === 'broccoli')!.priceMatch).toBeUndefined();
  });

  it('uses matched flyer items as well as deals', () => {
    const matchedItem: MatchedItem = {
      id: 'x', store: 'B', rawName: 'x', priceText: '', validFrom: '2026-11-12', validTo: '2026-11-18', source: 'fixture',
      ingredientId: 'broccoli', confidence: 0.9, packQty: 1, pricePerUnit: 3, packPrice: 3,
    };
    const list = buildList(meals, NO_FIXED, [deal('broccoli', 'A', 5), deal('spinach', 'A', 1)], [matchedItem], ['A', 'B'], 1, ['A']);
    expect(list.find((i) => i.ingredientId === 'broccoli')!.priceMatch).toEqual({ fromStore: 'B', pricePerUnit: 3 });
  });
});

describe('validate: busy hard cap from household time caps', () => {
  it('a timeCaps entry becomes a hard error for a meal over it', () => {
    const h = household({ timeCaps: { wed: { dinner: 15 } } });
    const { cells } = expandWeek(h, { weekOf: '2026-11-15', budget: 150, cravings: [], overrides: [], useItUp: true });
    const meals = cleanMeals(cells).map((m) => (m.day === 'wed' && m.slot === 'dinner' ? { ...m, activeMinutes: 20 } : m));
    const issues = validate(planOf(meals), ctxOf({ cells, household: h }));
    expect(issues.find((i) => i.check === 'busy')).toMatchObject({ severity: 'error' });
    expect(issues.find((i) => i.check === 'busy')!.message).toContain('allows 15');
  });

  it('a week override cap wins over the household cap', () => {
    const h = household({ timeCaps: { wed: { dinner: 15 } } });
    const request: PlanRequest = { weekOf: '2026-11-15', budget: 150, cravings: [], overrides: [{ day: 'wed', slot: 'dinner', maxMinutes: 30 }], useItUp: true };
    const { cells } = expandWeek(h, request);
    expect(cells.find((c) => c.day === 'wed' && c.slot === 'dinner')!.maxMinutes).toBe(30);
  });
});

describe('validate: use-it-up', () => {
  const soon = [{ ingredientId: 'spinach', expiresOn: '2026-11-12' }];

  it('warns when a pantry item due soon is in no meal', () => {
    const issues = validate(planOf(cleanMeals()), ctxOf({ useFirst: soon }));
    const hit = issues.find((i) => i.check === 'use-it-up');
    expect(hit).toMatchObject({ severity: 'warning' });
    expect(hit!.message).toBe('Use Spinach before Nov 12: add it to a meal.');
  });

  it('passes when a meal uses the item', () => {
    const meals = cleanMeals().map((m, i) => (i === 0 ? { ...m, ingredients: [{ ingredientId: 'spinach', qty: 0.2, unit: 'kg' as const }] } : m));
    expect(checksOf(validate(planOf(meals), ctxOf({ useFirst: soon })), 'warning')).not.toContain('use-it-up');
  });

  it('does nothing when use-it-up is off', () => {
    const issues = validate(planOf(cleanMeals(), {}, { useItUp: false }), ctxOf({ useFirst: soon }));
    expect(checksOf(issues, 'warning')).not.toContain('use-it-up');
  });
});

describe('validate: never-again', () => {
  it('errors when a planned meal matches a never name, ignoring case', () => {
    const meals = cleanMeals().map((m, i) => (i === 0 ? { ...m, name: 'Liver and onions' } : m));
    const issues = validate(planOf(meals), ctxOf({ neverMeals: ['liver AND onions'] }));
    expect(issues.find((i) => i.check === 'never-again')).toMatchObject({ severity: 'error' });
  });

  it('passes when no planned meal is on the never list', () => {
    expect(checksOf(validate(planOf(cleanMeals()), ctxOf({ neverMeals: ['Liver and onions'] })))).not.toContain('never-again');
  });
});

describe('buildList: pantry', () => {
  it('leaves out an ingredient the pantry covers fully', () => {
    const pantry: PantryItem[] = [{ id: 'p1', ingredientId: 'broccoli', qty: 2, unit: 'kg', addedOn: '2026-11-01', expiresOn: '2026-11-08', source: 'manual' }];
    const list = buildList(oneMeal([{ id: 'broccoli', qty: 1 }]), NO_FIXED, [deal('broccoli', 'A', 2)], [], ['A'], 1, [], pantry);
    expect(list).toEqual([]);
  });

  it('buys only the part the pantry does not cover, rounding packs up', () => {
    // Need 1 kg, pantry holds 0.6 kg, packs are 0.5 kg: 0.4 kg short, so one pack.
    const pantry: PantryItem[] = [{ id: 'p1', ingredientId: 'broccoli', qty: 0.6, unit: 'kg', addedOn: '2026-11-01', expiresOn: '2026-11-08', source: 'manual' }];
    const list = buildList(oneMeal([{ id: 'broccoli', qty: 1 }]), NO_FIXED, [deal('broccoli', 'A', 2, 0.5)], [], ['A'], 1, [], pantry);
    expect(list[0]).toMatchObject({ packs: 1, total: 1, usedIn: ['m1'] });
  });
});

describe('buildList: store cap', () => {
  // Three stores, each sells one ingredient only. With maxStores 2, one of them must be left out.
  const deals = [deal('broccoli', 'A', 2), deal('spinach', 'B', 2), deal('garlic', 'C', 5)];
  const meals = oneMeal([{ id: 'broccoli', qty: 1 }, { id: 'spinach', qty: 1 }, { id: 'garlic', qty: 1 }]);

  it('never buys from more stores than maxStores', () => {
    const list = buildList(meals, NO_FIXED, deals, [], ['A', 'B', 'C'], 2);
    const bought = new Set(list.filter((i) => i.store !== 'Unpriced').map((i) => i.store));
    expect(bought.size).toBeLessThanOrEqual(2);
    expect(list.filter((i) => i.store === 'Unpriced')).toHaveLength(1);
  });

  it('leaves out the ingredients the chosen stores cannot cover, and never buys them from another store', () => {
    const list = buildList(meals, NO_FIXED, deals, [], ['A', 'B', 'C'], 1);
    expect(new Set(list.filter((i) => i.store !== 'Unpriced').map((i) => i.store))).toEqual(new Set(['A']));
    const left = list.filter((i) => i.store === 'Unpriced').map((i) => i.ingredientId).sort();
    expect(left).toEqual(['garlic', 'spinach']);
  });

  it('gives an uncovered item the cheapest elsewhere hint, from an enabled store outside the list', () => {
    const list = buildList(meals, NO_FIXED, deals, [], ['A', 'B', 'C'], 1);
    expect(list.find((i) => i.ingredientId === 'garlic')).toMatchObject({
      store: 'Unpriced',
      needed: 1,
      cheapestElsewhere: { store: 'C', price: 5 },
    });
  });

  it('covers the most ingredients first, then the lowest total', () => {
    // A covers broccoli and spinach (total 4). B covers only garlic. Two stores, so A + B covers all.
    const d = [deal('broccoli', 'A', 2), deal('spinach', 'A', 2), deal('garlic', 'B', 5)];
    const list = buildList(meals, NO_FIXED, d, [], ['A', 'B'], 2);
    expect(list.filter((i) => i.store === 'Unpriced')).toHaveLength(0);
    expect(list.reduce((s, i) => s + i.total, 0)).toBe(9);
  });

  it('gives no hint to an ingredient no enabled store sells', () => {
    const list = buildList(oneMeal([{ id: 'broccoli', qty: 1 }]), NO_FIXED, [], [], ['A'], 1);
    expect(list[0]!.cheapestElsewhere).toBeUndefined();
  });
});

describe('validate: store cap warning', () => {
  const capped = (n: number, cheaper = true): ListItem[] =>
    Array.from({ length: n }, (_, i) =>
      item(`x${i}`, {
        store: 'Unpriced',
        packs: 0,
        packQty: 0,
        packPrice: 0,
        total: 0,
        ...(cheaper ? { cheapestElsewhere: { store: 'Longo', price: 4.99 } } : {}),
      }),
    );

  it('warns with the count and the top store limit', () => {
    const h = household({ maxStores: 2 });
    const issues = validate(planOf(cleanMeals(), { list: capped(2) }), ctxOf({ household: h }));
    const hit = issues.find((i) => i.check === 'store-cap');
    expect(hit).toMatchObject({ severity: 'warning', message: "2 items aren't in your top 2 stores' flyers; buy them anywhere or allow more stores." });
  });

  it('uses the singular for one item and one store', () => {
    const h = household({ maxStores: 1 });
    const issues = validate(planOf(cleanMeals(), { list: capped(1) }), ctxOf({ household: h }));
    expect(issues.find((i) => i.check === 'store-cap')!.message).toBe("1 item isn't in your top 1 store's flyers; buy it anywhere or allow more stores.");
  });

  it('is not raised for items no enabled store sells, and those keep the unpriced warning', () => {
    const plain = capped(1, false);
    const issues = validate(planOf(cleanMeals(), { list: plain }), ctxOf());
    expect(issues.some((i) => i.check === 'store-cap')).toBe(false);
    expect(issues.some((i) => i.check === 'unknown-ingredient' && i.severity === 'warning')).toBe(true);
  });

  it('does not repeat the unpriced warning for items another enabled store sells', () => {
    const issues = validate(planOf(cleanMeals(), { list: capped(2) }), ctxOf());
    expect(issues.some((i) => i.check === 'unknown-ingredient')).toBe(false);
  });
});
