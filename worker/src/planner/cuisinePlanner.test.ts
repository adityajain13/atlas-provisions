import { describe, expect, it } from 'vitest';
import { CUISINES, defaultHousehold, expandWeek, INGREDIENT_BY_ID, type Household, type PlanRequest, type PlannedMeal, type Store } from '@provisions/shared';
import { buildPayload, SYSTEM_PROMPT } from './prompt';
import { evaluateWeek, REGULAR_LIMIT, weekFrame } from './run';

const request: PlanRequest = { weekOf: '2026-11-15', budget: 150, cravings: [], overrides: [], useItUp: false };
const store: Store = { id: 'loblaws', name: 'Loblaws', enabled: true, priceMatches: false, group: 'Loblaw' };

function household(patch: Partial<Household> = {}): Household {
  return { ...defaultHousehold(), stores: [store], ...patch };
}

function frame(h: Household, neverBuy: string[] = []) {
  return weekFrame({ household: h, request, deals: [], matched: [], neverBuy, recentDinnerNames: [], today: '2026-11-15' });
}

describe('weekFrame: on-hand staples and regular items', () => {
  it('offers the kept staples as free on-hand items', () => {
    const out = frame(household()).available;
    for (const id of household().onHand) {
      expect(out.find((a) => a.id === id), id).toMatchObject({ source: 'on-hand' });
    }
  });

  it('offers regular items from the cuisines the household eats, priced at the typical price, capped', () => {
    const out = frame(household()).available;
    const regular = out.filter((a) => a.source === 'regular');
    expect(regular.length).toBeGreaterThan(0);
    expect(regular.length).toBeLessThanOrEqual(REGULAR_LIMIT);
    expect(regular.every((a) => a.estimate?.basis === 'typical')).toBe(true);
    expect(regular.some((a) => a.id === 'paneer')).toBe(true);
  });

  it('offers no regular items when every cuisine is never eaten', () => {
    const levels = Object.fromEntries(CUISINES.map((c) => [c.key, 'never' as const]));
    const out = frame(household({ cuisines: levels })).available;
    expect(out.filter((a) => a.source === 'regular')).toEqual([]);
  });

  it('leaves out never-buy items from both on-hand and regular offers', () => {
    const h = household({ onHand: ['soy-sauce', 'ground-cumin'] });
    const out = frame(h, ['soy-sauce', 'paneer']).available;
    expect(out.some((a) => a.id === 'soy-sauce')).toBe(false);
    expect(out.some((a) => a.id === 'ground-cumin')).toBe(true);
    expect(out.some((a) => a.id === 'paneer')).toBe(false);
  });

  it('leaves out ingredients that carry an allergen the household has', () => {
    const h = household({
      people: [{ id: 'ann', name: 'Ann', dietTags: [], allergies: ['dairy'] }],
    });
    const out = frame(h).available;
    expect(out.some((a) => a.id === 'paneer')).toBe(false);
    expect(out.some((a) => a.id === 'ghee')).toBe(false);
  });
});

describe('evaluateWeek: on-hand items are free and never listed', () => {
  it('keeps a kept staple off the list and lists the regular item at its typical price', () => {
    const h = household();
    const meal: PlannedMeal = {
      id: 'm1',
      day: 'mon',
      slot: 'dinner',
      name: 'Spiced paneer',
      eaters: ['ann'],
      ingredients: [
        { ingredientId: 'ground-cumin', qty: 0.005, unit: 'kg' },
        { ingredientId: 'paneer', qty: 0.25, unit: 'kg' },
      ],
      activeMinutes: 20,
      steps: [],
      tags: [],
    };
    const plan = evaluateWeek(frame(h), [meal], [], '');
    const ids = plan.list.map((i) => i.ingredientId);
    expect(ids).not.toContain('ground-cumin');
    const paneer = plan.list.find((i) => i.ingredientId === 'paneer')!;
    expect(paneer).toMatchObject({ store: 'Loblaws', estimate: { basis: 'typical' } });
    expect(paneer.estimate?.date).toBeUndefined();
  });
});

describe('planner payload and prompt', () => {
  it('sends the cuisine mix from the household ranking', () => {
    const h = household({ cuisines: { ...defaultHousehold().cuisines, thai: 'often' } });
    const { cells, fixed } = expandWeek(h, request);
    const payload = buildPayload({
      household: h,
      request,
      cells,
      fixed,
      fixedCost: { cost: 0, listItems: [], macrosByPerson: {}, leftovers: [], needs: [], issues: [] },
      available: frame(h).available,
      recentDinnerNames: [],
    });
    expect(payload.cuisineMix.often).toEqual(expect.arrayContaining(['indian', 'indonesian', 'hakka', 'italian', 'thai']));
    expect(payload.cuisineMix.never).toEqual([]);
    expect(payload.available.some((a) => a.source === 'regular')).toBe(true);
  });

  it('tells the planner the cuisine rule, the regular and on-hand sources, and that only salt, pepper, oil and water are assumed', () => {
    expect(SYSTEM_PROMPT).toContain("Plan dinners as authentic home-style dishes from the cuisines in cuisineMix: roughly half from 'often', most of the rest from 'sometimes', at most one from 'rarely', none from 'never'. No cuisine more than 3 dinners a week. Label each meal with its cuisine in `cuisine`.");
    expect(SYSTEM_PROMPT).toContain('Prefer deals; use regular items when a dish needs them.');
    expect(SYSTEM_PROMPT).toContain('Only salt, pepper, oil and water are assumed. ');
    expect(SYSTEM_PROMPT).toContain('which holds everything the household may buy or use');
    expect(SYSTEM_PROMPT).not.toContain('common dried spices are assumed on hand');
  });

  it('a catalogue id in a household staple list is a real ingredient', () => {
    for (const id of defaultHousehold().onHand) expect(INGREDIENT_BY_ID[id]).toBeDefined();
  });
});
