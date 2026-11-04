import { describe, expect, it } from 'vitest';
import type { ListItem, MealPlan } from '@provisions/shared';
import { defaultDay, planToList } from './planView';

describe('defaultDay', () => {
  it('opens on today when today is inside the plan week (Sun to Sat)', () => {
    expect(defaultDay('2026-11-01', '2026-11-01')).toBe('sun');
    expect(defaultDay('2026-11-01', '2026-11-03')).toBe('tue');
    expect(defaultDay('2026-11-01', '2026-11-07')).toBe('sat');
  });

  it('opens on Sunday when today is outside the plan week', () => {
    expect(defaultDay('2026-11-01', '2026-11-08')).toBe('sun');
    expect(defaultDay('2026-11-01', '2026-10-31')).toBe('sun');
  });
});

function plan(list: ListItem[], stores: string[]): MealPlan {
  return {
    weekOf: '2026-11-01',
    stores,
    list,
    meals: [],
    fixedMeals: [],
  } as unknown as MealPlan;
}

const priced: ListItem = {
  ingredientId: 'broccoli',
  name: 'Broccoli',
  category: 'produce',
  store: 'No Frills',
  packs: 2,
  packQty: 1,
  packPrice: 2.5,
  total: 5,
  usedIn: [],
};

const unpriced: ListItem = {
  ingredientId: 'baby-carrots',
  name: 'Baby carrots',
  category: 'produce',
  store: 'Unpriced',
  packs: 0,
  packQty: 0,
  packPrice: 0,
  total: 0,
  usedIn: [],
  needed: 0.4,
};

describe('planToList', () => {
  it('never lists Unpriced as a store', () => {
    const view = planToList(plan([priced, unpriced], ['No Frills', 'Unpriced']));
    expect(view.stores).toEqual(['No Frills']);
  });

  it('keeps unpriced items, with the quantity the plan needs and no price shown as a store', () => {
    const view = planToList(plan([priced, unpriced], ['No Frills']));
    const row = view.items.find((i) => i.id === 'baby-carrots');
    expect(row).toMatchObject({ store: 'Unpriced', qty: '400 g' });
  });

  it('shows the pack count for a priced item', () => {
    const view = planToList(plan([priced], ['No Frills']));
    expect(view.items[0]).toMatchObject({ store: 'No Frills', qty: '2 × 1 kg', price: 5 });
  });
});
