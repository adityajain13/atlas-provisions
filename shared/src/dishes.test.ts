import { describe, expect, it } from 'vitest';
import { avoidedDish } from './dishes';

describe('avoidedDish', () => {
  it('matches the avoid word as a whole word, plural-folded', () => {
    expect(avoidedDish('Slaw bowl', ['slaw'])).toBe('slaw');
    expect(avoidedDish('Tomatoes and rice', ['tomato'])).toBe('tomato');
    expect(avoidedDish('Tomato soup', ['tomatoes'])).toBe('tomatoes');
  });

  it('catches a compound word that contains the avoid word', () => {
    expect(avoidedDish('Coleslaw', ['slaw'])).toBe('slaw');
    expect(avoidedDish('Cabbage slaw wraps', ['slaw'])).toBe('slaw');
    expect(avoidedDish('Fishcakes', ['fish'])).toBe('fish');
  });

  it('does not catch a short word inside a longer one', () => {
    expect(avoidedDish('Pierogi', ['pie'])).toBeUndefined();
    expect(avoidedDish('Spiced rice', ['pie'])).toBeUndefined();
  });

  it('ignores case and surrounding space in the avoid list', () => {
    expect(avoidedDish('Coleslaw', ['  SLAW '])).toBe('slaw');
  });

  it('returns nothing when the list is empty or no word matches', () => {
    expect(avoidedDish('Coleslaw', [])).toBeUndefined();
    expect(avoidedDish('Coleslaw', undefined)).toBeUndefined();
    expect(avoidedDish('Chicken curry', ['slaw', 'sushi'])).toBeUndefined();
  });

  it('matches a multi-word avoid phrase against the meal name', () => {
    expect(avoidedDish('Chicken stir fry', ['stir-fry'])).toBe('stir-fry');
    expect(avoidedDish('Stir fry noodles', ['stir fry'])).toBe('stir fry');
  });
});
