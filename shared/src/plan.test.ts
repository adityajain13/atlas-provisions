import { describe, expect, it } from 'vitest';
import { PlanRequestSchema, planWeekOf, recentDinnerNames, type MealPlan } from './plan';

describe('planWeekOf', () => {
  it('returns the same day for a Sunday', () => {
    // 2026-11-15 12:00 Toronto (EST, UTC-5)
    expect(planWeekOf(new Date('2026-11-15T17:00:00Z'))).toBe('2026-11-15');
  });

  it('returns the Sunday before for a Monday and for a Saturday', () => {
    expect(planWeekOf(new Date('2026-11-16T17:00:00Z'))).toBe('2026-11-15');
    expect(planWeekOf(new Date('2026-11-21T17:00:00Z'))).toBe('2026-11-15');
  });

  it('uses the Toronto calendar date, not UTC', () => {
    // Sunday 03:00 UTC is still Saturday 22:00 in Toronto, so the week starts the Sunday before.
    expect(planWeekOf(new Date('2026-11-15T03:00:00Z'))).toBe('2026-11-08');
  });

  it('handles a Sunday that is the first day of a month', () => {
    expect(planWeekOf(new Date('2026-11-01T16:00:00Z'))).toBe('2026-11-01');
    expect(planWeekOf(new Date('2026-10-04T16:00:00Z'))).toBe('2026-10-04');
    expect(planWeekOf(new Date('2026-10-03T16:00:00Z'))).toBe('2026-09-27');
  });
});

describe('PlanRequestSchema', () => {
  const valid = {
    weekOf: '2026-11-15',
    budget: 150,
    cravings: ['butter chicken'],
    overrides: [{ day: 'sat', slot: 'lunch', headcount: 3 }],
    useItUp: true,
  };

  it('accepts a valid request', () => {
    expect(PlanRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a weekOf that is not a Sunday', () => {
    expect(PlanRequestSchema.safeParse({ ...valid, weekOf: '2026-11-12' }).success).toBe(false); // a Thursday
    expect(PlanRequestSchema.safeParse({ ...valid, weekOf: '2026-11-16' }).success).toBe(false); // a Monday
  });

  it('gives the Sunday message for a weekOf that is not a Sunday', () => {
    const r = PlanRequestSchema.safeParse({ ...valid, weekOf: '2026-11-12' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('weekOf must be a Sunday (YYYY-MM-DD)');
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
    // Week of 2026-11-01 is 14 days before 2026-11-15. Its Sunday is day 0.
    const earlier = planWith('2026-11-01', [
      { day: 'thu', slot: 'dinner', name: 'Chili' }, // 2026-11-05
      { day: 'wed', slot: 'dinner', name: 'Dal' }, // 2026-11-04
    ]);
    expect(recentDinnerNames([earlier], '2026-11-15').sort()).toEqual(['Chili', 'Dal']);
  });

  it('excludes dinners older than the window and the week itself', () => {
    const older = planWith('2026-10-25', [{ day: 'sun', slot: 'dinner', name: 'Old stew' }]); // 2026-10-25 is 21 days before
    const current = planWith('2026-11-15', [{ day: 'sun', slot: 'dinner', name: 'Current' }]);
    expect(recentDinnerNames([older, current], '2026-11-15')).toEqual([]);
  });

  it('ignores lunches and breakfasts', () => {
    const p = planWith('2026-11-08', [{ day: 'fri', slot: 'lunch', name: 'Wrap' }, { day: 'fri', slot: 'dinner', name: 'Pasta' }]);
    expect(recentDinnerNames([p], '2026-11-15')).toEqual(['Pasta']);
  });
});
