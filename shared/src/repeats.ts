// Variety across the week: a non-staple ingredient may appear in at most MAX_MEALS_PER_INGREDIENT meals. Without this,
// one big pack (a whole cabbage) spreads across five or six meals. Staples are exempt: they are used everywhere by design.
import { DAYS, SLOTS } from './calendar';
import type { PlannedMeal } from './plan';

export const MAX_MEALS_PER_INGREDIENT = 3;

/** Ingredients the repeat rule does not count: pantry staples used across many meals. By catalogue id. */
export const REPEAT_STAPLE_IDS: readonly string[] = [
  // Onions and garlic
  'yellow-onion',
  'red-onion',
  'garlic',
  'garlic-powder',
  // Rice, all kinds
  'basmati-rice',
  'jasmine-rice',
  'brown-rice',
  // Oils, fats, flour, sugar
  'olive-oil',
  'vegetable-oil',
  'butter',
  'all-purpose-flour',
  'sugar',
  // Spices
  'ground-cumin',
  'smoked-paprika',
  'cinnamon',
  'curry-powder',
  // Stock, sauce and dairy and eggs
  'chicken-stock',
  'vegetable-stock',
  'soy-sauce',
  'milk-2-percent',
  'eggs-large',
  // Bread
  'white-bread',
  'whole-wheat-bread',
];

const STAPLES = new Set(REPEAT_STAPLE_IDS);

/**
 * The meals beyond the limit, for each non-staple ingredient. Meals are counted in week order, and a meal that eats
 * leftovers (usesLeftoversFrom) is not counted: it reuses a meal's food rather than buying more. The first
 * MAX_MEALS_PER_INGREDIENT meals keep the ingredient; each later one is returned, keyed by ingredient id.
 */
export function repeatedMeals(meals: PlannedMeal[]): Map<string, PlannedMeal[]> {
  const ordered = [...meals].sort(
    (a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot),
  );
  const seen = new Map<string, number>();
  const over = new Map<string, PlannedMeal[]>();
  for (const meal of ordered) {
    if (meal.usesLeftoversFrom !== undefined) continue;
    const ids = new Set(meal.ingredients.map((i) => i.ingredientId));
    for (const id of ids) {
      if (STAPLES.has(id)) continue;
      const n = (seen.get(id) ?? 0) + 1;
      seen.set(id, n);
      if (n > MAX_MEALS_PER_INGREDIENT) over.set(id, [...(over.get(id) ?? []), meal]);
    }
  }
  return over;
}
