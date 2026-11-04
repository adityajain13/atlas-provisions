import { DAYS, type Day, type Slot } from '@provisions/shared';

export const DAY_SHORT: Record<Day, string> = {
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
};

export const SLOT_LABEL: Record<Slot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

// "Mon–Fri" style summary, collapsing consecutive runs in Sunday-first order.
// Runs do not wrap: Sat and Sun are not adjacent, so "Sat, Sun" reads "Sun, Sat".
export function formatDays(days: Day[]): string {
  if (days.length === 0) return 'No days';
  if (days.length === DAYS.length) return 'Every day';

  const ordered = DAYS.filter((d) => days.includes(d));
  const runs: string[] = [];
  let start = 0;
  for (let i = 0; i < ordered.length; i++) {
    const endOfRun =
      i === ordered.length - 1 ||
      DAYS.indexOf(ordered[i + 1]!) !== DAYS.indexOf(ordered[i]!) + 1;
    if (endOfRun) {
      const a = ordered[start]!;
      const b = ordered[i]!;
      runs.push(a === b ? DAY_SHORT[a] : `${DAY_SHORT[a]}–${DAY_SHORT[b]}`);
      start = i + 1;
    }
  }
  return runs.join(', ');
}
