import { describe, expect, it } from 'vitest';
import { matchFlyerItem, matchIngredient, normalizeRawName, type FlyerItem } from './match';

const base = {
  id: 'x',
  store: 'No Frills',
  priceText: '$3.99',
  validFrom: '2026-11-12',
  validTo: '2026-11-18',
  source: 'fixture' as const,
};

function item(rawName: string, extra: Partial<FlyerItem> = {}): FlyerItem {
  return { ...base, rawName, ...extra };
}

describe('normalizeRawName', () => {
  it('lowercases and strips brand prefixes', () => {
    expect(normalizeRawName('PC Boneless Skinless Chicken Thighs')).toBe('boneless skinless chicken thighs');
    expect(normalizeRawName('No Name Large Eggs')).toBe('large eggs');
    expect(normalizeRawName('Compliments Spaghetti')).toBe('spaghetti');
    expect(normalizeRawName('Great Value Rolled Oats')).toBe('rolled oats');
  });

  it('removes sizes and prices', () => {
    expect(normalizeRawName('Chicken Thighs 1.5 kg $13.49')).toBe('chicken thighs');
    expect(normalizeRawName('Basmati Rice 2kg 2/$5')).toBe('basmati rice');
    expect(normalizeRawName('Soy Sauce 12 x 355 mL')).toBe('soy sauce');
  });

  it('keeps unicode letters and collapses punctuation', () => {
    expect(normalizeRawName('Jalapeño Peppers!!')).toBe('jalapeño peppers');
    expect(normalizeRawName('  Bananas,   Bunch  ')).toBe('bananas bunch');
  });
});

describe('matchIngredient preference rules', () => {
  it('prefers "chicken thighs" over generic chicken', () => {
    expect(matchIngredient('PC Boneless Skinless Chicken Thighs 1.5 kg')?.ingredientId).toBe('chicken-thigh-boneless');
  });

  it('prefers "sweet potatoes" over "potatoes"', () => {
    expect(matchIngredient('Sweet Potatoes 1 kg')?.ingredientId).toBe('sweet-potatoes');
    expect(matchIngredient('Russet Potatoes 4 lb')?.ingredientId).toBe('potatoes');
  });

  it('prefers "greek yogurt" over "yogurt"', () => {
    expect(matchIngredient('Greek Yogurt 900 g')?.ingredientId).toBe('greek-yogurt');
    expect(matchIngredient('Vanilla Yogurt 650 g')?.ingredientId).toBe('yogurt-plain');
  });

  it('prefers "frozen peas" over "peas" when "frozen" appears', () => {
    expect(matchIngredient('Frozen Peas 750 g')?.ingredientId).toBe('frozen-peas');
    expect(matchIngredient('Green Peas 750 g')?.ingredientId).toBe('frozen-peas');
  });

  it('prefers "coconut milk" over "milk" and "peanut butter" over "butter"', () => {
    expect(matchIngredient('Coconut Milk 400 mL')?.ingredientId).toBe('coconut-milk');
    expect(matchIngredient('Creamy Peanut Butter 1 kg')?.ingredientId).toBe('peanut-butter');
    expect(matchIngredient('Salted Butter 454 g')?.ingredientId).toBe('butter');
  });

  it('prefers canned chickpeas over dry when "canned" appears', () => {
    expect(matchIngredient('Canned Chickpeas 540 mL')?.ingredientId).toBe('chickpeas-canned');
    expect(matchIngredient('Chickpeas 900 g')?.ingredientId).toBe('chickpeas-dry');
  });
});

describe('matchIngredient coverage and non-matches', () => {
  it.each([
    ['Large Eggs 18 ct', 'eggs-large'],
    ['Firm Tofu 454 g', 'tofu-firm'],
    ['Shrimp Raw Tail-on 454 g', 'shrimp-raw'],
    ['Mozzarella Shredded 500 g', 'mozzarella'],
    ['Basmati Rice 2 kg', 'basmati-rice'],
    ['Peanut Butter Smooth 1 kg', 'peanut-butter'],
    ['Strawberries 454 g', 'strawberries'],
    ['Flour Tortillas 10 pk', 'flour-tortillas'],
    ['Deli Ham Shaved 200 g', 'deli-ham'],
  ])('matches %s to %s', (raw, id) => {
    expect(matchIngredient(raw)?.ingredientId).toBe(id);
  });

  it('does not match non-food items', () => {
    expect(matchIngredient('Tide Pods 81 ct')).toBeNull();
    expect(matchIngredient('Doritos 235 g')).toBeNull();
    expect(matchIngredient('Paper Towels 6 roll')).toBeNull();
  });

  it('returns confidence 0.9 or more for multi-word aliases', () => {
    expect(matchIngredient('Boneless Chicken Thighs')?.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe('matchFlyerItem', () => {
  it('combines parse and match into a priced item', () => {
    const m = matchFlyerItem(item('PC Boneless Skinless Chicken Thighs', { priceText: '4.39/kg', sizeText: '1.5 kg' }));
    expect(m?.ingredientId).toBe('chicken-thigh-boneless');
    expect(m?.pricePerUnit).toBeCloseTo(4.39);
    expect(m?.packQty).toBeCloseTo(1.5);
    expect(m?.packPrice).toBeCloseTo(4.39 * 1.5);
  });

  it('falls back to a size found inside the raw name', () => {
    const m = matchFlyerItem(item('Basmati Rice 2 kg', { priceText: '$6.99' }));
    expect(m?.packQty).toBeCloseTo(2);
    expect(m?.pricePerUnit).toBeCloseTo(3.495);
  });

  it('returns null for unmatched or unpriced items', () => {
    expect(matchFlyerItem(item('Tide Pods 81 ct', { priceText: '$14.99' }))).toBeNull();
    expect(matchFlyerItem(item('Chicken Thighs', { priceText: 'call' }))).toBeNull();
  });
});
