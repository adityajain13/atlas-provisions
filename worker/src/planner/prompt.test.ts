import { describe, expect, it } from 'vitest';
import { defaultHousehold, expandWeek, INGREDIENT_BY_ID, type Deal, type FixedCost, type PlanRequest, type Household, type SlotCell } from '@provisions/shared';
import {
  buildAvailable,
  buildPayload,
  eachMeansFor,
  leftoverChainsOf,
  plannerSystem,
  SUBMIT_PLAN_TOOL,
  splitPayload,
  submitPlanTool,
  SWAP_PROMPT,
  SYSTEM_PROMPT,
  swapPrompt,
} from './prompt';

const noFixed: FixedCost = { cost: 0, listItems: [], macrosByPerson: {}, leftovers: [], needs: [], issues: [] };
const FULL = { prep: true, leftovers: true };

function deal(ingredientId: string, score: number, staple = false, packPrice = 3): Deal {
  return { ingredientId, store: 'No Frills', pricePerUnit: 3, packQty: 1, packPrice, discountPct: 0.2, baseline: 4, validTo: '2026-11-18', score, ...(staple ? { staple: true } : {}) };
}

describe('buildAvailable', () => {
  it('gives each deal its pack price, rounded to cents, and pantry stock a price of zero', () => {
    const out = buildAvailable([deal('broccoli', 0.5, false, 2.4567)], noFixed, [
      { id: 'p1', ingredientId: 'greek-yogurt', qty: 0.4, unit: INGREDIENT_BY_ID['greek-yogurt']!.baseUnit, addedOn: '2026-11-10', expiresOn: '2026-11-13', source: 'manual' as const },
    ]);
    expect(out.find((a) => a.id === 'broccoli')?.packPrice).toBe(2.46);
    expect(out.find((a) => a.id === 'greek-yogurt')?.packPrice).toBe(0);
  });

  it('takes a regular item its estimated pack price', () => {
    const out = buildAvailable([], noFixed, [], { regular: [{ id: 'broccoli', packQty: 1, packPrice: 4.2, basis: 'typical' }] });
    expect(out[0]).toMatchObject({ id: 'broccoli', source: 'regular', packPrice: 4.2, estimate: { basis: 'typical' } });
  });

  it('keeps the best-scoring entry per ingredient and marks staples', () => {
    const out = buildAvailable([deal('broccoli', 0.2), deal('broccoli', 0.5), deal('butter', 0.1, true)], noFixed);
    expect(out.find((a) => a.id === 'broccoli')).toMatchObject({ source: 'deal', score: 0.5 });
    expect(out.find((a) => a.id === 'butter')).toMatchObject({ source: 'staple' });
  });

  it('adds fixed-meal leftovers that no deal covers', () => {
    const fixed: FixedCost = { ...noFixed, leftovers: [{ ingredientId: 'greek-yogurt', qty: 0.4 }] };
    const out = buildAvailable([], fixed);
    expect(out).toEqual([expect.objectContaining({ id: 'greek-yogurt', source: 'fixed-leftover', packQty: 0.4, packPrice: 0 })]);
  });
});

describe('each quantities', () => {
  it('says what one unit of an each item is, from the catalogue weight', () => {
    const out = buildAvailable([deal('white-bread', 0.5), deal('broccoli', 0.5), deal('eggs-large', 0.4)], noFixed);
    expect(out.find((a) => a.id === 'white-bread')?.eachMeans).toBe('1 = one loaf as sold (~675 g)');
    expect(out.find((a) => a.id === 'eggs-large')?.eachMeans).toBe('1 = one dozen carton as sold (~700 g)');
    expect(out.find((a) => a.id === 'broccoli')?.eachMeans).toBeUndefined();
  });

  it('falls back to the generic meaning for an each item with no weight', () => {
    expect(eachMeansFor({ baseUnit: 'each' })).toBe('1 = one item as sold (a loaf, a bunch, a dozen eggs carton, one pepper)');
    expect(eachMeansFor({ baseUnit: 'kg', eachWeightKg: 1 })).toBeUndefined();
  });

  it('passes eachMeans through the payload, and the system prompt forbids counting slices', () => {
    const household: Household = { ...defaultHousehold() };
    const request: PlanRequest = { weekOf: '2026-11-15', budget: 150, cravings: [], overrides: [], useItUp: true };
    const { cells, fixed } = expandWeek(household, request);
    const available = buildAvailable([deal('white-bread', 0.5)], noFixed);
    const payload = buildPayload({ household, request, cells, fixed, fixedCost: noFixed, available, recentDinnerNames: [] });
    expect(payload.available.find((a) => a.id === 'white-bread')?.eachMeans).toBe('1 = one loaf as sold (~675 g)');
    expect(SYSTEM_PROMPT).toContain('never slices or servings');
    expect(SYSTEM_PROMPT).toContain('two people having toast all week is 1 loaf, not 7');
  });

  it('sends the never-buy words to the planner, and tells it not to build a meal around them', () => {
    const household: Household = { ...defaultHousehold() };
    const request: PlanRequest = { weekOf: '2026-11-15', budget: 150, cravings: [], overrides: [], useItUp: false };
    const { cells, fixed } = expandWeek(household, request);
    const payload = buildPayload({ household, request, cells, fixed, fixedCost: noFixed, available: [], neverBuyWords: ['beef'], recentDinnerNames: [] });
    expect(payload.neverBuyWords).toEqual(['beef']);
    expect(SYSTEM_PROMPT).toContain("Never plan a meal built around a word in `neverBuyWords` (e.g. 'beef' rules out a beef stir-fry)");
    // Without any words, the field is left out.
    const bare = buildPayload({ household, request, cells, fixed, fixedCost: noFixed, available: [], recentDinnerNames: [] });
    expect(bare).not.toHaveProperty('neverBuyWords');
  });
});

describe('buildPayload', () => {
  const household: Household = {
    ...defaultHousehold(),
    people: [
      { id: 'ann', name: 'Ann', dietTags: ['vegetarian'], allergies: ['dairy'], proteinTargetG: 80 },
      { id: 'ben', name: 'Ben', dietTags: [], allergies: [] },
    ],
  };
  const request: PlanRequest = { weekOf: '2026-11-15', budget: 150, cravings: ['tacos'], overrides: [], useItUp: true };

  it('builds slots, allergies and the remaining budget after fixed meals, with a per-meal target', () => {
    const { cells, fixed } = expandWeek(household, request);
    const payload = buildPayload({
      household,
      request,
      cells,
      fixed,
      fixedCost: { ...noFixed, cost: 20 },
      available: [],
      recentDinnerNames: [],
    });
    expect(payload.slots).toHaveLength(21);
    expect(payload.slots[0]).toEqual({ id: 'sun-breakfast', day: 'sun', slot: 'breakfast', eaters: ['ann', 'ben'] });
    expect(payload.allergies).toEqual({ ann: ['dairy'] });
    expect(payload.remainingBudget).toBe(130);
    expect(payload.perMealTarget).toBe(Math.round((130 / 21) * 100) / 100);
    expect(payload.people[0]).toMatchObject({ id: 'ann', proteinTargetG: 80, dietTags: ['vegetarian'] });
    expect(payload.people[1]).not.toHaveProperty('dietTags');
    expect(payload.prepDay).toBe('sun');
  });

  it('leaves out empty and null fields: no feedback on a first attempt, no neverBuy, no formsAllowed', () => {
    const { cells, fixed } = expandWeek(household, { ...request, useItUp: false, cravings: [] });
    const payload = buildPayload({ household, request: { ...request, cravings: [] }, cells, fixed, fixedCost: noFixed, available: [], recentDinnerNames: [] });
    expect(payload).not.toHaveProperty('feedback');
    expect(payload).not.toHaveProperty('ingredientFeedback');
    expect(payload).not.toHaveProperty('useFirst');
    expect(payload).not.toHaveProperty('cravings');
    expect(payload).not.toHaveProperty('formsAllowed');
    expect(payload).not.toHaveProperty('neverBuy');
    expect(payload).not.toHaveProperty('onHandCustom');
  });

  it('sends the issues of the previous attempt as feedback, and only then', () => {
    const { cells, fixed } = expandWeek(household, request);
    const issues = [{ check: 'budget' as const, severity: 'error' as const, message: 'Over budget by $5.00.' }];
    const retry = buildPayload({ household, request, cells, fixed, fixedCost: noFixed, available: [], recentDinnerNames: [], issues });
    expect(retry.feedback).toEqual(issues);
  });

  it('fills useFirst from fixed-meal leftovers only when use-it-up is on, and avoid only with the 14-day rule', () => {
    const { cells, fixed } = expandWeek(household, request);
    const available = buildAvailable([], { ...noFixed, leftovers: [{ ingredientId: 'greek-yogurt', qty: 0.4 }] });
    const on = buildPayload({ household, request, cells, fixed, fixedCost: noFixed, available, recentDinnerNames: ['Chili'] });
    expect(on.useFirst).toEqual(['greek-yogurt']);
    expect(on).not.toHaveProperty('avoid');

    const ruleOn: Household = { ...household, varietyRules: { ...household.varietyRules, noRepeatDinner14: true } };
    const off = buildPayload({ household, request: { ...request, useItUp: false }, cells, fixed, fixedCost: noFixed, available, recentDinnerNames: ['Chili'] });
    expect(off).not.toHaveProperty('useFirst');
    const withRule = buildPayload({ household: ruleOn, request, cells, fixed, fixedCost: noFixed, available, recentDinnerNames: ['Chili'] });
    expect(withRule.avoid).toEqual(['Chili']);
  });

  it('offers pantry stock as pantry entries, which beat a deal for the same ingredient', () => {
    const pantry = [
      { id: 'p1', ingredientId: 'broccoli', qty: 0.4, unit: 'kg' as const, addedOn: '2026-11-10', expiresOn: '2026-11-13', source: 'manual' as const },
      { id: 'p2', ingredientId: 'broccoli', qty: 0.2, unit: 'kg' as const, addedOn: '2026-11-11', expiresOn: '2026-11-14', source: 'manual' as const },
    ];
    const out = buildAvailable([deal('broccoli', 0.6), deal('spinach', 0.2)], noFixed, pantry);
    expect(out.find((a) => a.id === 'broccoli')).toMatchObject({ source: 'pantry', score: 1, packQty: 0.6 });
    expect(out.find((a) => a.id === 'spinach')).toMatchObject({ source: 'deal' });
  });

  it('passes pantry use-first ids, favourites and avoid to the payload', () => {
    const { cells, fixed } = expandWeek(household, request);
    const payload = buildPayload({
      household,
      request,
      cells,
      fixed,
      fixedCost: noFixed,
      available: [],
      recentDinnerNames: ['Chili'],
      pantryUseFirst: ['spinach'],
      favourites: ['Tacos'],
      avoid: ['Fish', 'Chili'],
    });
    expect(payload.useFirst).toEqual(['spinach']);
    expect(payload.favourites).toEqual(['Tacos']);
    expect(payload.avoid).toEqual(['Fish', 'Chili']); // the 14-day rule is off here, so recent dinners are not added
  });

  it('sends each item with its pack price, and its allergens, vegetarian flag and shelf life only when they say something', () => {
    const { cells, fixed } = expandWeek(household, request);
    const available = buildAvailable([deal('broccoli', 0.5, false, 2.5), deal('milk-2-percent', 0.4, false, 4)], noFixed);
    const payload = buildPayload({ household, request, cells, fixed, fixedCost: noFixed, available, recentDinnerNames: [] });
    const broccoli = payload.available.find((a) => a.id === 'broccoli')!;
    expect(broccoli.packPrice).toBe(2.5);
    expect(broccoli).not.toHaveProperty('allergens');
    expect(payload.available.find((a) => a.id === 'milk-2-percent')?.allergens).toEqual(INGREDIENT_BY_ID['milk-2-percent']!.allergens);
    // A vegetarian is in the household, so each item says whether it is vegetarian.
    expect(broccoli.vegetarian).toBe(INGREDIENT_BY_ID['broccoli']!.vegetarian);
    for (const item of payload.available) {
      if (item.shelfLifeDays !== undefined) expect(item.shelfLifeDays).toBeLessThan(7);
    }
  });

  it('leaves the vegetarian flag out of items when nobody in the household is vegetarian', () => {
    const plain: Household = { ...defaultHousehold(), people: [{ id: 'ben', name: 'Ben', dietTags: [], allergies: [] }] };
    const { cells, fixed } = expandWeek(plain, request);
    const payload = buildPayload({ household: plain, request, cells, fixed, fixedCost: noFixed, available: buildAvailable([deal('broccoli', 0.5)], noFixed), recentDinnerNames: [] });
    expect(payload.available[0]).not.toHaveProperty('vegetarian');
  });

  it('system prompt asks for the submit_plan tool and the no-prices rule', () => {
    expect(SYSTEM_PROMPT).toContain('submit_plan');
    expect(SYSTEM_PROMPT).toContain('never the slot name');
    expect(SYSTEM_PROMPT).toContain('Do not estimate prices');
  });

  it('system prompt says meal names carry no portion counts', () => {
    expect(SYSTEM_PROMPT).toContain('Meal names describe the dish only');
    expect(SYSTEM_PROMPT).toContain("'(2 portions)'");
  });
});

describe('the system prompt variants', () => {
  it('adds the prep rules only with a prep day', () => {
    expect(plannerSystem({ prep: false, leftovers: false })).not.toContain('Prep rule:');
    expect(plannerSystem({ prep: false, leftovers: false })).not.toContain('Batch prep');
    expect(plannerSystem({ prep: true, leftovers: false })).toContain('Batch prep: when `prepDay` is set');
    expect(plannerSystem({ prep: true, leftovers: false })).toContain('Prep rule:');
  });

  it('adds the leftover-chain sentence only when the week has chains to make', () => {
    expect(plannerSystem({ prep: false, leftovers: true })).toContain('Chain leftovers: make `leftoverChains` dinners');
    expect(plannerSystem({ prep: false, leftovers: false })).not.toContain('Chain leftovers');
  });

  it('is the same text every time it is asked for, so the cached block does not change between attempts', () => {
    expect(plannerSystem(FULL)).toBe(plannerSystem(FULL));
    expect(SYSTEM_PROMPT).toBe(plannerSystem(FULL));
  });

  it('keeps the swap block separate, with the prep sentence only when there is a prep day', () => {
    expect(SWAP_PROMPT).toBe(swapPrompt(true));
    expect(swapPrompt(true)).toContain("Return the full week's prep list");
    expect(swapPrompt(false)).not.toContain('prep');
    expect(swapPrompt(false)).toContain('Keep every meal in keptMeals exactly as it is');
  });

  it('submit_plan takes an optional prep list whose steps link to meal ids', () => {
    const schema = SUBMIT_PLAN_TOOL.input_schema;
    expect(schema.required).toEqual(['meals', 'notes']);
    const prep = schema.properties.prep;
    expect(prep.required).toEqual(['day', 'steps']);
    expect(prep.properties.steps.items.required).toEqual(['task', 'minutes', 'forMeals', 'day', 'storage']);
    expect(prep.properties.steps.items.properties.forMeals.type).toBe('array');
  });

  it('drops the prep property from the tool for a household with no prep day, without changing the shared tool', () => {
    const without = submitPlanTool(false).input_schema as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(without.properties)).toEqual(['meals', 'notes']);
    expect(without.required).toEqual(['meals', 'notes']);
    expect(submitPlanTool(false)).toBe(submitPlanTool(false));
    expect(submitPlanTool(true)).toBe(SUBMIT_PLAN_TOOL);
    expect(Object.keys(SUBMIT_PLAN_TOOL.input_schema.properties)).toContain('prep');
  });
});

describe('leftover chains', () => {
  const cell = (day: SlotCell['day'], slot: SlotCell['slot']): SlotCell => ({ day, slot, eaters: ['ann'] });

  it('counts the lunches that follow a dinner the day before, capped at two', () => {
    expect(leftoverChainsOf([cell('sun', 'dinner'), cell('mon', 'lunch')])).toBe(1);
    expect(leftoverChainsOf([cell('sun', 'dinner'), cell('mon', 'lunch'), cell('tue', 'dinner'), cell('wed', 'lunch'), cell('thu', 'dinner'), cell('fri', 'lunch')])).toBe(2);
  });

  it('counts nothing when no dinner is on the day before, or the lunch is on the same day as the dinner', () => {
    expect(leftoverChainsOf([cell('mon', 'lunch')])).toBe(0);
    expect(leftoverChainsOf([cell('mon', 'dinner'), cell('mon', 'lunch')])).toBe(0);
    expect(leftoverChainsOf([])).toBe(0);
  });

  it('sends leftoverChains for a new plan with a chain, and not for a swap', () => {
    const household: Household = { ...defaultHousehold() };
    const request: PlanRequest = { weekOf: '2026-11-15', budget: 150, cravings: [], overrides: [], useItUp: false };
    const { fixed } = expandWeek(household, request);
    const cells = [cell('sun', 'dinner'), cell('mon', 'lunch')];
    const fresh = buildPayload({ household, request, cells, fixed, fixedCost: noFixed, available: [], recentDinnerNames: [] });
    expect(fresh.leftoverChains).toBe(1);
    const swap = buildPayload({ household, request, cells, fixed, fixedCost: noFixed, available: [], recentDinnerNames: [], keptMeals: [] });
    expect(swap).not.toHaveProperty('leftoverChains');
    const none = buildPayload({ household, request, cells: [cell('mon', 'lunch')], fixed, fixedCost: noFixed, available: [], recentDinnerNames: [] });
    expect(none).not.toHaveProperty('leftoverChains');
  });
});

describe('splitPayload', () => {
  it('puts the shared fields in stable and the varying ones in variable, with keys in a fixed order', () => {
    const household: Household = { ...defaultHousehold() };
    const request: PlanRequest = { weekOf: '2026-11-15', budget: 150, cravings: ['tacos'], overrides: [], useItUp: false };
    const { cells, fixed } = expandWeek(household, request);
    const payload = buildPayload({ household, request, cells, fixed, fixedCost: noFixed, available: [], recentDinnerNames: [] });
    const { stable, variable } = splitPayload(payload);
    expect(Object.keys(variable).sort()).toEqual(['perMealTarget', 'remainingBudget', 'slots', 'weekOf'].filter((k) => k in payload).sort());
    expect(stable).toHaveProperty('available');
    expect(stable).toHaveProperty('cuisineMix');
    expect(stable).not.toHaveProperty('slots');
    expect(Object.keys(stable)).toEqual(Object.keys(stable).slice().sort());
    expect(JSON.stringify(splitPayload(payload).stable)).toBe(JSON.stringify(stable));
  });
});

describe('food forms, dishes and storage in the planner payload', () => {
  const request: PlanRequest = { weekOf: '2026-11-15', budget: 150, cravings: [], overrides: [], useItUp: false };

  it('lists the dishes to avoid and the storage, and no forms (blocked forms are already out of available)', () => {
    const household: Household = {
      ...defaultHousehold(),
      people: [{ id: 'ann', name: 'Ann', dietTags: [], allergies: [] }],
      avoidDishes: ['slaw'],
      forms: { fish: ['fresh', 'frozen'] },
      storage: { containers: 'few', freezer: false, zipBags: true, freezerBags: true },
    };
    const payload = buildPayload({ household, request, cells: expandWeek(household, request).cells, fixed: [], fixedCost: noFixed, available: [], recentDinnerNames: [] });
    expect(payload.avoidDishes).toEqual(['slaw']);
    expect(payload).not.toHaveProperty('formsAllowed');
    expect(payload.storage).toEqual({ containers: 'few', freezer: false, zipBags: true, freezerBags: true });
  });

  it('leaves out the dishes list for a household saved before these fields, and keeps the default storage', () => {
    const household = defaultHousehold();
    const payload = buildPayload({ household, request, cells: [], fixed: [], fixedCost: noFixed, available: [], recentDinnerNames: [] });
    expect(payload).not.toHaveProperty('avoidDishes');
    expect(payload.storage).toEqual({ containers: 'some', freezer: true, zipBags: true, freezerBags: true });
  });

  it('tells the planner to avoid dishes by variant, and that an available form is the form it names', () => {
    expect(SYSTEM_PROMPT).toContain("Never plan a dish in `avoidDishes` or a close variant of it (e.g. 'slaw' rules out coleslaw");
    expect(SYSTEM_PROMPT).toContain('An available item with a `form` is that form.');
  });

  it('gives each available item its form, and none when it has no form', () => {
    const out = buildAvailable([deal('canned-tuna', 0.5), deal('chicken-thigh-boneless', 0.5)], noFixed);
    expect(out.find((a) => a.id === 'canned-tuna')?.form).toBe('canned');
    expect(out.find((a) => a.id === 'chicken-thigh-boneless')).not.toHaveProperty('form');
  });
});

describe('ingredient changes and variety in the planner prompt', () => {
  const request: PlanRequest = { weekOf: '2026-11-15', budget: 150, cravings: [], overrides: [], useItUp: false };

  it('sends the skipped ingredients and the preferred swaps only when there are some', () => {
    const household = defaultHousehold();
    const cells = expandWeek(household, request).cells;
    const none = buildPayload({ household, request, cells, fixed: [], fixedCost: noFixed, available: [], recentDinnerNames: [] });
    expect(none).not.toHaveProperty('ingredientFeedback');

    const feedback = { oftenSkipped: ['cilantro'], preferredSwaps: [{ from: 'sour-cream', to: 'Greek yogurt', toId: 'greek-yogurt' }] };
    const some = buildPayload({ household, request, cells, fixed: [], fixedCost: noFixed, available: [], recentDinnerNames: [], feedback });
    expect(some.ingredientFeedback).toEqual(feedback);
  });

  it('tells the model to avoid the often-skipped ingredients, use the swaps, and keep each non-staple to three meals', () => {
    expect(SYSTEM_PROMPT).toContain('avoid `oftenSkipped` ingredients');
    expect(SYSTEM_PROMPT).toContain('`preferredSwaps`');
    expect(SYSTEM_PROMPT).toContain('use a non-staple ingredient in at most 3 meals a week');
    expect(SYSTEM_PROMPT).toContain('Ingredients of cravings are exempt from the 3-meal limit.');
    expect(SYSTEM_PROMPT).toContain('pick a different vegetable or accept some left over');
  });
});

describe('seasonality, custom staples and the cravings and balance rules', () => {
  const request: PlanRequest = { weekOf: '2026-11-15', budget: 150, cravings: ['chicken'], overrides: [], useItUp: false };
  const available = () => buildAvailable([deal('zucchini', 0.5), deal('mangoes', 0.4), deal('broccoli', 0.5)], noFixed);

  function payloadFor(over: Partial<Household> = {}) {
    const household: Household = { ...defaultHousehold(), ...over };
    const { cells, fixed } = expandWeek(household, request);
    return buildPayload({ household, request, cells, fixed, fixedCost: noFixed, available: available(), recentDinnerNames: [] });
  }

  it('sends the plan month and the preference, and flags out-of-season and imported produce', () => {
    const p = payloadFor();
    expect(p.month).toBe('November');
    expect(p.preferSeasonal).toBe(true);
    expect(p.available.find((a) => a.id === 'zucchini')).toMatchObject({ outOfSeason: true });
    expect(p.available.find((a) => a.id === 'mangoes')).toMatchObject({ imported: true });
    expect(p.available.find((a) => a.id === 'broccoli')).not.toHaveProperty('outOfSeason');
  });

  it('flags nothing by season when the household turns the preference off', () => {
    const p = payloadFor({ preferSeasonal: false });
    expect(p.preferSeasonal).toBe(false);
    expect(p.available.find((a) => a.id === 'zucchini')).not.toHaveProperty('outOfSeason');
    expect(p.available.find((a) => a.id === 'mangoes')).toMatchObject({ imported: true });
  });

  it('sends the staples with no catalogue id as plain names, and leaves the field out when there are none', () => {
    expect(payloadFor({ onHandCustom: ['Lao Gan Ma-style chili crunch'] }).onHandCustom).toEqual(['Lao Gan Ma-style chili crunch']);
    expect(payloadFor()).not.toHaveProperty('onHandCustom');
  });

  it('system prompt states the ingredient-craving minimum, the protein balance and the seasonal rule', () => {
    expect(SYSTEM_PROMPT).toContain('An ingredient craving');
    expect(SYSTEM_PROMPT).toContain('at least a third of the dinners');
    expect(SYSTEM_PROMPT).toContain('substantial protein');
    expect(SYSTEM_PROMPT).toContain('When preferSeasonal: avoid produce marked outOfSeason or imported unless it is on a flyer deal this week');
  });
});

describe('cravingDinners, prep steps and the vegetarian meal in the prompt', () => {
  const household = { ...defaultHousehold() };
  const request: PlanRequest = { weekOf: '2026-11-15', budget: 150, cravings: ['chicken'], overrides: [], useItUp: false };

  it('states the rule for a week with no prep day, and only that one', () => {
    expect(plannerSystem({ prep: false, leftovers: false })).toContain("There is no prep day: every meal's steps must be self-contained — cook rice and other components within the meal, never refer to prepped or batch-cooked items.");
    expect(plannerSystem({ prep: true, leftovers: false })).not.toContain('There is no prep day');
  });

  it('allows prepped items in steps only when they are in prep, for a week with a prep day', () => {
    expect(plannerSystem({ prep: true, leftovers: false })).toContain('Steps may refer to prepped items only if they appear in `prep`.');
  });

  it('explains cravingDinners, and the vegetarian meal rule by its new name', () => {
    expect(SYSTEM_PROMPT).toContain("cravingDinners assigns dinners to ingredient cravings: make that craving a main ingredient of that day's dinner (other dinners may also use it).");
    expect(SYSTEM_PROMPT).toContain('One vegetarian meal a week');
  });

  it('sends cravingDinners in the payload only when there is an assignment', () => {
    const { cells, fixed } = expandWeek(household, request);
    const base = { household, request, cells, fixed, fixedCost: noFixed, available: [], recentDinnerNames: [] };
    expect(buildPayload(base)).not.toHaveProperty('cravingDinners');
    expect(buildPayload({ ...base, cravingDinners: {} })).not.toHaveProperty('cravingDinners');
    const assigned = buildPayload({ ...base, cravingDinners: { mon: 'chicken', thu: 'chicken' } });
    expect(assigned.cravingDinners).toEqual({ mon: 'chicken', thu: 'chicken' });
    expect(splitPayload(assigned).variable).toHaveProperty('cravingDinners');
  });
});
