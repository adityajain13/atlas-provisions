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

// ---- Week navigation ----

/** How many plan weeks back the Week, List and Plan screens can show. */
export const WEEKS_BACK = 8;
/** How many plan weeks ahead a plan can be made. */
export const WEEKS_AHEAD = 2;
/** Plans and ticks for weeks older than this many weeks are deleted by the Sunday job. */
export const PLAN_RETENTION_WEEKS = 12;

/** True when the YYYY-MM-DD date falls on a Sunday. */
export function isSunday(date: string): boolean {
  return new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
}

/** The date `n` weeks after `weekOf` (negative goes back), as YYYY-MM-DD. */
export function addWeeks(weekOf: string, n: number): string {
  return new Date(Date.parse(`${weekOf}T00:00:00Z`) + 7 * n * 86_400_000).toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Nov 8", or "Nov 8, 2027" when the year is not the year of todayIso. */
function dayLabel(iso: string, todayIso: string, weekday: boolean): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const base = `${weekday ? `${WEEKDAYS[d.getUTCDay()]} ` : ''}${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return d.getUTCFullYear() === Number(todayIso.slice(0, 4)) ? base : `${base}, ${d.getUTCFullYear()}`;
}

/** "Sun Nov 8 – Sat Nov 14" for the Sunday-to-Saturday week. todayIso decides whether a year is shown. */
export function weekRangeLabel(weekOf: string, todayIso: string): string {
  const last = addWeeks(weekOf, 0);
  const saturday = new Date(Date.parse(`${last}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  return `${dayLabel(weekOf, todayIso, true)} – ${dayLabel(saturday, todayIso, true)}`;
}

/** "Nov 22–28" for a week inside one month, "Nov 29 – Dec 5" across two. No weekdays. */
export function weekShortRange(weekOf: string, todayIso: string): string {
  const saturday = new Date(Date.parse(`${weekOf}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  const start = new Date(`${weekOf}T00:00:00Z`);
  const end = new Date(`${saturday}T00:00:00Z`);
  if (start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear()) {
    const year = start.getUTCFullYear() === Number(todayIso.slice(0, 4)) ? '' : `, ${start.getUTCFullYear()}`;
    return `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()}–${end.getUTCDate()}${year}`;
  }
  return `${dayLabel(weekOf, todayIso, false)} – ${dayLabel(saturday, todayIso, false)}`;
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** The month (1-12) a plan week starts in, from its Sunday date. Read from the string, so no time zone can shift it. */
export function monthOfWeek(weekOf: string): number {
  return Number(weekOf.slice(5, 7));
}
