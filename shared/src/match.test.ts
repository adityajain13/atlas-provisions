import { describe, expect, it } from 'vitest';
import { expandFlyerItem, foldToken, matchFlyerItem, matchIngredient, normalizeRawName, splitProductName, type FlyerItem } from './match';

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

  it('removes accents and collapses punctuation', () => {
    expect(normalizeRawName('Jalapeño Peppers!!')).toBe('jalapeno peppers');
    expect(normalizeRawName('  Bananas,   Bunch  ')).toBe('bananas bunch');
  });

  it('drops trademark signs, apostrophes and the store brand prefixes flyers print', () => {
    expect(normalizeRawName("FARMER'S MARKET™ CARROTS")).toBe('carrots');
    expect(normalizeRawName('PC® WHOLE WHITE MUSHROOMS')).toBe('whole white mushrooms');
    expect(normalizeRawName("President's Choice Chicken Stock")).toBe('chicken stock');
    expect(normalizeRawName('Selection Sweet Potatoes')).toBe('sweet potatoes');
  });

  it('drops piece counts and size ranges', () => {
    expect(normalizeRawName("HAAGEN-DAZS, 400-450 mL, BARS 3/4's")).toBe('haagen-dazs bars');
    expect(normalizeRawName('NESTLÉ DRUMSTICK, 4\'s')).toBe('nestle drumstick');
    expect(normalizeRawName('Tide Pods 12 pk')).toBe('tide pods');
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

describe('foldToken', () => {
  it.each([
    ['tomatoes', 'tomato'],
    ['potatoes', 'potato'],
    ['berries', 'berry'],
    ['leaves', 'leaf'],
    ['chops', 'chop'],
    ['cucumbers', 'cucumber'],
    ['chickpeas', 'chickpea'],
    ['glass', 'glass'],
    ['tomato', 'tomato'],
    ['eggs', 'egg'],
  ])('folds %s to %s', (word, singular) => {
    expect(foldToken(word)).toBe(singular);
  });
});

describe('matching flyer wording', () => {
  it('matches plural and word-order variants', () => {
    expect(matchIngredient('PORK COMBO CHOPS')?.ingredientId).toBe('pork-chops');
    expect(matchIngredient('ENGLISH CUCUMBERS')?.ingredientId).toBe('english-cucumber');
    expect(matchIngredient('Fresh Tomatoes 1 kg')?.ingredientId).toBe('roma-tomatoes');
    expect(matchIngredient('Yellow Onions 3 lb')?.ingredientId).toBe('yellow-onion');
    expect(matchIngredient('Bone-In Chicken Thighs')?.ingredientId).toBe('chicken-thigh-bone-in');
  });

  it('keeps the more specific alias when several match', () => {
    expect(matchIngredient('ENGLISH CUCUMBERS OR SWEET POTATOES')?.ingredientId).toBe('english-cucumber');
    expect(matchIngredient('Sweet Potatoes 1 kg')?.ingredientId).toBe('sweet-potatoes');
    expect(matchIngredient('Pure Maple Syrup 540 mL')?.ingredientId).toBe('maple-syrup');
    expect(matchIngredient('White Mushrooms 227 g')?.ingredientId).toBe('white-mushrooms');
  });

  it('does not match ice cream that shares a word with an ingredient', () => {
    expect(matchIngredient("NESTLÉ DRUMSTICK, 4's")).toBeNull();
    expect(matchIngredient('HAAGEN-DAZS, 400-450 mL, BARS 3/4s')).toBeNull();
  });
});

describe('splitProductName', () => {
  it('leaves one product alone', () => {
    expect(splitProductName('PORK COMBO CHOPS')).toEqual(['PORK COMBO CHOPS']);
    expect(splitProductName('Mac & Cheese Dinner')).toEqual(['Mac', 'Cheese Dinner']);
  });

  it('splits "or" lines into products', () => {
    expect(splitProductName('BROCCOLI CROWNS or BUNCH SPINACH')).toEqual(['BROCCOLI CROWNS', 'BUNCH SPINACH']);
    expect(splitProductName('ENGLISH CUCUMBERS OR SWEET POTATOES')).toEqual(['ENGLISH CUCUMBERS', 'SWEET POTATOES']);
    expect(splitProductName("FARMER'S MARKET™ CARROTS OR YELLOW ONIONS OR PC® WHOLE WHITE MUSHROOMS")).toEqual([
      "FARMER'S MARKET™ CARROTS",
      'YELLOW ONIONS',
      'PC® WHOLE WHITE MUSHROOMS',
    ]);
  });

  it('does not split on sizes or counts', () => {
    expect(splitProductName('1.5 kg / 2 lb')).toEqual(['1.5 kg / 2 lb']);
    expect(splitProductName("HAAGEN-DAZS, 400-450 mL, BARS 3/4's")).toEqual(["HAAGEN-DAZS, 400-450 mL, BARS 3/4's"]);
  });

  it('splits a comma list only when every part is an ingredient', () => {
    expect(splitProductName('Carrots, Yellow Onions')).toEqual(['Carrots', 'Yellow Onions']);
    expect(splitProductName('Chicken Thighs, boneless, skin on')).toEqual(['Chicken Thighs, boneless, skin on']);
  });
});

describe('expandFlyerItem', () => {
  const base: FlyerItem = {
    id: 'flipp:9',
    store: 'No Frills',
    rawName: 'x',
    priceText: '2/$5',
    validFrom: '2026-11-12',
    validTo: '2026-11-18',
    source: 'flipp',
  };

  it('returns a single product unchanged', () => {
    expect(expandFlyerItem({ ...base, rawName: 'PORK COMBO CHOPS' })).toEqual([{ ...base, rawName: 'PORK COMBO CHOPS' }]);
  });

  it('gives each split product the same price, size and dates, with numbered ids', () => {
    const parts = expandFlyerItem({ ...base, rawName: 'BROCCOLI CROWNS or BUNCH SPINACH', sizeText: '1 lb' });
    expect(parts.map((p) => p.id)).toEqual(['flipp:9#1', 'flipp:9#2']);
    expect(parts.map((p) => p.rawName)).toEqual(['BROCCOLI CROWNS', 'BUNCH SPINACH']);
    for (const p of parts) {
      expect(p).toMatchObject({ store: 'No Frills', priceText: '2/$5', sizeText: '1 lb', validFrom: '2026-11-12', validTo: '2026-11-18' });
    }
  });

  it('matches each split product to its own ingredient', () => {
    const [broccoli, spinach] = expandFlyerItem({ ...base, rawName: 'BROCCOLI CROWNS or BUNCH SPINACH', priceText: '2.99/kg' })
      .map((p) => matchFlyerItem(p));
    expect(broccoli?.ingredientId).toBe('broccoli');
    expect(spinach?.ingredientId).toBe('spinach');
    expect(broccoli?.pricePerUnit).toBeCloseTo(2.99);
    expect(spinach?.pricePerUnit).toBeCloseTo(2.99);
  });

  it('leaves the ice cream line unmatched after splitting', () => {
    const parts = expandFlyerItem({ ...base, rawName: "HAAGEN-DAZS, 400-450 mL, BARS 3/4's or NESTLÉ DRUMSTICK, 4's" });
    expect(parts).toHaveLength(2);
    for (const p of parts) expect(matchFlyerItem(p)).toBeNull();
  });
});
