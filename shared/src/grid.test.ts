import { describe, expect, it } from 'vitest';
import { expandWeek } from './grid';
import { HouseholdSchema, defaultHousehold, type Household, type FixedMeal } from './index';
import type { PlanRequest } from './plan';

const people = [
  { id: 'ann', name: 'Ann', dietTags: [], allergies: [] },
  { id: 'ben', name: 'Ben', dietTags: [], allergies: [] },
];

function household(over: Partial<Household> = {}): Household {
  return { ...defaultHousehold(), people, ...over };
}

function request(over: Partial<PlanRequest> = {}): PlanRequest {
  return { weekOf: '2026-11-12', budget: 150, cravings: [], overrides: [], useItUp: true, ...over };
}

function fixedMeal(over: Partial<FixedMeal> = {}): FixedMeal {
  return {
    id: 'yogurt',
    name: 'Yogurt and granola',
    personIds: ['ann'],
    days: ['mon'],
    slot: 'breakfast',
    ingredients: [],
    active: true,
    ...over,
  };
}

const cellAt = (cells: { day: string; slot: string }[], day: string, slot: string) =>
  cells.find((c) => c.day === day && c.slot === slot);

describe('expandWeek', () => {
  it('makes 21 cells with both people eating when nothing is set', () => {
    const { cells, fixed } = expandWeek(household(), request());
    expect(cells).toHaveLength(21);
    expect(fixed).toEqual([]);
    for (const c of cells) expect(c.eaters).toEqual(['ann', 'ben']);
  });

  it('treats missing schedule entries as eating, and removes people marked as not eating', () => {
    const h = household({ schedule: { ben: { thu: { breakfast: false } } } });
    const { cells } = expandWeek(h, request());
    expect(cellAt(cells, 'thu', 'breakfast')!.eaters).toEqual(['ann']);
    expect(cellAt(cells, 'fri', 'breakfast')!.eaters).toEqual(['ann', 'ben']);
  });

  it('removes a fixed-meal person from the cell and records a placement', () => {
    const h = household({ fixedMeals: [fixedMeal()] });
    const { cells, fixed } = expandWeek(h, request());
    expect(cellAt(cells, 'mon', 'breakfast')!.eaters).toEqual(['ben']);
    expect(cellAt(cells, 'tue', 'breakfast')!.eaters).toEqual(['ann', 'ben']);
    expect(fixed).toEqual([
      { id: 'yogurt@mon-breakfast', fixedMealId: 'yogurt', day: 'mon', slot: 'breakfast', eaters: ['ann'] },
    ]);
  });

  it('ignores inactive fixed meals', () => {
    const h = household({ fixedMeals: [fixedMeal({ active: false })] });
    const { cells, fixed } = expandWeek(h, request());
    expect(fixed).toEqual([]);
    expect(cellAt(cells, 'mon', 'breakfast')!.eaters).toEqual(['ann', 'ben']);
  });

  it('drops the cell when a fixed meal covers everyone eating', () => {
    const h = household({ fixedMeals: [fixedMeal({ personIds: ['ann', 'ben'] })] });
    const { cells, fixed } = expandWeek(h, request());
    expect(cellAt(cells, 'mon', 'breakfast')).toBeUndefined();
    expect(fixed[0]!.eaters).toEqual(['ann', 'ben']);
  });

  it('skipFixed puts covered people back into the cell and drops the placement', () => {
    const h = household({ fixedMeals: [fixedMeal()] });
    const { cells, fixed } = expandWeek(
      h,
      request({ overrides: [{ day: 'mon', slot: 'breakfast', skipFixed: true }] }),
    );
    expect(cellAt(cells, 'mon', 'breakfast')!.eaters).toEqual(['ann', 'ben']);
    expect(fixed).toEqual([]);
  });

  it('eatingOut drops the plannable cell', () => {
    const { cells } = expandWeek(household(), request({ overrides: [{ day: 'fri', slot: 'dinner', eatingOut: true }] }));
    expect(cellAt(cells, 'fri', 'dinner')).toBeUndefined();
    expect(cells).toHaveLength(20);
  });

  it('headcount adds guest ids when it exceeds the people eating', () => {
    const { cells } = expandWeek(household(), request({ overrides: [{ day: 'sat', slot: 'lunch', headcount: 4 }] }));
    expect(cellAt(cells, 'sat', 'lunch')!.eaters).toEqual(['ann', 'ben', 'guest-1', 'guest-2']);
  });

  it('headcount below the people eating truncates the list', () => {
    const { cells } = expandWeek(household(), request({ overrides: [{ day: 'sat', slot: 'lunch', headcount: 1 }] }));
    expect(cellAt(cells, 'sat', 'lunch')!.eaters).toEqual(['ann']);
  });

  it('headcount 0 drops the cell', () => {
    const { cells } = expandWeek(household(), request({ overrides: [{ day: 'sat', slot: 'lunch', headcount: 0 }] }));
    expect(cellAt(cells, 'sat', 'lunch')).toBeUndefined();
  });

  it('applies headcount to the people left after a fixed meal, with guests for the rest', () => {
    const h = household({ fixedMeals: [fixedMeal()] });
    const { cells, fixed } = expandWeek(
      h,
      request({ overrides: [{ day: 'mon', slot: 'breakfast', headcount: 3 }] }),
    );
    expect(cellAt(cells, 'mon', 'breakfast')!.eaters).toEqual(['ben', 'guest-1', 'guest-2']);
    expect(fixed[0]!.eaters).toEqual(['ann']);
  });

  it('merges several overrides for one cell in request order', () => {
    const { cells } = expandWeek(
      household(),
      request({
        overrides: [
          { day: 'sun', slot: 'dinner', headcount: 3 },
          { day: 'sun', slot: 'dinner', skipFixed: true },
        ],
      }),
    );
    expect(cellAt(cells, 'sun', 'dinner')!.eaters).toEqual(['ann', 'ben', 'guest-1']);
  });
});

describe('expandWeek: time caps', () => {
  it('puts the household time cap on the matching cell only', () => {
    const { cells } = expandWeek(household({ timeCaps: { tue: { dinner: 15 } } }), request());
    expect(cellAt(cells, 'tue', 'dinner')!.maxMinutes).toBe(15);
    expect(cellAt(cells, 'tue', 'lunch')!.maxMinutes).toBeUndefined();
    expect(cellAt(cells, 'wed', 'dinner')!.maxMinutes).toBeUndefined();
  });

  it('lets a week override cap win over the household cap', () => {
    const h = household({ timeCaps: { tue: { dinner: 15 } } });
    const { cells } = expandWeek(h, request({ overrides: [{ day: 'tue', slot: 'dinner', maxMinutes: 45 }] }));
    expect(cellAt(cells, 'tue', 'dinner')!.maxMinutes).toBe(45);
  });

  it('applies a week override cap to a cell with no household cap', () => {
    const { cells } = expandWeek(household(), request({ overrides: [{ day: 'sat', slot: 'lunch', maxMinutes: 30 }] }));
    expect(cellAt(cells, 'sat', 'lunch')!.maxMinutes).toBe(30);
  });
});

describe('HouseholdSchema: timeCaps', () => {
  it('reads a stored household saved before time caps existed as having none', () => {
    const { timeCaps: _drop, ...older } = defaultHousehold();
    const parsed = HouseholdSchema.parse(older);
    expect(parsed.timeCaps).toEqual({});
  });

  it('rejects caps outside 5 to 180 minutes', () => {
    const bad = { ...defaultHousehold(), timeCaps: { mon: { dinner: 3 } } };
    expect(HouseholdSchema.safeParse(bad).success).toBe(false);
  });
});
