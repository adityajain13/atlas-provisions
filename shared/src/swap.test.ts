import { describe, expect, it } from 'vitest';
import { SwapRequestSchema, swapClosure, type LeftoverLinked } from './swap';

// A week of plain meals with no links, plus the ones a test wires up.
const plain = (id: string): LeftoverLinked => ({ id });

describe('swapClosure', () => {
  it('returns just the selection when no meal is linked', () => {
    const meals = [plain('mon-dinner'), plain('tue-dinner'), plain('wed-dinner')];
    expect(swapClosure(meals, ['tue-dinner'])).toEqual(['tue-dinner']);
  });

  it('brings in the lunch that eats the leftovers of a selected dinner', () => {
    const meals: LeftoverLinked[] = [
      { id: 'mon-dinner', makesLeftoversFor: 'tue-lunch' },
      { id: 'tue-lunch', usesLeftoversFrom: 'mon-dinner' },
      plain('tue-dinner'),
    ];
    expect(swapClosure(meals, ['mon-dinner'])).toEqual(['mon-dinner', 'tue-lunch']);
  });

  it('brings in the dinner whose leftovers a selected lunch eats', () => {
    const meals: LeftoverLinked[] = [
      { id: 'mon-dinner', makesLeftoversFor: 'tue-lunch' },
      { id: 'tue-lunch', usesLeftoversFrom: 'mon-dinner' },
    ];
    expect(swapClosure(meals, ['tue-lunch'])).toEqual(['mon-dinner', 'tue-lunch']);
  });

  it('follows a chain both ways: A makes for B, B makes for C', () => {
    const meals: LeftoverLinked[] = [
      { id: 'a', makesLeftoversFor: 'b' },
      { id: 'b', usesLeftoversFrom: 'a', makesLeftoversFor: 'c' },
      { id: 'c', usesLeftoversFrom: 'b' },
      plain('d'),
    ];
    expect(swapClosure(meals, ['b'])).toEqual(['a', 'b', 'c']);
    expect(swapClosure(meals, ['c'])).toEqual(['a', 'b', 'c']);
    expect(swapClosure(meals, ['a'])).toEqual(['a', 'b', 'c']);
  });

  it('takes in every meal that eats the leftovers of one source', () => {
    const meals: LeftoverLinked[] = [
      { id: 'sun-dinner', makesLeftoversFor: 'mon-lunch' },
      { id: 'mon-lunch', usesLeftoversFrom: 'sun-dinner', makesLeftoversFor: 'tue-lunch' },
      { id: 'tue-lunch', usesLeftoversFrom: 'sun-dinner' },
    ];
    expect(swapClosure(meals, ['sun-dinner'])).toEqual(['sun-dinner', 'mon-lunch', 'tue-lunch']);
    expect(swapClosure(meals, ['tue-lunch'])).toEqual(['sun-dinner', 'mon-lunch', 'tue-lunch']);
  });

  it('returns the ids in plan order, whatever order the selection came in', () => {
    const meals = [plain('a'), plain('b'), plain('c'), plain('d')];
    expect(swapClosure(meals, ['d', 'a'])).toEqual(['a', 'd']);
  });

  it('ignores ids that are not planned meals, such as fixed meals', () => {
    const meals = [plain('mon-dinner'), plain('tue-dinner')];
    expect(swapClosure(meals, ['fixed-cookout@wed-dinner', 'tue-dinner'])).toEqual(['tue-dinner']);
    expect(swapClosure(meals, ['not-a-meal'])).toEqual([]);
  });

  it('ignores a link to a meal that is not in the plan, and a meal linked to itself', () => {
    const meals: LeftoverLinked[] = [
      { id: 'mon-dinner', makesLeftoversFor: 'gone-lunch' },
      { id: 'tue-dinner', usesLeftoversFrom: 'tue-dinner' },
    ];
    expect(swapClosure(meals, ['mon-dinner'])).toEqual(['mon-dinner']);
    expect(swapClosure(meals, ['tue-dinner'])).toEqual(['tue-dinner']);
  });

  it('does not reach meals linked to a meal outside the selection and its chain', () => {
    const meals: LeftoverLinked[] = [
      { id: 'mon-dinner', makesLeftoversFor: 'tue-lunch' },
      { id: 'tue-lunch', usesLeftoversFrom: 'mon-dinner' },
      { id: 'wed-dinner', makesLeftoversFor: 'thu-lunch' },
      { id: 'thu-lunch', usesLeftoversFrom: 'wed-dinner' },
    ];
    expect(swapClosure(meals, ['mon-dinner'])).toEqual(['mon-dinner', 'tue-lunch']);
  });
});

describe('SwapRequestSchema', () => {
  it('takes 1 to 21 meal ids and an optional trimmed note of at most 200 characters', () => {
    expect(SwapRequestSchema.parse({ mealIds: ['mon-dinner'], note: '  quicker  ' })).toEqual({
      mealIds: ['mon-dinner'],
      note: 'quicker',
    });
    expect(SwapRequestSchema.safeParse({ mealIds: [] }).success).toBe(false);
    expect(SwapRequestSchema.safeParse({ mealIds: Array.from({ length: 22 }, (_, i) => `m${i}`) }).success).toBe(false);
    expect(SwapRequestSchema.safeParse({ mealIds: Array.from({ length: 21 }, (_, i) => `m${i}`) }).success).toBe(true);
    expect(SwapRequestSchema.safeParse({ mealIds: ['m'], note: 'x'.repeat(201) }).success).toBe(false);
    expect(SwapRequestSchema.safeParse({ mealIds: ['m'], note: 'x'.repeat(200) }).success).toBe(true);
    expect(SwapRequestSchema.safeParse({ mealIds: [''] }).success).toBe(false);
  });
});
