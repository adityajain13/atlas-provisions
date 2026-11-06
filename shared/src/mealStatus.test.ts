import { describe, expect, it } from 'vitest';
import {
  MealStatusInputSchema,
  GuestsSchema,
  isMealUpcoming,
  nextGuestIds,
  normalizeAllergies,
  statusKindLabel,
  torontoHour,
} from './mealStatus';
import { leftoverDependents, swapClosure } from './swap';
import { recentDinnerNames, type MealPlan } from './plan';

describe('MealStatusInputSchema', () => {
  it('accepts a skipped meal with a reason, and a meal made instead with a name', () => {
    expect(MealStatusInputSchema.safeParse({ status: 'skipped', reason: 'ate-out' }).success).toBe(true);
    expect(MealStatusInputSchema.safeParse({ status: 'replaced', madeName: '  Pasta  ' }).success).toBe(true);
  });

  it('keeps a reason to skipped meals and a name to meals made instead', () => {
    expect(MealStatusInputSchema.safeParse({ status: 'replaced', reason: 'ate-out' }).success).toBe(false);
    expect(MealStatusInputSchema.safeParse({ status: 'skipped', madeName: 'Toast' }).success).toBe(false);
  });

  it('wants a guest count for guest allergies, and no guests on a skipped meal', () => {
    expect(MealStatusInputSchema.safeParse({ status: 'replaced', guestAllergies: ['tree nut'] }).success).toBe(false);
    expect(MealStatusInputSchema.safeParse({ status: 'replaced', guests: 2, guestAllergies: ['tree nut'] }).success).toBe(true);
    expect(MealStatusInputSchema.safeParse({ status: 'skipped', guests: 1 }).success).toBe(false);
  });

  it('caps guests at ten and rejects an empty made name', () => {
    expect(MealStatusInputSchema.safeParse({ status: 'replaced', guests: 11 }).success).toBe(false);
    expect(MealStatusInputSchema.safeParse({ status: 'replaced', madeName: '   ' }).success).toBe(false);
  });
});

describe('GuestsSchema', () => {
  it('takes one to ten guests with allergies as a list', () => {
    expect(GuestsSchema.safeParse({ count: 1, allergies: [] }).success).toBe(true);
    expect(GuestsSchema.safeParse({ count: 10, allergies: ['peanut'] }).success).toBe(true);
    expect(GuestsSchema.safeParse({ count: 0, allergies: [] }).success).toBe(false);
    expect(GuestsSchema.safeParse({ count: 11, allergies: [] }).success).toBe(false);
  });
});

describe('statusKindLabel', () => {
  it('says what happened to the meal', () => {
    expect(statusKindLabel({ status: 'skipped', reason: 'ate-out' })).toBe('Skipped · Ate out');
    expect(statusKindLabel({ status: 'skipped', reason: 'not-eating' })).toBe("Skipped · Didn't eat");
    expect(statusKindLabel({ status: 'skipped' })).toBe('Skipped');
    expect(statusKindLabel({ status: 'replaced', madeName: 'Pasta' })).toBe('Made: Pasta instead');
    expect(statusKindLabel({ status: 'replaced', guests: 1 })).toBeNull();
  });
});

describe('isMealUpcoming', () => {
  // 2026-11-08 is a Sunday. Toronto is UTC-5 in November.
  const WEEK = '2026-11-08';
  it('is true for a later day, false for an earlier one', () => {
    const now = new Date('2026-11-09T12:00:00Z'); // Mon 07:00 Toronto
    expect(isMealUpcoming(WEEK, 'tue', 'dinner', now)).toBe(true);
    expect(isMealUpcoming(WEEK, 'sun', 'dinner', now)).toBe(false);
  });

  it('for today, is true only before the slot starts on the Toronto clock', () => {
    const now = new Date('2026-11-08T16:00:00Z'); // Sun 11:00 Toronto
    // Lunch starts at 11:00 on the Toronto clock, so at 11:00 it has started.
    expect(isMealUpcoming(WEEK, 'sun', 'lunch', now)).toBe(false);
    expect(isMealUpcoming(WEEK, 'sun', 'lunch', new Date('2026-11-08T14:30:00Z'))).toBe(true); // 09:30 Toronto
    expect(isMealUpcoming(WEEK, 'sun', 'dinner', now)).toBe(true);
    expect(isMealUpcoming(WEEK, 'sun', 'breakfast', now)).toBe(false);
  });

  it('reads the Toronto date and hour, not UTC', () => {
    // 03:00 UTC on Monday is still Sunday evening in Toronto.
    const now = new Date('2026-11-09T03:00:00Z');
    expect(torontoHour(now)).toBe(22);
    expect(isMealUpcoming(WEEK, 'sun', 'dinner', now)).toBe(false);
    expect(isMealUpcoming(WEEK, 'mon', 'dinner', now)).toBe(true);
  });
});

describe('nextGuestIds', () => {
  it('starts at guest-1 and skips ids already eating or listed as guests', () => {
    const plan = { meals: [{ eaters: ['ann', 'guest-1'] }, { eaters: ['guest-3'] }], guests: { 'guest-2': { allergies: [] } } };
    expect(nextGuestIds(plan, 2)).toEqual(['guest-4', 'guest-5']);
    expect(nextGuestIds({ meals: [] }, 1)).toEqual(['guest-1']);
  });
});

describe('normalizeAllergies', () => {
  it('trims, lower-cases and drops repeats, keeping order', () => {
    expect(normalizeAllergies([' Tree Nut ', 'dairy', 'tree nut', '', 'Dairy'])).toEqual(['tree nut', 'dairy']);
  });
});

describe('leftoverDependents', () => {
  const meals = [
    { id: 'mon-dinner', makesLeftoversFor: 'tue-lunch' },
    { id: 'tue-lunch', usesLeftoversFrom: 'mon-dinner', makesLeftoversFor: 'wed-lunch' },
    { id: 'wed-lunch', usesLeftoversFrom: 'tue-lunch' },
    { id: 'thu-dinner' },
  ];

  it('is the meals that eat this meal’s leftovers, through a chain, and not the meal itself', () => {
    expect(leftoverDependents(meals, 'mon-dinner')).toEqual(['tue-lunch', 'wed-lunch']);
    expect(leftoverDependents(meals, 'tue-lunch')).toEqual(['wed-lunch']);
  });

  it('does not walk upstream: the meal a leftover came from is not a dependent', () => {
    expect(leftoverDependents(meals, 'wed-lunch')).toEqual([]);
    expect(leftoverDependents(meals, 'thu-dinner')).toEqual([]);
  });

  it('agrees with the swap closure when the meal is the chosen one', () => {
    expect(swapClosure(meals, ['mon-dinner'])).toEqual(['mon-dinner', 'tue-lunch', 'wed-lunch']);
  });
});

describe('recentDinnerNames with statuses', () => {
  const plan = (weekOf: string, meals: { id: string; day: 'sun' | 'mon'; name: string }[]) =>
    ({
      weekOf,
      meals: meals.map((m) => ({ ...m, slot: 'dinner', eaters: [], ingredients: [], activeMinutes: 0, steps: [], tags: [] })),
    }) as unknown as MealPlan;

  // Dinners on Sun 2026-11-01 and Mon 2026-11-02, both inside the 14 days before the week of 2026-11-08.
  const earlier = [plan('2026-11-01', [{ id: 'sun-dinner', day: 'sun', name: 'Stew' }, { id: 'mon-dinner', day: 'mon', name: 'Curry' }])];

  it('counts every dinner when there is no status', () => {
    expect(recentDinnerNames(earlier, '2026-11-08')).toEqual(['Stew', 'Curry']);
  });

  it('leaves out a skipped dinner, and counts a made-instead dinner under the name made', () => {
    const statuses = {
      '2026-11-01': {
        'sun-dinner': { status: 'skipped' as const, reason: 'ate-out' as const },
        'mon-dinner': { status: 'replaced' as const, madeName: 'Lentil soup' },
      },
    };
    expect(recentDinnerNames(earlier, '2026-11-08', 14, statuses)).toEqual(['Lentil soup']);
  });
});
