// Groups a prep list by the day and time each step is done, for the desktop board and the phone day view.
import { DAYS, DAY_LONG, prepTimeRank, type Day, type PrepPlan, type PrepStep, type PrepTime } from '@provisions/shared';

export interface PrepGroup {
  key: string;
  day: Day;
  time?: PrepTime;
  steps: PrepStep[];
  minutes: number;
  label: string;
}

/** "Sunday · batch prep · 45 min", "Tuesday evening · 10 min", "Monday · 5 min". */
export function groupLabel(day: Day, time: PrepTime | undefined, minutes: number, prepDay: Day): string {
  const dayPart = time ? `${DAY_LONG[day]} ${time}` : DAY_LONG[day];
  const batch = !time && day === prepDay ? 'batch prep' : null;
  return [dayPart, batch, `${minutes} min`].filter((x): x is string => x !== null).join(' · ');
}

/** The steps grouped by day and time, in week order: untimed first, then morning, afternoon and evening. */
export function prepGroups(prep: PrepPlan): PrepGroup[] {
  const byKey = new Map<string, PrepGroup>();
  for (const step of prep.steps) {
    const key = `${step.day}|${step.time ?? ''}`;
    let group = byKey.get(key);
    if (!group) {
      group = { key, day: step.day, time: step.time, steps: [], minutes: 0, label: '' };
      byKey.set(key, group);
    }
    group.steps.push(step);
    group.minutes += step.minutes;
  }
  return [...byKey.values()]
    .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || prepTimeRank(a.time) - prepTimeRank(b.time))
    .map((g) => ({ ...g, label: groupLabel(g.day, g.time, g.minutes, prep.day) }));
}

/** The steps to do on one day, in the same order the groups use. */
export function stepsOnDay(prep: PrepPlan, day: Day): PrepStep[] {
  return prepGroups(prep)
    .filter((g) => g.day === day)
    .flatMap((g) => g.steps);
}

/** The element id a day's prep group scrolls to on the desktop board. */
export function prepAnchor(day: Day): string {
  return `prep-${day}`;
}
