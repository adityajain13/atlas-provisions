import { describe, expect, it } from 'vitest';
import type { ListItem, MealPlan, PlannedMeal } from '@provisions/shared';
import { estimateCaption, planToList, planToWeek, priceLabel } from './planView';

function meal(patch: Partial<PlannedMeal>): PlannedMeal {
  return {
    id: 'mon-dinner',
    day: 'mon',
    slot: 'dinner',
    name: 'Green curry',
    eaters: [],
    ingredients: [],
    activeMinutes: 25,
    steps: [],
    tags: [],
    ...patch,
  };
}

function plan(meals: PlannedMeal[], list: ListItem[] = []): MealPlan {
  return {
    weekOf: '2026-11-15',
    stores: ['Loblaws'],
    list,
    meals,
    fixedMeals: [],
    request: { weekOf: '2026-11-15', budget: 150, cravings: [], overrides: [], useItUp: false },
    totalCost: 0,
    fixedCost: 0,
    issues: [],
    attempts: 1,
    generatedAt: '2026-11-06T00:00:00Z',
    notes: '',
  } as unknown as MealPlan;
}

describe('planToWeek: the cuisine tag', () => {
  it('shows the cuisine label as a pill on a dinner', () => {
    const week = planToWeek(plan([meal({ cuisine: 'thai' })]), new Map());
    const dinner = week.days.flatMap((d) => d.meals).find((m) => m.slot === 'dinner')!;
    expect(dinner.tags).toEqual([{ kind: 'cuisine', text: 'Thai' }]);
  });

  it('shows no cuisine pill for a meal with no cuisine', () => {
    const week = planToWeek(plan([meal({})]), new Map());
    const dinner = week.days.flatMap((d) => d.meals).find((m) => m.slot === 'dinner')!;
    expect(dinner.tags.some((t) => t.kind === 'cuisine')).toBe(false);
  });
});

describe('estimated prices', () => {
  it('labels a typical price with a tilde and "typical price"', () => {
    const item: ListItem = {
      ingredientId: 'paneer',
      name: 'Paneer',
      category: 'dairy',
      store: 'Loblaws',
      packs: 1,
      packQty: 0.1,
      packPrice: 1.699,
      total: 1.7,
      usedIn: [],
      estimate: { basis: 'typical' },
    };
    const view = planToList(plan([], [item]));
    const shown = view.items[0]!;
    expect(priceLabel(shown.price, shown.estimate)).toBe('~$1.70');
    expect(estimateCaption(shown.estimate, shown.store)).toBe('typical price');
  });

  it('keeps flyer prices plain and captions nothing for them', () => {
    expect(priceLabel(3.49, undefined)).toBe('$3.49');
    expect(estimateCaption(undefined, 'Loblaws')).toBeUndefined();
  });

  it('captions a site price with its store and a receipt price with its date, and tildes only the receipt', () => {
    expect(estimateCaption({ basis: 'site', date: '2026-11-01' }, 'Loblaws')).toBe('regular price at Loblaws');
    expect(priceLabel(4, { basis: 'site' })).toBe('$4.00');
    expect(priceLabel(4, { basis: 'receipt' })).toBe('~$4.00');
    expect(estimateCaption({ basis: 'receipt', date: '2026-10-28' }, 'Loblaws')).toMatch(/^last paid /);
  });
});
