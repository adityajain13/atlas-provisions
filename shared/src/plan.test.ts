import { describe, expect, it } from 'vitest';
import { PlanRequestSchema, flyerWeekOf, recentDinnerNames, type MealPlan } from './plan';

describe('flyerWeekOf', () => {
  it('returns the same day for a Thursday', () => {
    // 2026-11-12 12:00 Toronto (EST, UTC-5)
    expect(flyerWeekOf(new Date('2026-11-12T17:00:00Z'))).toBe('2026-11-12');
  });

  it('returns the previous Thursday for a Wednesday', () => {
    expect(flyerWeekOf(new Date('2026-11-18T17:00:00Z'))).toBe('2026-11-12');
  });

  it('returns the previous Thursday for a Sunday', () => {
    expect(flyerWeekOf(new Date('2026-11-15T17:00:00Z'))).toBe('2026-11-12');
  });

  it('uses the Toronto calendar date, not UTC', () => {
    // Thursday 03:00 UTC is still Wednesday 22:00 in Toronto, so the week starts the Thursday before.
    expect(flyerWeekOf(new Date('2026-11-12T03:00:00Z'))).toBe('2026-11-05');
  });

  it('handles a Thursday that is the first day of a month', () => {
    expect(flyerWeekOf(new Date('2026-10-01T16:00:00Z'))).toBe('2026-10-01');
    expect(flyerWeekOf(new Date('2026-11-03T16:00:00Z'))).toBe('2026-10-29');
  });
});

describe('PlanRequestSchema', () => {
  const valid = {
    weekOf: '2026-11-12',
    budget: 150,
    cravings: ['butter chicken'],
    overrides: [{ day: 'sat', slot: 'lunch', headcount: 3 }],
    useItUp: true,
  };

  it('accepts a valid request', () => {
    expect(PlanRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a weekOf that is not a Thursday', () => {
    expect(PlanRequestSchema.safeParse({ ...valid, weekOf: '2026-11-13' }).success).toBe(false);
  });

  it('rejects a weekOf that is not a real date', () => {
    expect(PlanRequestSchema.safeParse({ ...valid, weekOf: '2026-02-30' }).success).toBe(false);
    expect(PlanRequestSchema.safeParse({ ...valid, weekOf: '12/11/2026' }).success).toBe(false);
  });

  it('bounds the budget', () => {
    expect(PlanRequestSchema.safeParse({ ...valid, budget: 0 }).success).toBe(false);
    expect(PlanRequestSchema.safeParse({ ...valid, budget: 2001 }).success).toBe(false);
  });

  it('limits cravings to 10 entries of 60 characters', () => {
    expect(PlanRequestSchema.safeParse({ ...valid, cravings: Array(11).fill('tacos') }).success).toBe(false);
    expect(PlanRequestSchema.safeParse({ ...valid, cravings: ['x'.repeat(61)] }).success).toBe(false);
  });

  it('rejects an unknown day in an override', () => {
    expect(PlanRequestSchema.safeParse({ ...valid, overrides: [{ day: 'xyz', slot: 'lunch' }] }).success).toBe(false);
  });
});

function planWith(weekOf: string, meals: { day: MealPlan['meals'][number]['day']; slot: MealPlan['meals'][number]['slot']; name: string }[]): MealPlan {
  return {
    weekOf,
    request: { weekOf, budget: 150, cravings: [], overrides: [], useItUp: true },
    meals: meals.map((m, i) => ({ id: `m${i}`, day: m.day, slot: m.slot, name: m.name, eaters: ['ann'], ingredients: [], activeMinutes: 10, steps: [], tags: [] })),
    fixedMeals: [],
    list: [],
    stores: [],
    totalCost: 0,
    fixedCost: 0,
    issues: [],
    attempts: 1,
    generatedAt: '',
    notes: '',
  };
}

describe('recentDinnerNames', () => {
  it('returns dinners served in the 14 days before the week', () => {
    // Week of 2026-10-29 is 14 days before 2026-11-12. Its Thursday dinner is day 0.
    const earlier = planWith('2026-10-29', [
      { day: 'thu', slot: 'dinner', name: 'Chili' },
      { day: 'wed', slot: 'dinner', name: 'Dal' }, // 2026-11-04
    ]);
    expect(recentDinnerNames([earlier], '2026-11-12').sort()).toEqual(['Chili', 'Dal']);
  });

  it('excludes dinners older than the window and the week itself', () => {
    const older = planWith('2026-10-22', [{ day: 'thu', slot: 'dinner', name: 'Old stew' }]); // 2026-10-22 is 21 days before
    const current = planWith('2026-11-12', [{ day: 'thu', slot: 'dinner', name: 'Current' }]);
    expect(recentDinnerNames([older, current], '2026-11-12')).toEqual([]);
  });

  it('ignores lunches and breakfasts', () => {
    const p = planWith('2026-11-05', [{ day: 'fri', slot: 'lunch', name: 'Wrap' }, { day: 'fri', slot: 'dinner', name: 'Pasta' }]);
    expect(recentDinnerNames([p], '2026-11-12')).toEqual(['Pasta']);
  });
});
