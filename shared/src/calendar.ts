// Week and slot constants. Kept apart from index.ts so planner modules can import them
// at runtime without a cycle through the barrel file.

// The plan week runs Sunday to Saturday. Every grid, picker and loop uses this order.
export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Day = (typeof DAYS)[number];

export const SLOTS = ['breakfast', 'lunch', 'dinner'] as const;
export type Slot = (typeof SLOTS)[number];

export const DAY_LONG: Record<Day, string> = {
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
};

export function isWeeknight(day: Day): boolean {
  return day !== 'sat' && day !== 'sun';
}
