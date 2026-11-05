import { describe, expect, it } from 'vitest';
import type { PrepPlan, PrepStep } from '@provisions/shared';
import { groupLabel, prepAnchor, prepGroups, stepsOnDay } from './prepView';

const step = (id: string, day: PrepStep['day'], minutes: number, time?: PrepStep['time']): PrepStep => ({
  id,
  task: `Task ${id}`,
  minutes,
  forMeals: [],
  day,
  ...(time ? { time } : {}),
});

const prep: PrepPlan = {
  day: 'sun',
  totalMinutes: 70,
  steps: [
    step('tue-thaw', 'tue', 10, 'evening'),
    step('sun-a', 'sun', 25),
    step('sun-b', 'sun', 20),
    step('sun-c', 'sun', 5, 'morning'),
  ],
};

describe('groupLabel', () => {
  it('names the batch on the prep day and the time of a timed step', () => {
    expect(groupLabel('sun', undefined, 45, 'sun')).toBe('Sunday · batch prep · 45 min');
    expect(groupLabel('tue', 'evening', 10, 'sun')).toBe('Tuesday evening · 10 min');
    expect(groupLabel('wed', undefined, 5, 'sun')).toBe('Wednesday · 5 min');
  });
});

describe('prepGroups', () => {
  it('groups by day and time in week order, untimed before morning, afternoon and evening', () => {
    const groups = prepGroups(prep);
    expect(groups.map((g) => g.label)).toEqual([
      'Sunday · batch prep · 45 min',
      'Sunday morning · 5 min',
      'Tuesday evening · 10 min',
    ]);
    expect(groups[0]!.steps.map((s) => s.id)).toEqual(['sun-a', 'sun-b']);
  });
});

describe('stepsOnDay', () => {
  it('returns that day\'s steps in the same order, and none for a day with no prep', () => {
    expect(stepsOnDay(prep, 'sun').map((s) => s.id)).toEqual(['sun-a', 'sun-b', 'sun-c']);
    expect(stepsOnDay(prep, 'mon')).toEqual([]);
  });
});

describe('prepAnchor', () => {
  it('gives each day its own element id', () => {
    expect(prepAnchor('tue')).toBe('prep-tue');
  });
});
