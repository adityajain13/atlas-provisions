import { describe, expect, it } from 'vitest';
import { costFixedMeals } from './fixed';
import { defaultHousehold, type Household, type FixedMeal } from './index';
import type { FixedPlacement } from './grid';
import type { Deal } from './scoring';
import type { MatchedItem } from './match';

const people = [
  { id: 'ann', name: 'Ann', dietTags: [], allergies: [] },
  { id: 'ben', name: 'Ben', dietTags: [], allergies: [] },
];

function household(fixedMeals: FixedMeal[]): Household {
  const h = defaultHousehold();
  // Enable No Frills only, so store filtering is exercised.
  h.stores = h.stores.map((s) => ({ ...s, enabled: s.name === 'No Frills' }));
  return { ...h, people, fixedMeals };
}

function matched(ingredientId: string, store: string, pricePerUnit: number, packQty: number): MatchedItem {
  return {
    id: `${ingredientId}-${store}`,
    store,
    rawName: ingredientId,
    priceText: '',
    validFrom: '2026-11-12',
    validTo: '2026-11-18',
    source: 'fixture',
    ingredientId,
    confidence: 0.9,
    packQty,
    pricePerUnit,
    packPrice: pricePerUnit * packQty,
  };
}

const yogurtMeal: FixedMeal = {
  id: 'yogurt',
  name: 'Yogurt and granola',
  personIds: ['ann', 'ben'],
  days: ['thu', 'fri'],
  slot: 'breakfast',
  ingredients: [{ name: 'Greek yogurt', qty: 150, unit: 'g' }],
  active: true,
};

const placements: FixedPlacement[] = [
  { id: 'yogurt@thu-breakfast', fixedMealId: 'yogurt', day: 'thu', slot: 'breakfast', eaters: ['ann', 'ben'] },
  { id: 'yogurt@fri-breakfast', fixedMealId: 'yogurt', day: 'fri', slot: 'breakfast', eaters: ['ann', 'ben'] },
];

describe('costFixedMeals', () => {
  it('sums quantity over person-servings, converts grams to kg and rounds packs up', () => {
    // 150 g x 4 servings = 0.6 kg. A 1 kg pack at $5 covers it.
    const m = [matched('greek-yogurt', 'No Frills', 5, 1)];
    const r = costFixedMeals(placements, household([yogurtMeal]), [], m);
    expect(r.needs).toEqual([{ ingredientId: 'greek-yogurt', qty: expect.closeTo(0.6, 9), usedIn: ['yogurt@thu-breakfast', 'yogurt@fri-breakfast'] }]);
    expect(r.cost).toBe(5);
    expect(r.listItems[0]).toMatchObject({ ingredientId: 'greek-yogurt', store: 'No Frills', packs: 1 });
    expect(r.leftovers[0]!.qty).toBeCloseTo(0.4, 9);
  });

  it('counts only enabled stores when pricing', () => {
    const m = [matched('greek-yogurt', 'Walmart', 1, 1), matched('greek-yogurt', 'No Frills', 4, 1)];
    const r = costFixedMeals(placements, household([yogurtMeal]), [], m);
    expect(r.listItems[0]!.store).toBe('No Frills');
  });

  it('sums macros per person across placements', () => {
    const r = costFixedMeals(placements, household([yogurtMeal]), [], [matched('greek-yogurt', 'No Frills', 5, 1)]);
    // 150 g of Greek yogurt at 9.0 g protein per 100 g is 13.5 g a serving, and there are two servings.
    expect(r.macrosByPerson.ann!.protein).toBeCloseTo(27, 6);
    expect(r.macrosByPerson.ben!.protein).toBeCloseTo(27, 6);
  });

  it('warns and costs nothing for an ingredient that is not in the catalogue', () => {
    const meal: FixedMeal = { ...yogurtMeal, ingredients: [{ name: 'Mystery sauce', qty: 50, unit: 'ml' }] };
    const r = costFixedMeals(placements, household([meal]), [], []);
    expect(r.cost).toBe(0);
    expect(r.listItems).toEqual([]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ check: 'unknown-ingredient', severity: 'warning' });
    expect(r.issues[0]!.message).toContain('Mystery sauce');
  });

  it('warns when the units cannot be converted, such as grams of an each item', () => {
    const meal: FixedMeal = { ...yogurtMeal, ingredients: [{ name: 'Large eggs', qty: 100, unit: 'g' }] };
    const r = costFixedMeals([placements[0]!], household([meal]), [], [matched('eggs-large', 'No Frills', 0.4, 12)]);
    expect(r.cost).toBe(0);
    expect(r.issues[0]!.message).toContain('cannot be converted');
  });

  it('keeps the need for an unpriced ingredient and warns', () => {
    const r = costFixedMeals(placements, household([yogurtMeal]), [] as Deal[], []);
    expect(r.cost).toBe(0);
    expect(r.needs).toHaveLength(1);
    expect(r.issues.some((i) => i.message.includes('No enabled store sells'))).toBe(true);
  });
});

describe('costFixedMeals: ingredients not in the catalogue', () => {
  const customMeal: FixedMeal = {
    ...yogurtMeal,
    ingredients: [{ name: 'Fruit cup', qty: 250, unit: 'g' }],
  };

  it('returns them as customNeeds, summed over placements and eaters, without a cost', () => {
    const r = costFixedMeals(placements, household([customMeal]), [], []);
    expect(r.cost).toBe(0);
    expect(r.listItems).toEqual([]);
    expect(r.customNeeds).toEqual([
      { name: 'Fruit cup', qty: 1000, unit: 'g', usedIn: ['yogurt@thu-breakfast', 'yogurt@fri-breakfast'] },
    ]);
  });

  it('sums lowercase name and unit together, and keeps different units apart', () => {
    const meal: FixedMeal = {
      ...yogurtMeal,
      personIds: ['ann'],
      ingredients: [
        { name: 'Fruit cup', qty: 100, unit: 'g' },
        { name: 'fruit CUP', qty: 1, unit: 'kg' },
        { name: 'fruit cup', qty: 50, unit: 'g' },
      ],
    };
    const one: FixedPlacement[] = [placements[0]!];
    const r = costFixedMeals(one, household([meal]), [], []);
    expect(r.customNeeds).toEqual([
      { name: 'Fruit cup', qty: 300, unit: 'g', usedIn: ['yogurt@thu-breakfast'] },
      { name: 'fruit CUP', qty: 2, unit: 'kg', usedIn: ['yogurt@thu-breakfast'] },
    ]);
  });

  it('warns with the plain-language message and still names the item', () => {
    const r = costFixedMeals(placements, household([customMeal]), [], []);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ check: 'unknown-ingredient', severity: 'warning' });
    expect(r.issues[0]!.message).toBe(`"Fruit cup" isn't in the catalogue, so it's on the list without a price.`);
  });

  it('does not list a custom item that has no quantity', () => {
    const meal: FixedMeal = { ...yogurtMeal, ingredients: [{ name: 'Fruit cup', qty: 0, unit: 'g' }] };
    const r = costFixedMeals(placements, household([meal]), [], []);
    expect(r.customNeeds).toEqual([]);
  });

  it('leaves catalogue ingredients out of customNeeds', () => {
    const r = costFixedMeals(placements, household([yogurtMeal]), [], [matched('greek-yogurt', 'No Frills', 5, 1)]);
    expect(r.customNeeds).toEqual([]);
  });
});
