import { describe, expect, it } from 'vitest';
import { expandWeek } from './grid';
import { defaultHousehold, type Household, type FixedMeal } from './index';
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
