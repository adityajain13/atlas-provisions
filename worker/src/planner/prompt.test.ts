import { describe, expect, it } from 'vitest';
import { defaultHousehold, expandWeek, type Deal, type FixedCost, type PlanRequest, type Household } from '@provisions/shared';
import { buildAvailable, buildPayload, SYSTEM_PROMPT } from './prompt';

const noFixed: FixedCost = { cost: 0, listItems: [], macrosByPerson: {}, leftovers: [], needs: [], issues: [] };

function deal(ingredientId: string, score: number, staple = false): Deal {
  return { ingredientId, store: 'No Frills', pricePerUnit: 3, packQty: 1, packPrice: 3, discountPct: 0.2, baseline: 4, validTo: '2026-11-18', score, ...(staple ? { staple: true } : {}) };
}

describe('buildAvailable', () => {
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

describe('buildPayload', () => {
  const household: Household = {
    ...defaultHousehold(),
    people: [
      { id: 'ann', name: 'Ann', dietTags: ['vegetarian'], allergies: ['dairy'], proteinTargetG: 80 },
      { id: 'ben', name: 'Ben', dietTags: [], allergies: [] },
    ],
  };
  const request: PlanRequest = { weekOf: '2026-11-12', budget: 150, cravings: ['tacos'], overrides: [], useItUp: true };

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
    expect(payload.slots[0]).toEqual({ id: 'thu-breakfast', day: 'thu', slot: 'breakfast', eaters: ['ann', 'ben'] });
    expect(payload.allergies).toEqual({ ann: ['dairy'], ben: [] });
    expect(payload.remainingBudget).toBe(130);
    expect(payload.people[0]).toMatchObject({ id: 'ann', proteinTargetG: 80 });
    expect(payload.feedback).toBeNull();
    expect(payload.neverBuy).toEqual(['cheddar']);
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

  it('system prompt asks for the submit_plan tool and the no-prices rule', () => {
    expect(SYSTEM_PROMPT).toContain('submit_plan');
    expect(SYSTEM_PROMPT).toContain('Do not estimate prices');
  });
});
