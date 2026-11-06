import { describe, expect, it } from 'vitest';
import { REPEAT_STAPLE_IDS, MAX_MEALS_PER_INGREDIENT, repeatedMeals } from './repeats';
import { INGREDIENT_BY_ID } from './catalog';
import type { PlannedMeal } from './plan';
import type { Day, Slot } from './calendar';

function meal(day: Day, slot: Slot, ingredientIds: string[], extra: Partial<PlannedMeal> = {}): PlannedMeal {
  return {
    id: `${day}-${slot}`,
    day,
    slot,
    name: `${day} ${slot}`,
    eaters: ['ann'],
    ingredients: ingredientIds.map((id) => ({ ingredientId: id, qty: 0.2, unit: 'kg' as const })),
    activeMinutes: 10,
    steps: [],
    tags: [],
    ...extra,
  };
}

describe('repeatedMeals', () => {
  it('allows a non-staple in three meals and flags the fourth, in week order', () => {
    const meals = [
      meal('thu', 'dinner', ['green-cabbage']),
      meal('mon', 'dinner', ['green-cabbage']),
      meal('sun', 'dinner', ['green-cabbage']),
      meal('wed', 'dinner', ['green-cabbage']),
      meal('fri', 'lunch', ['green-cabbage']),
    ];
    const over = repeatedMeals(meals).get('green-cabbage');
    expect(MAX_MEALS_PER_INGREDIENT).toBe(3);
    expect(over?.map((m) => m.id)).toEqual(['thu-dinner', 'fri-lunch']);
  });

  it('never counts a staple, however many meals use it', () => {
    const meals = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => meal(d as Day, 'dinner', ['yellow-onion', 'garlic', 'eggs-large']));
    expect(repeatedMeals(meals).size).toBe(0);
    expect(REPEAT_STAPLE_IDS).toEqual(expect.arrayContaining(['yellow-onion', 'garlic', 'jasmine-rice', 'olive-oil', 'eggs-large', 'white-bread']));
  });

  it('does not count a meal that eats leftovers', () => {
    const meals = [
      meal('sun', 'dinner', ['carrots']),
      meal('mon', 'dinner', ['carrots']),
      meal('tue', 'dinner', ['carrots']),
      meal('wed', 'lunch', ['carrots'], { usesLeftoversFrom: 'sun-dinner' }),
    ];
    expect(repeatedMeals(meals).size).toBe(0);
  });

  it('counts each ingredient separately, so a second one is not over the limit', () => {
    const meals = [meal('sun', 'dinner', ['celery', 'kale']), meal('mon', 'dinner', ['celery', 'kale']), meal('tue', 'dinner', ['celery']), meal('wed', 'dinner', ['celery'])];
    expect([...repeatedMeals(meals).keys()]).toEqual(['celery']);
    expect(INGREDIENT_BY_ID['celery']).toBeDefined();
  });
});

describe('repeatedMeals with an exempt set', () => {
  it('does not count an ingredient in the exempt set at all', () => {
    const meals = [meal('mon', 'dinner', ['chicken-thigh-boneless']), meal('tue', 'dinner', ['chicken-thigh-boneless']), meal('wed', 'dinner', ['chicken-thigh-boneless']), meal('thu', 'dinner', ['chicken-thigh-boneless'])];
    expect(repeatedMeals(meals).has('chicken-thigh-boneless')).toBe(true);
    expect(repeatedMeals(meals, new Set(['chicken-thigh-boneless'])).size).toBe(0);
  });
});

