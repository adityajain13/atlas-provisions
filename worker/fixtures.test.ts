import { describe, expect, it } from 'vitest';
import { matchFlyerItem, type FlyerItem } from '@provisions/shared';
import flyer from './fixtures/flyer-sample.json';

const items = flyer as FlyerItem[];

// Known non-food lines in the fixture. These must not match anything.
const NON_FOOD = ['Tide Pods 81 ct', 'Doritos Nacho Cheese'];

describe('flyer fixture', () => {
  const foodItems = items.filter((i) => !NON_FOOD.includes(i.rawName));
  const matched = foodItems.filter((i) => matchFlyerItem(i) !== null);

  it('has about 80 items across the four stores, all from the fixture source', () => {
    expect(items.length).toBeGreaterThanOrEqual(75);
    expect(new Set(items.map((i) => i.store))).toEqual(new Set(['No Frills', 'FreshCo', 'Food Basics', 'Walmart']));
    for (const i of items) expect(i.source).toBe('fixture');
  });

  it('matches at least 85% of the food items', () => {
    const rate = matched.length / foodItems.length;
    const unmatched = foodItems.filter((i) => matchFlyerItem(i) === null).map((i) => i.rawName);
    expect(rate, `unmatched: ${unmatched.join(', ')}`).toBeGreaterThanOrEqual(0.85);
  });

  it('does not match the known non-food items', () => {
    for (const name of NON_FOOD) {
      const item = items.find((i) => i.rawName === name);
      expect(item, name).toBeDefined();
      expect(matchFlyerItem(item!), name).toBeNull();
    }
  });

  it('has cross-store overlap for chicken thighs, peppers and grapes', () => {
    const storesFor = (id: string) =>
      new Set(items.map(matchFlyerItem).filter((m) => m?.ingredientId === id).map((m) => m!.store));
    expect(storesFor('chicken-thigh-boneless').size).toBeGreaterThanOrEqual(3);
    expect(storesFor('red-bell-pepper').size + storesFor('green-bell-pepper').size).toBeGreaterThanOrEqual(2);
    expect(storesFor('grapes-red').size).toBeGreaterThanOrEqual(2);
  });
});
