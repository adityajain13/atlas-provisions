import { describe, expect, it } from 'vitest';
import type { ListItem, MealPlan } from '@provisions/shared';
import { monthDay, planToList } from './planView';

function planOf(list: ListItem[]): MealPlan {
  return {
    weekOf: '2026-11-15',
    request: { weekOf: '2026-11-15', budget: 150, cravings: [], overrides: [], useItUp: false },
    meals: [],
    fixedMeals: [],
    list,
    stores: [...new Set(list.map((i) => i.store))],
    totalCost: list.reduce((s, i) => s + i.total, 0),
    fixedCost: 0,
    issues: [],
    attempts: 0,
    generatedAt: '2026-11-05T00:00:00Z',
    notes: '',
  };
}

const tuna = (over: Partial<ListItem> = {}): ListItem => ({
  ingredientId: 'canned-tuna',
  name: 'Canned tuna (light, in water)',
  category: 'seafood',
  store: 'Loblaws',
  packs: 2,
  packQty: 1,
  packPrice: 2.39,
  total: 4.78,
  usedIn: ['m1'],
  ...over,
});

describe('planToList: quantity labels', () => {
  it('says how many cans, and the price of one, for a catalogue item sold each', () => {
    const [item] = planToList(planOf([tuna()])).items;
    expect(item).toMatchObject({ qty: '2 cans · $2.39 each', price: 4.78 });
    expect(item!.estimate).toBeUndefined();
    expect(item!.pinnedTo).toBeUndefined();
  });
});

describe('planToList: receipt estimates', () => {
  it('carries the date of the receipt on an estimated item', () => {
    const [item] = planToList(planOf([tuna({ estimate: { basis: 'receipt', date: '2026-10-28' } })])).items;
    expect(item!.estimate).toEqual({ date: '2026-10-28' });
  });

  it('formats the date for the list note', () => {
    expect(monthDay('2026-10-28')).toBe('Oct 28');
    expect(monthDay('2026-01-05')).toBe('Jan 5');
  });
});

describe('planToList: pins', () => {
  it('names the store a pinned item is bought at', () => {
    const [item] = planToList(planOf([tuna({ pinned: true })])).items;
    expect(item!.pinnedTo).toBe('Loblaws');
  });

  it('shows the needed quantity in its noun, not packs, for an item with no price at its pinned store', () => {
    const [item] = planToList(
      planOf([tuna({ store: 'Costco', packs: 0, packQty: 0, packPrice: 0, total: 0, needed: 2, pinned: true, priceUnknown: true })]),
    ).items;
    expect(item).toMatchObject({ store: 'Costco', qty: '2 cans', price: 0, priceUnknown: true, pinnedTo: 'Costco' });
  });
});
