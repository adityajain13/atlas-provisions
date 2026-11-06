import { describe, expect, it } from 'vitest';
import type { ListItem, MealPlan, PlannedMeal } from '@provisions/shared';
import { defaultDay, planToList, planToWeek } from './planView';

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
    expect(view.items[0]).toMatchObject({ store: 'No Frills', qty: '2 × 1 kg · $2.50 each', price: 5 });
  });
});

describe('planToList: cheapest elsewhere', () => {
  it('shows the cheapest enabled store for an item outside the chosen stores', () => {
    const item: ListItem = {
      ingredientId: 'garlic',
      name: 'Garlic',
      category: 'produce',
      store: 'Unpriced',
      packs: 0,
      packQty: 0,
      packPrice: 0,
      total: 0,
      usedIn: [],
      needed: 0.1,
      cheapestElsewhere: { store: "Longo's", price: 4.99 },
    };
    const view = planToList(plan([item], ['No Frills']));
    expect(view.items[0]!.elsewhere).toBe("Cheapest at Longo's: $4.99");
  });
});

function meal(name: string, slot: 'breakfast' | 'lunch' | 'dinner', tags: string[], usesLeftoversFrom?: string): PlannedMeal {
  return {
    id: `sun-${slot}`,
    day: 'sun',
    slot,
    name,
    eaters: [],
    ingredients: [],
    activeMinutes: 10,
    steps: [],
    tags,
    ...(usesLeftoversFrom ? { usesLeftoversFrom } : {}),
  } as PlannedMeal;
}

function weekWith(meals: PlannedMeal[], cravings: string[] = []) {
  const p = {
    weekOf: '2026-11-01',
    request: { weekOf: '2026-11-01', budget: 150, cravings },
    stores: [],
    list: [],
    meals,
    fixedMeals: [],
    totalCost: 0,
  } as unknown as MealPlan;
  return planToWeek(p, new Map());
}

describe('planToWeek: tags and headline', () => {
  it('drops tags that only repeat the slot name, case-insensitively', () => {
    const week = weekWith([meal('Oat bake', 'breakfast', ['Breakfast', 'quick'])]);
    expect(week.days[0]!.meals[0]!.tags.map((t) => t.text)).toEqual(['Quick']);
  });

  it('shows no Leftovers pill on a leftover meal: its own line says so', () => {
    const week = weekWith([meal('Chili', 'dinner', ['leftovers', 'quick'], 'sun-lunch')]);
    expect(week.days[0]!.meals[0]!.tags.map((t) => t.text)).toEqual(['Quick']);
  });

  it('marks a meal tagged Leftovers as a leftover meal even without a source', () => {
    const week = weekWith([meal('Chili', 'dinner', ['Leftovers'])]);
    expect(week.days[0]!.meals[0]!.leftover).toEqual({ from: null });
    expect(week.days[0]!.meals[0]!.tags).toEqual([]);
  });

  it('names the source meal and the meals that eat its leftovers', () => {
    const source = { ...meal('Chili', 'dinner', []), id: 'mon-dinner', day: 'mon', makesLeftoversFor: 'tue-lunch' } as PlannedMeal;
    const leftover = { ...meal('Chili lunch', 'lunch', []), id: 'tue-lunch', day: 'tue', usesLeftoversFrom: 'mon-dinner' } as PlannedMeal;
    const week = weekWith([source, leftover]);
    const mon = week.days.find((d) => d.key === 'mon')!.meals[0]!;
    const tue = week.days.find((d) => d.key === 'tue')!.meals[0]!;
    expect(mon.makes).toEqual([{ id: 'tue-lunch', label: 'Tue lunch' }]);
    expect(tue.leftover).toEqual({ from: { id: 'mon-dinner', label: 'Mon dinner' } });
    expect(tue.makes).toBeUndefined();
  });

  it('shows each pill once', () => {
    const week = weekWith([meal('Chili', 'dinner', ['quick', 'Quick'])]);
    expect(week.days[0]!.meals[0]!.tags.map((t) => t.text)).toEqual(['Quick']);
  });

  it('takes the headline from the dinner name without its portion note', () => {
    const week = weekWith([meal('Pepperoni potato frittata (2 portions)', 'dinner', [])]);
    expect(week.days[0]!.headline).toBe('pepperoni potato frittata.');
  });
});

describe('planToWeek: meal statuses', () => {
  const source = { ...meal('Chili', 'dinner', []), id: 'mon-dinner', day: 'mon', makesLeftoversFor: 'tue-lunch' } as PlannedMeal;
  const leftover = { ...meal('Chili lunch', 'lunch', []), id: 'tue-lunch', day: 'tue', usesLeftoversFrom: 'mon-dinner' } as PlannedMeal;

  function weekFor(statuses: Parameters<typeof planToWeek>[2]) {
    const p = { weekOf: '2026-11-01', request: { weekOf: '2026-11-01', budget: 150, cravings: [] }, stores: [], list: [], meals: [source, leftover], fixedMeals: [], totalCost: 0 } as unknown as MealPlan;
    return planToWeek(p, new Map(), statuses);
  }

  it('attaches a meal’s mark to its card', () => {
    const mon = weekFor({ 'mon-dinner': { status: 'skipped', reason: 'ate-out' } }).days[1]!.meals[0]!;
    expect(mon.status).toEqual({ status: 'skipped', reason: 'ate-out' });
  });

  it('leaves the card without a mark when nothing is marked', () => {
    expect(weekFor({}).days[1]!.meals[0]!.status).toBeUndefined();
  });

  it('marks the leftover link as skipped when its source was skipped and the leftover has not been dealt with', () => {
    const tue = weekFor({ 'mon-dinner': { status: 'skipped' } }).days[2]!.meals[0]!;
    expect(tue.leftover?.from).toEqual({ id: 'mon-dinner', label: 'Mon dinner', skipped: true });
  });

  it('leaves the link plain once the leftover meal has its own mark (kept, or made instead)', () => {
    const tue = weekFor({ 'mon-dinner': { status: 'skipped' }, 'tue-lunch': { status: 'replaced' } }).days[2]!.meals[0]!;
    expect(tue.leftover?.from).toEqual({ id: 'mon-dinner', label: 'Mon dinner' });
  });

  it('leaves the link plain when the source was not skipped', () => {
    const tue = weekFor({ 'mon-dinner': { status: 'replaced', madeName: 'Soup' } }).days[2]!.meals[0]!;
    expect(tue.leftover?.from).toEqual({ id: 'mon-dinner', label: 'Mon dinner' });
  });
});
