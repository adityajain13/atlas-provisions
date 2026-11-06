// The read-only amount of a fixed meal's ingredient, as the meal sheet lists it. Pure: no DOM.
import { describe, expect, it } from 'vitest';
import { fixedAmount } from './MealDetail';

describe('fixedAmount', () => {
  it('reads a weight or volume with its unit, and a count without one', () => {
    expect(fixedAmount({ qty: 250, unit: 'g' })).toBe('250 g');
    expect(fixedAmount({ qty: 1.5, unit: 'l' })).toBe('1.5 l');
    expect(fixedAmount({ qty: 2, unit: 'each' })).toBe('2');
  });

  it('rounds a long decimal to two places', () => {
    expect(fixedAmount({ qty: 0.333333, unit: 'kg' })).toBe('0.33 kg');
  });
});
