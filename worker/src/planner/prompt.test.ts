import { describe, expect, it } from 'vitest';
import { defaultHousehold, expandWeek, INGREDIENT_BY_ID, type Deal, type FixedCost, type PlanRequest, type Household } from '@provisions/shared';
import { buildAvailable, buildPayload, eachMeansFor, SUBMIT_PLAN_TOOL, SYSTEM_PROMPT } from './prompt';

const noFixed: FixedCost = { cost: 0, listItems: [], macrosByPerson: {}, leftovers: [], needs: [], issues: [] };

function deal(ingredientId: string, score: number, staple = false): Deal {
  return { ingredientId, store: 'No Frills', pricePerUnit: 3, packQty: 1, packPrice: 3, discountPct: 0.2, baseline: 4, validTo: '2026-11-18', score, ...(staple ? { staple: true } : {}) };
}

describe('buildAvailable', () => {
  it('gives each available item its ingredient shelf life, for the prep rules', () => {
    const out = buildAvailable([deal('broccoli', 0.5)], noFixed, [
      { id: 'p1', ingredientId: 'greek-yogurt', qty: 0.4, unit: INGREDIENT_BY_ID['greek-yogurt']!.baseUnit, addedOn: '2026-11-10', expiresOn: '2026-11-13', source: 'manual' as const },
    ]);
    const shelf = (id: string) => out.find((a) => a.id === id)?.shelfLifeDays;
    expect(shelf('broccoli')).toBe(INGREDIENT_BY_ID['broccoli']!.shelfLifeDays);
    expect(shelf('greek-yogurt')).toBe(INGREDIENT_BY_ID['greek-yogurt']!.shelfLifeDays);
  });

  it('keeps the best-scoring entry per ingredient and marks staples', () => {
    const out = buildAvailable([deal('broccoli', 0.2), deal('broccoli', 0.5), deal('butter', 0.1, true)], noFixed);
    expect(out.find((a) => a.id === 'broccoli')).toMatchObject({ source: 'deal', score: 0.5 });
    expect(out.find((a) => a.id === 'butter')).toMatchObject({ source: 'staple' });
  });

  it('adds fixed-meal leftovers that no deal covers', () => {
    const fixed: FixedCost = { ...noFixed, leftovers: [{ ingredientId: 'greek-yogurt', qty: 0.4 }] };
    const out = buildAvailable([], fixed);
    expect(out).toEqual([expect.objectContaining({ id: 'greek-yogurt', source: 'fixed-leftover', packQty: 0.4 })]);
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
    const payload = buildPayload({ household, request, cells, fixed, fixedCost: noFixed, available, neverBuy: [], recentDinnerNames: [] });
    expect(payload.available.find((a) => a.id === 'white-bread')?.eachMeans).toBe('1 = one loaf as sold (~675 g)');
    expect(SYSTEM_PROMPT).toContain('never slices or servings');
    expect(SYSTEM_PROMPT).toContain('two people having toast all week is 1 loaf, not 7');
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

  it('builds slots, allergies and the remaining budget after fixed meals', () => {
    const { cells, fixed } = expandWeek(household, request);
    const payload = buildPayload({
      household,
      request,
      cells,
      fixed,
      fixedCost: { ...noFixed, cost: 20 },
      available: [],
      neverBuy: ['cheddar'],
      recentDinnerNames: [],
    });
    expect(payload.slots).toHaveLength(21);
    expect(payload.slots[0]).toEqual({ id: 'sun-breakfast', day: 'sun', slot: 'breakfast', eaters: ['ann', 'ben'] });
    expect(payload.allergies).toEqual({ ann: ['dairy'], ben: [] });
    expect(payload.remainingBudget).toBe(130);
    expect(payload.people[0]).toMatchObject({ id: 'ann', proteinTargetG: 80 });
    expect(payload.feedback).toBeNull();
    expect(payload.neverBuy).toEqual(['cheddar']);
    expect(payload.prepDay).toBe('sun');
  });

  it('fills useFirst from fixed-meal leftovers only when use-it-up is on, and avoid only with the 14-day rule', () => {
    const { cells, fixed } = expandWeek(household, request);
    const available = buildAvailable([], { ...noFixed, leftovers: [{ ingredientId: 'greek-yogurt', qty: 0.4 }] });
    const on = buildPayload({ household, request, cells, fixed, fixedCost: noFixed, available, neverBuy: [], recentDinnerNames: ['Chili'] });
    expect(on.useFirst).toEqual(['greek-yogurt']);
    expect(on.avoid).toEqual([]);

    const ruleOn: Household = { ...household, varietyRules: { ...household.varietyRules, noRepeatDinner14: true } };
    const off = buildPayload({ household, request: { ...request, useItUp: false }, cells, fixed, fixedCost: noFixed, available, neverBuy: [], recentDinnerNames: ['Chili'] });
    expect(off.useFirst).toEqual([]);
    const withRule = buildPayload({ household: ruleOn, request, cells, fixed, fixedCost: noFixed, available, neverBuy: [], recentDinnerNames: ['Chili'] });
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
      neverBuy: [],
      recentDinnerNames: ['Chili'],
      pantryUseFirst: ['spinach'],
      favourites: ['Tacos'],
      avoid: ['Fish', 'Chili'],
    });
    expect(payload.useFirst).toEqual(['spinach']);
    expect(payload.favourites).toEqual(['Tacos']);
    expect(payload.avoid).toEqual(['Fish', 'Chili']); // the 14-day rule is off here, so recent dinners are not added
  });

  it('system prompt has the prep rules, and says to omit prep without a prep day', () => {
    expect(SYSTEM_PROMPT).toContain('If `prepDay` is null, omit `prep`.');
    expect(SYSTEM_PROMPT).toContain('shelfLifeDays');
    expect(SYSTEM_PROMPT).toContain('forMeals');
    expect(SYSTEM_PROMPT).toContain('90 minutes');
  });

  it('submit_plan takes an optional prep list whose steps link to meal ids', () => {
    const schema = SUBMIT_PLAN_TOOL.input_schema;
    expect(schema.required).toEqual(['meals', 'notes']);
    const prep = schema.properties.prep;
    expect(prep.required).toEqual(['day', 'steps']);
    expect(prep.properties.steps.items.required).toEqual(['id', 'task', 'minutes', 'forMeals']);
    expect(prep.properties.steps.items.properties.forMeals.type).toBe('array');
  });

  it('system prompt asks for the submit_plan tool and the no-prices rule', () => {
    expect(SYSTEM_PROMPT).toContain('submit_plan');
    expect(SYSTEM_PROMPT).toContain('Do not estimate prices');
  });
});
