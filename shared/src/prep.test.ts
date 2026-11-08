import { describe, expect, it } from 'vitest';
import { PrepPlanSchema, RawPrepSchema, prepRefIssues } from './prep';
import type { PlannedMeal, PrepPlan } from './plan';
import { HouseholdSchema, defaultHousehold } from './index';

describe('prep schemas', () => {
  it('accepts a prep plan and rejects an unknown day', () => {
    const ok = { day: 'sun', steps: [{ id: 'prep-1', task: 'Cook rice', minutes: 20, forMeals: ['thu-dinner'] }], totalMinutes: 20 };
    expect(PrepPlanSchema.safeParse(ok).success).toBe(true);
    expect(PrepPlanSchema.safeParse({ ...ok, day: 'funday' }).success).toBe(false);
  });

  it('accepts the raw model output without ids or totals, and rejects a blank task', () => {
    expect(RawPrepSchema.safeParse({ steps: [{ task: 'Chop onions', minutes: 5, forMeals: [] }] }).success).toBe(true);
    expect(RawPrepSchema.safeParse({ steps: [{ task: ' ', minutes: 5, forMeals: [] }] }).success).toBe(false);
  });
});

describe('household prep day', () => {
  it('defaults to Sunday in new households', () => {
    expect(defaultHousehold().prepDay).toBe('sun');
  });

  it('parses a stored household that predates prepDay, with Sunday', () => {
    const { prepDay: _drop, ...older } = defaultHousehold();
    const parsed = HouseholdSchema.parse(older);
    expect(parsed.prepDay).toBe('sun');
  });

  it('keeps null as no prep day', () => {
    expect(HouseholdSchema.parse({ ...defaultHousehold(), prepDay: null }).prepDay).toBeNull();
  });
});

describe('prepRefIssues', () => {
  const meal = (id: string, steps: string[]) => ({ id, name: `Meal ${id}`, steps, day: 'mon', slot: 'dinner', eaters: [], ingredients: [], activeMinutes: 10, tags: [] }) as unknown as PlannedMeal;
  const prep = (forMeals: string[]) => ({ day: 'sun', totalMinutes: 10, steps: [{ id: 'prep-1', task: 'Cook rice', minutes: 10, forMeals, day: 'sun' }] }) as unknown as PrepPlan;

  it('warns for a meal that says prepped, batch-cooked or pre-cooked when no prep step serves it', () => {
    const meals = [meal('a', ['Add prepped cold rice']), meal('b', ['Stir in the batch-cooked rice']), meal('c', ['Serve pre-cooked lentils']), meal('d', ['Fry the onion'])];
    const issues = prepRefIssues(meals, undefined);
    expect(issues.map((i) => i.message.split('"')[1])).toEqual(['Meal a', 'Meal b', 'Meal c']);
    expect(issues.every((i) => i.check === 'prep-ref' && i.severity === 'warning')).toBe(true);
  });

  it('is satisfied by a prep step that serves the meal', () => {
    expect(prepRefIssues([meal('a', ['Add prepped rice'])], prep(['a']))).toEqual([]);
  });

  it('does not count a prep step that serves another meal', () => {
    expect(prepRefIssues([meal('a', ['Add prepped rice'])], prep(['b']))).toHaveLength(1);
  });
});
