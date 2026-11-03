import { describe, expect, it } from 'vitest';
import { parsePrice, parseSize, pricePerBaseUnit, toBaseQty } from './parse';
import { INGREDIENT_BY_ID } from './catalog';

describe('parseSize', () => {
  it.each([
    ['1.5 kg', { qty: 1.5, unit: 'kg' }],
    ['907 g', { qty: 907, unit: 'g' }],
    ['907g', { qty: 907, unit: 'g' }],
    ['2 lb', { qty: 2, unit: 'lb' }],
    ['2 lbs', { qty: 2, unit: 'lb' }],
    ['454 g / 1 lb', { qty: 454, unit: 'g' }],
    ['750 mL', { qty: 750, unit: 'ml' }],
    ['1.89 L', { qty: 1.89, unit: 'l' }],
    ['12 x 355 mL', { qty: 355, unit: 'ml', count: 12 }],
    ['6 pk', { qty: 6, unit: 'each' }],
    ['dozen', { qty: 12, unit: 'each' }],
    ['ea', { qty: 1, unit: 'each' }],
    ['each', { qty: 1, unit: 'each' }],
    ['per lb', { qty: 1, unit: 'lb' }],
    ['/lb', { qty: 1, unit: 'lb' }],
    ['bunch', { qty: 1, unit: 'each' }],
    ['12 oz', { qty: 12, unit: 'oz' }],
  ])('parses %j', (text, expected) => {
    expect(parseSize(text)).toEqual(expected);
  });

  it('returns null for text with no size', () => {
    expect(parseSize('')).toBeNull();
    expect(parseSize('Tide Pods')).toBeNull();
  });
});

describe('parsePrice', () => {
  it.each([
    ['$3.99', { amount: 3.99 }],
    ['3.99', { amount: 3.99 }],
    ['$13.49', { amount: 13.49 }],
    ['99¢', { amount: 0.99 }],
    ['$1.99/lb', { amount: 1.99, per: 'lb' }],
    ['1.99 lb', { amount: 1.99, per: 'lb' }],
    ['4.39/kg', { amount: 4.39, per: 'kg' }],
    ['$0.99/100 g', { amount: 0.99, per: '100g' }],
  ])('parses %j', (text, expected) => {
    expect(parsePrice(text)).toEqual(expected);
  });

  it('2/$5 is 2.50 each', () => {
    const p = parsePrice('2/$5');
    expect(p?.per).toBe('each');
    expect(p?.amount).toBeCloseTo(2.5);
  });

  it('3 for $10 is 3.33 each', () => {
    const p = parsePrice('3 for $10');
    expect(p?.per).toBe('each');
    expect(p?.amount).toBeCloseTo(10 / 3);
  });

  it('returns null for empty text', () => {
    expect(parsePrice('')).toBeNull();
  });
});

describe('toBaseQty', () => {
  it('converts weights to kg', () => {
    expect(toBaseQty({ qty: 907, unit: 'g' }, 'kg')).toBeCloseTo(0.907);
    expect(toBaseQty({ qty: 2, unit: 'lb' }, 'kg')).toBeCloseTo(0.9072);
    expect(toBaseQty({ qty: 16, unit: 'oz' }, 'kg')).toBeCloseTo(0.4536);
  });

  it('converts volumes to litres and multiplies multipacks', () => {
    expect(toBaseQty({ qty: 750, unit: 'ml' }, 'l')).toBeCloseTo(0.75);
    expect(toBaseQty({ qty: 355, unit: 'ml', count: 12 }, 'l')).toBeCloseTo(4.26);
  });

  it('gives the count for each items with weight sizes, or 1', () => {
    expect(toBaseQty({ qty: 907, unit: 'g' }, 'each')).toBe(1);
    expect(toBaseQty({ qty: 355, unit: 'ml', count: 6 }, 'each')).toBe(6);
    expect(toBaseQty({ qty: 12, unit: 'each' }, 'each')).toBe(12);
  });

  it('returns NaN for mismatched units', () => {
    expect(toBaseQty({ qty: 750, unit: 'ml' }, 'kg')).toBeNaN();
  });
});

describe('pricePerBaseUnit', () => {
  const chicken = INGREDIENT_BY_ID['chicken-thigh-boneless']!;
  const milk = INGREDIENT_BY_ID['milk-2-percent']!;
  const eggs = INGREDIENT_BY_ID['eggs-large']!;

  it('uses a per-kg price directly', () => {
    expect(pricePerBaseUnit({ amount: 4.39, per: 'kg' }, { qty: 1.5, unit: 'kg' }, chicken)).toBeCloseTo(4.39);
  });

  it('converts a per-lb price to per-kg', () => {
    expect(pricePerBaseUnit({ amount: 2, per: 'lb' }, null, chicken)).toBeCloseTo(2 / 0.4536);
  });

  it('divides a pack price by its size', () => {
    expect(pricePerBaseUnit({ amount: 13.49 }, { qty: 1.5, unit: 'kg' }, chicken)).toBeCloseTo(13.49 / 1.5);
  });

  it('prices a 4 L jug per litre', () => {
    expect(pricePerBaseUnit({ amount: 5.49 }, { qty: 4, unit: 'l' }, milk)).toBeCloseTo(5.49 / 4);
  });

  it('prices a dozen per egg', () => {
    expect(pricePerBaseUnit({ amount: 3.49 }, { qty: 12, unit: 'each' }, eggs)).toBeCloseTo(3.49 / 12);
  });

  it('returns null when it cannot be computed', () => {
    expect(pricePerBaseUnit({ amount: 3 }, null, chicken)).toBeNull();
    expect(pricePerBaseUnit({ amount: 3, per: 'lb' }, null, milk)).toBeNull();
  });
});
