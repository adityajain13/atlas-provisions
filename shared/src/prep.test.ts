import { describe, expect, it } from 'vitest';
import { PrepPlanSchema, RawPrepSchema } from './prep';
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
