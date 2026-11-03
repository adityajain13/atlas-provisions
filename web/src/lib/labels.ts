import type { Day, Slot } from '@provisions/shared';

export const DAY_SHORT: Record<Day, string> = {
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
};

export const DAY_LETTER: Record<Day, string> = {
  thu: 'T',
  fri: 'F',
  sat: 'S',
  sun: 'S',
  mon: 'M',
  tue: 'T',
  wed: 'W',
};

export const SLOT_LABEL: Record<Slot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

export const SLOT_LETTER: Record<Slot, string> = {
  breakfast: 'B',
  lunch: 'L',
  dinner: 'D',
};

const CALENDAR: Day[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// "Mon-Fri" style summary, collapsing consecutive runs in calendar order.
export function formatDays(days: Day[]): string {
  if (days.length === 0) return 'No days';
  if (days.length === 7) return 'Every day';

  const ordered = CALENDAR.filter((d) => days.includes(d));
  const runs: string[] = [];
  let start = 0;
  for (let i = 0; i < ordered.length; i++) {
    const endOfRun =
      i === ordered.length - 1 ||
      CALENDAR.indexOf(ordered[i + 1]) !== CALENDAR.indexOf(ordered[i]) + 1;
    if (endOfRun) {
      const a = ordered[start];
      const b = ordered[i];
      runs.push(a === b ? DAY_SHORT[a] : `${DAY_SHORT[a]}–${DAY_SHORT[b]}`);
      start = i + 1;
    }
  }
  return runs.join(', ');
}
