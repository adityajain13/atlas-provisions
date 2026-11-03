// Week and slot constants. Kept apart from index.ts so planner modules can import them
// at runtime without a cycle through the barrel file.

export const DAYS = ['thu', 'fri', 'sat', 'sun', 'mon', 'tue', 'wed'] as const; // flyer week order, Thu to Wed
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
