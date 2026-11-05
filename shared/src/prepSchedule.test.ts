import { describe, expect, it } from 'vitest';
import {
  PrepPlanSchema,
  parseStorageText,
  prepTimingIssues,
  readStorage,
  readStoredPlan,
  storageSentence,
  type PrepPlan,
  type PrepStep,
} from './index';

const step = (over: Partial<PrepStep> & Pick<PrepStep, 'task' | 'day' | 'forMeals'>): PrepStep => ({
  id: 'p',
  minutes: 5,
  ...over,
});

const planOf = (steps: PrepStep[]): PrepPlan => ({ day: 'sun', steps, totalMinutes: 0 });

describe('parseStorageText (older one-line storage)', () => {
  it('reads the method, the days and no container from "fridge, 3 days"', () => {
    expect(parseStorageText('fridge, 3 days')).toEqual({ method: 'fridge', how: '', keepsDays: 3 });
  });

  it('reads the container and weeks from "airtight container in freezer, 2 weeks"', () => {
    expect(parseStorageText('airtight container in freezer, 2 weeks')).toEqual({
      method: 'freezer',
      how: 'airtight container',
      keepsDays: 14,
    });
  });

  it('keeps null days when the text gives none, and defaults the method to fridge', () => {
    expect(parseStorageText('wrapped in a damp paper towel')).toEqual({
      method: 'fridge',
      how: 'wrapped in a damp paper towel',
      keepsDays: null,
    });
  });
});

describe('readStorage and storageSentence', () => {
  it('reads an object and a string the same way', () => {
    expect(readStorage({ method: 'fridge', how: 'airtight container', keepsDays: 3 })).toEqual({
      method: 'fridge',
      how: 'airtight container',
      keepsDays: 3,
    });
    expect(readStorage('')).toBeUndefined();
    expect(readStorage({ method: 'shelf', how: 'x', keepsDays: 1 })).toBeUndefined();
  });

  it('builds the line the page shows', () => {
    expect(storageSentence({ method: 'fridge', how: 'airtight container', keepsDays: 3 })).toBe(
      'Fridge, airtight container · keeps 3 days',
    );
    expect(storageSentence({ method: 'counter', how: '', keepsDays: null })).toBe('Counter');
    expect(storageSentence({ method: 'freezer', how: 'bag', keepsDays: 1 })).toBe('Freezer, bag · keeps 1 day');
  });

  it('does not repeat the method when the container is only the method word', () => {
    expect(storageSentence({ method: 'fridge', how: 'Fridge', keepsDays: 2 })).toBe('Fridge · keeps 2 days');
  });
});

describe('stored plans from before the schedule', () => {
  it('gives steps the prep day and reads the storage text', () => {
    const old = {
      day: 'sun',
      steps: [{ id: 'prep-1', task: 'Cook rice', minutes: 20, forMeals: ['m0'], storage: 'fridge, 4 days' }],
      totalMinutes: 20,
    };
    const parsed = PrepPlanSchema.parse(old);
    expect(parsed.steps[0]).toMatchObject({
      day: 'sun',
      storage: { method: 'fridge', how: '', keepsDays: 4 },
    });
  });

  it('drops a prep list it cannot read, and keeps the rest of the plan', () => {
    const plan = readStoredPlan({ weekOf: '2026-11-01', prep: { nonsense: true }, meals: [] } as { prep?: unknown; weekOf: string; meals: [] });
    expect(plan).toEqual({ weekOf: '2026-11-01', meals: [] });
  });
});

describe('prepTimingIssues', () => {
  const meals = [
    { id: 'mon-dinner', day: 'mon' as const },
    { id: 'thu-dinner', day: 'thu' as const },
    { id: 'wed-dinner', day: 'wed' as const },
  ];

  it('warns when a step keeps fewer days than it is used later, and says the day to prep it', () => {
    const issues = prepTimingIssues(
      planOf([step({ task: 'Cut pineapple', day: 'sun', forMeals: ['mon-dinner', 'thu-dinner'], storage: { method: 'fridge', how: 'airtight container', keepsDays: 3 } })]),
      meals,
    );
    expect(issues).toEqual([
      {
        check: 'prep-timing',
        severity: 'warning',
        message: 'Cut pineapple keeps 3 days but is used 4 days later: prep it Monday instead.',
      },
    ]);
  });

  it('says to split the step when the suggested day is after the first use', () => {
    const issues = prepTimingIssues(
      planOf([step({ task: 'Cook rice', day: 'sun', forMeals: ['mon-dinner', 'thu-dinner'], storage: { method: 'fridge', how: '', keepsDays: 1 } })]),
      meals,
    );
    expect(issues[0]?.message).toBe('Cook rice keeps 1 day but is used 4 days later: split it into two steps so each batch keeps.');
  });

  it('warns when a step is due after the first meal it serves', () => {
    const issues = prepTimingIssues(planOf([step({ task: 'Thaw chicken', day: 'thu', forMeals: ['mon-dinner'] })]), meals);
    expect(issues[0]?.message).toBe(
      'Thaw chicken is due Thursday but the first meal it serves is Monday: move it to Monday or earlier.',
    );
  });

  it('is quiet for a step that fits, a step with no keep time, and a step with no known meal', () => {
    const issues = prepTimingIssues(
      planOf([
        step({ task: 'Cook beans', day: 'sun', forMeals: ['mon-dinner'], storage: { method: 'fridge', how: '', keepsDays: 3 } }),
        step({ task: 'Chop herbs', day: 'sun', forMeals: ['thu-dinner'] }),
        step({ task: 'Thaw fish', day: 'tue', time: 'evening', forMeals: ['wed-dinner'], storage: { method: 'fridge', how: '', keepsDays: 1 } }),
        step({ task: 'Chop onion', day: 'sun', forMeals: ['ghost'], storage: { method: 'fridge', how: '', keepsDays: 0 } }),
      ]),
      meals,
    );
    expect(issues).toEqual([]);
  });
});
