import { describe, expect, it } from 'vitest';
import type { MealPlan, PlannedMeal } from '@provisions/shared';
import {
  guestSwapNote,
  guestsLine,
  leftoversQuestion,
  markLabel,
  mergeStatus,
  nextDinnerAfter,
  pantryAddedMessage,
  pantryChoices,
  useUpNote,
} from './mealStatus';

const meal = (id: string, day: PlannedMeal['day'], slot: PlannedMeal['slot'], name = id): PlannedMeal => ({
  id,
  day,
  slot,
  name,
  eaters: ['ann'],
  ingredients: [],
  activeMinutes: 10,
  steps: [],
  tags: [],
});

describe('mergeStatus', () => {
  it('a skip replaces whatever was marked', () => {
    expect(mergeStatus({ status: 'replaced', madeName: 'Pasta', guests: 2 }, { status: 'skipped', reason: 'ate-out' })).toEqual({
      status: 'skipped',
      reason: 'ate-out',
    });
  });

  it('guests added to a meal made instead keep the name made', () => {
    const current = { status: 'replaced' as const, madeName: 'Pasta' };
    expect(mergeStatus(current, { status: 'replaced', guests: 1, guestAllergies: ['dairy'] })).toEqual({
      status: 'replaced',
      madeName: 'Pasta',
      guests: 1,
      guestAllergies: ['dairy'],
    });
  });

  it('a name typed for a meal already noted for guests keeps the guests', () => {
    const current = { status: 'replaced' as const, guests: 2, guestAllergies: ['tree nut'] };
    expect(mergeStatus(current, { status: 'replaced', madeName: 'Toast' })).toEqual({
      status: 'replaced',
      guests: 2,
      guestAllergies: ['tree nut'],
      madeName: 'Toast',
    });
  });

  it('a patch on a meal that was skipped, or not marked, is the patch', () => {
    expect(mergeStatus({ status: 'skipped' }, { status: 'replaced', madeName: 'Toast' })).toEqual({ status: 'replaced', madeName: 'Toast' });
    expect(mergeStatus(undefined, { status: 'replaced' })).toEqual({ status: 'replaced' });
  });
});

describe('labels and lines', () => {
  it('says what a skipped or made-instead meal is', () => {
    expect(markLabel({ status: 'skipped', reason: 'not-eating' })).toBe("Skipped · Didn't eat");
    expect(markLabel({ status: 'skipped' })).toBe('Skipped');
    expect(markLabel({ status: 'replaced', madeName: 'Lentil soup' })).toBe('Made: Lentil soup instead');
    expect(markLabel({ status: 'replaced', guests: 1 })).toBeNull();
    expect(markLabel(undefined)).toBeNull();
  });

  it('counts guests and lists their allergies', () => {
    expect(guestsLine({ status: 'replaced', guests: 1, guestAllergies: ['tree nut'] })).toBe('+1 guest · tree nut');
    expect(guestsLine({ status: 'replaced', guests: 3, guestAllergies: ['Peanut', 'dairy'] })).toBe('+3 guests · peanut, dairy');
    expect(guestsLine({ status: 'replaced', guests: 2 })).toBe('+2 guests');
    expect(guestsLine({ status: 'skipped' })).toBeNull();
  });
});

describe('guestSwapNote', () => {
  it('names the allergies and says to keep them out, then keeps anything typed', () => {
    expect(guestSwapNote({ count: 2, allergies: ['tree nut', 'dairy'] }, 'quicker')).toBe(
      '2 guests joining, allergic to tree nut, dairy. Keep those out of this meal. quicker',
    );
  });

  it('is plain when no one has an allergy', () => {
    expect(guestSwapNote({ count: 1, allergies: [] }, '')).toBe('1 guest joining.');
  });

  it('never runs past the note limit', () => {
    expect(guestSwapNote({ count: 1, allergies: [] }, 'x'.repeat(300)).length).toBeLessThanOrEqual(200);
  });
});

describe('useUpNote, pantryAddedMessage and leftoversQuestion', () => {
  it('names up to four items to use', () => {
    expect(useUpNote(['spinach', 'chicken thighs'])).toBe('Use up: spinach, chicken thighs');
    expect(useUpNote(['a', 'b', 'c', 'd', 'e'])).toBe('Use up: a, b, c, d');
  });

  it('counts items in the toast', () => {
    expect(pantryAddedMessage(4)).toBe('Added 4 items to your pantry');
    expect(pantryAddedMessage(1)).toBe('Added 1 item to your pantry');
  });

  it('reads the question for one meal or several', () => {
    expect(leftoversQuestion(['Tue lunch'])).toBe('Tue lunch was going to be leftovers from this.');
    expect(leftoversQuestion(['Tue lunch', 'Wed lunch'])).toBe('Tue lunch and Wed lunch were going to be leftovers from this.');
    expect(leftoversQuestion(['Tue lunch', 'Wed lunch', 'Thu lunch'])).toBe(
      'Tue lunch, Wed lunch and Thu lunch were going to be leftovers from this.',
    );
  });
});

describe('nextDinnerAfter', () => {
  // The week of Sun 2026-11-08. Today is Mon 2026-11-09 at 07:00 Toronto.
  const now = new Date('2026-11-09T12:00:00Z');
  const plan = {
    weekOf: '2026-11-08',
    meals: [
      meal('mon-dinner', 'mon', 'dinner', 'Curry'),
      meal('tue-lunch', 'tue', 'lunch', 'Soup'),
      meal('wed-dinner', 'wed', 'dinner', 'Tacos'),
      meal('thu-dinner', 'thu', 'dinner', 'Pizza'),
    ],
  } as unknown as MealPlan;

  it('is the earliest later dinner that is still to come', () => {
    expect(nextDinnerAfter(plan, plan.meals[0]!, {}, now)?.id).toBe('wed-dinner');
  });

  it('skips a dinner already marked skipped', () => {
    expect(nextDinnerAfter(plan, plan.meals[0]!, { 'wed-dinner': { status: 'skipped' } }, now)?.id).toBe('thu-dinner');
  });

  it('is undefined when no later dinner is left in the week', () => {
    expect(nextDinnerAfter(plan, plan.meals[3]!, {}, now)).toBeUndefined();
  });
});

describe('pantryChoices', () => {
  it('lists each planned ingredient, all ticked, with its cook amount', () => {
    const choices = pantryChoices({
      ingredients: [
        { ingredientId: 'sour-cream', qty: 0.2, unit: 'kg' },
        { ingredientId: 'jasmine-rice', qty: 0.4, unit: 'kg' },
      ],
    });
    expect(choices.map((c) => [c.ingredientId, c.ticked])).toEqual([
      ['sour-cream', true],
      ['jasmine-rice', true],
    ]);
    expect(choices[0]!.name).toBe('Sour cream');
    expect(choices[0]!.amount).toBe('¾ cup');
  });
});
