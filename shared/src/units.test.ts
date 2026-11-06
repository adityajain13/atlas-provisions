import { describe, expect, it } from 'vitest';
import { defaultInputUnit, toBaseUnitQty } from './units';

describe('defaultInputUnit', () => {
  it('measures kilogram items in grams, litre items in millilitres and each items as each', () => {
    expect(defaultInputUnit('kg')).toBe('g');
    expect(defaultInputUnit('l')).toBe('ml');
    expect(defaultInputUnit('each')).toBe('each');
  });

  it('gives a quantity that converts back to the base unit', () => {
    expect(toBaseUnitQty(150, defaultInputUnit('kg'), 'kg')).toBeCloseTo(0.15, 9);
    expect(toBaseUnitQty(250, defaultInputUnit('l'), 'l')).toBeCloseTo(0.25, 9);
    expect(toBaseUnitQty(2, defaultInputUnit('each'), 'each')).toBe(2);
  });
});
