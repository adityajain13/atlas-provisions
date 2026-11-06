import { describe, expect, it } from 'vitest';
import { INGREDIENTS } from './catalog';
import { formatCookAmount, mixedNumber, snapCount } from './amounts';

describe('formatCookAmount: the four amounts the meal detail showed as weights', () => {
  it('reads 0.2 kg of jasmine rice as 1 cup', () => {
    expect(formatCookAmount('jasmine-rice', 0.2)).toBe('1 cup');
  });

  it('reads 0.3 each of green cabbage (one head is 0.9 kg) as a third of a head', () => {
    expect(formatCookAmount('green-cabbage', 0.3)).toBe('⅓ head');
  });

  it('reads 0.1 kg of yellow onion (about 150 g each) as half an onion', () => {
    expect(formatCookAmount('yellow-onion', 0.1)).toBe('½ onion');
  });

  it('reads 0.02 kg of garlic as 4 cloves', () => {
    expect(formatCookAmount('garlic', 0.02)).toBe('4 cloves');
  });
});

describe('formatCookAmount: other shapes', () => {
  it('writes a mixed number with a glyph, and plurals only above one', () => {
    expect(formatCookAmount('jasmine-rice', 0.28)).toBe('1½ cups');
    expect(formatCookAmount('jasmine-rice', 0.185)).toBe('1 cup');
    expect(formatCookAmount('yellow-onion', 0.3)).toBe('2 onions');
    expect(formatCookAmount('yellow-onion', 0.2)).toBe('1½ onions');
    expect(formatCookAmount('yellow-onion', 0.225)).toBe('1½ onions');
  });

  it('uses the invariant spoon names', () => {
    expect(formatCookAmount('olive-oil', 0.03)).toBe('2 tbsp');
    expect(formatCookAmount('ground-cumin', 0.001)).toBe('½ tsp');
  });

  it('reads eggs (sold by the dozen) in eggs, from the weight of the carton', () => {
    expect(formatCookAmount('eggs-large', 0.25)).toBe('3 eggs');
    expect(formatCookAmount('eggs-large', 1)).toBe('12 eggs');
  });

  it('reads a slice of bread in slices, for a share of a loaf', () => {
    expect(formatCookAmount('white-bread', 0.1)).toBe('2 slices');
    expect(formatCookAmount('white-bread', 1)).toBe('22½ slices');
  });

  it('reads canned goods in cans', () => {
    // Canned goods are counted in cans, so the quantity is a count of cans.
    expect(formatCookAmount('chickpeas-canned', 1)).toBe('1 can');
    expect(formatCookAmount('chickpeas-canned', 2)).toBe('2 cans');
  });

  it('reads liquids in cups and tablespoons', () => {
    expect(formatCookAmount('milk-2-percent', 0.5)).toBe('2 cups');
    expect(formatCookAmount('soy-sauce', 0.032)).toBe('2 tbsp');
  });

  it('falls back to grams under a kilogram and kilograms above, with no cook measure', () => {
    expect(formatCookAmount('ground-beef', 0.2)).toBe('200 g');
    expect(formatCookAmount('ground-beef', 1.5)).toBe('1.5 kg');
  });

  it('never shows zero: a tiny quantity is the smallest step, or a pinch for a spoon', () => {
    expect(formatCookAmount('garlic', 0.0001)).toBe('1 clove');
    expect(formatCookAmount('ground-cumin', 0.00001)).toBe('a pinch');
    expect(formatCookAmount('jasmine-rice', 0.0001)).toBe('¼ cup');
    expect(formatCookAmount('garlic', 0)).toBe('a pinch');
  });

  it('gives a garlic powder its own spoon, apart from fresh garlic', () => {
    expect(formatCookAmount('garlic-powder', 0.003)).toBe('1 tsp');
    expect(formatCookAmount('garlic', 0.005)).toBe('1 clove');
  });
});

describe('snapCount and mixedNumber', () => {
  it('snaps cups to quarters and thirds, and teaspoons to eighths', () => {
    expect(snapCount(1.08, 'cup')).toBe(1);
    expect(snapCount(1.4, 'cup')).toBeCloseTo(4 / 3);
    expect(snapCount(0.6, 'tsp')).toBeCloseTo(2 / 3);
    expect(snapCount(0.12, 'tsp')).toBe(0.125);
  });

  it('snaps pieces to halves and cans to whole numbers', () => {
    expect(snapCount(0.667, 'piece')).toBe(0.5);
    expect(snapCount(0.8, 'piece')).toBe(1);
    expect(snapCount(2.4, 'can')).toBe(2);
  });

  it('writes whole numbers and fractions with glyphs', () => {
    expect(mixedNumber(0)).toBe('0');
    expect(mixedNumber(2)).toBe('2');
    expect(mixedNumber(0.5)).toBe('½');
    expect(mixedNumber(1.25)).toBe('1¼');
    expect(mixedNumber(2 + 2 / 3)).toBe('2⅔');
  });
});

describe('formatCookAmount over the whole catalogue', () => {
  it('never returns an empty, zero or NaN amount for a typical quantity', () => {
    for (const ing of INGREDIENTS) {
      const qty = ing.baseUnit === 'each' ? 1 : ing.baseUnit === 'l' ? 0.25 : 0.15;
      const text = formatCookAmount(ing.id, qty);
      expect(text, ing.id).toBeTruthy();
      expect(text, ing.id).not.toMatch(/\b0\b|NaN|undefined/);
    }
  });

  it('gives every catalogue cook measure a positive weight per unit', () => {
    for (const ing of INGREDIENTS) {
      if (ing.cook?.gramsPer !== undefined) expect(ing.cook.gramsPer, ing.id).toBeGreaterThan(0);
    }
  });
});
