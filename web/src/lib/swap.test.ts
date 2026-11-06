import { describe, expect, it } from 'vitest';
import type { MealPlan, PlannedMeal } from '@provisions/shared';
import { linkedLine, selectedMessage, swapPreview, swapTitle, swappedMessage, withChip } from './swap';

const meal = (id: string, over: Partial<PlannedMeal> = {}): PlannedMeal => {
  const [d, slot] = id.split('-') as [PlannedMeal['day'], PlannedMeal['slot']];
  return {
    id,
    day: d,
    slot,
    name: `${id} name`,
    eaters: ['ann'],
    ingredients: [],
    activeMinutes: 10,
    steps: [],
    tags: [],
    ...over,
  };
};

// Mon dinner makes leftovers for Tue lunch; Wed dinner stands alone.
const plan = { meals: [
  meal('mon-dinner', { makesLeftoversFor: 'tue-lunch', name: 'Chili' }),
  meal('tue-lunch', { usesLeftoversFrom: 'mon-dinner', name: 'Chili wrap' }),
  meal('wed-dinner', { name: 'Fish tacos' }),
] } as Pick<MealPlan, 'meals'>;

describe('swap wording', () => {
  it('names the number of meals in the title and the toast', () => {
    expect(swapTitle(3)).toBe('Swap 3 meals?');
    expect(swapTitle(1)).toBe('Swap 1 meal?');
    expect(swappedMessage(3)).toBe('Swapped 3 meals');
    expect(swappedMessage(1)).toBe('Swapped 1 meal');
    expect(selectedMessage(2)).toBe('2 selected');
  });
});

describe('swapPreview', () => {
  it('lists the chosen meals, and a linked lunch with the leftover link as its reason', () => {
    const p = swapPreview(plan, ['mon-dinner']);
    expect(p.closure).toEqual(['mon-dinner', 'tue-lunch']);
    expect(p.chosen).toEqual([{ id: 'mon-dinner', label: 'Mon dinner', name: 'Chili' }]);
    expect(p.linked).toEqual([{ id: 'tue-lunch', label: 'Tue lunch', name: 'Chili wrap', reason: 'leftovers of Mon dinner' }]);
    expect(linkedLine(p.linked[0]!)).toBe('Also swaps Tue lunch (leftovers of Mon dinner)');
  });

  it('gives the source of a linked lunch the reason that it makes leftovers for the chosen lunch', () => {
    const p = swapPreview(plan, ['tue-lunch']);
    expect(p.chosen.map((e) => e.id)).toEqual(['tue-lunch']);
    expect(p.linked).toEqual([{ id: 'mon-dinner', label: 'Mon dinner', name: 'Chili', reason: 'makes leftovers for Tue lunch' }]);
  });

  it('adds nothing for a meal with no leftover links', () => {
    const p = swapPreview(plan, ['wed-dinner']);
    expect(p.closure).toEqual(['wed-dinner']);
    expect(p.linked).toEqual([]);
    expect(linkedLine({ id: 'x', label: 'Tue lunch', name: 'x' })).toBe('Also swaps Tue lunch');
  });

  it('keeps the selection in plan order', () => {
    expect(swapPreview(plan, ['wed-dinner', 'mon-dinner']).chosen.map((e) => e.id)).toEqual(['mon-dinner', 'wed-dinner']);
  });
});

describe('withChip', () => {
  it('starts the note with a chip, and adds to it with a comma', () => {
    expect(withChip('', 'Quicker')).toBe('quicker');
    expect(withChip('no fish', 'Cheaper')).toBe('no fish, cheaper');
    expect(withChip('no fish, ', 'Vegetarian')).toBe('no fish, vegetarian');
  });

  it('does not repeat a phrase the note already has, and keeps the note within its limit', () => {
    expect(withChip('Quicker please', 'Quicker')).toBe('Quicker please');
    expect(withChip('x'.repeat(199), 'Different protein').length).toBeLessThanOrEqual(200);
    expect(withChip('', 'Different protein')).toBe('different protein');
  });
});
