// Which plan week a screen shows. The week lives in the ?week=YYYY-MM-DD query, and defaults to this week.
import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WEEKS_AHEAD, WEEKS_BACK, addWeeks, isSundayIso, planWeekOf, weekShortRange } from '@provisions/shared';

const WEEK_MS = 7 * 86_400_000;

/** Whole weeks from the current plan week: 0 is this week, 1 next week, -1 last week. */
export function weekOffset(weekOf: string, current: string): number {
  return Math.round((Date.parse(`${weekOf}T00:00:00Z`) - Date.parse(`${current}T00:00:00Z`)) / WEEK_MS);
}

/** A Sunday within the screens' window: WEEKS_BACK weeks ago to WEEKS_AHEAD weeks ahead. */
export function isViewableWeek(weekOf: string, current: string): boolean {
  if (!isSundayIso(weekOf)) return false;
  const n = weekOffset(weekOf, current);
  return n >= -WEEKS_BACK && n <= WEEKS_AHEAD;
}

/** The first and last weeks the Week and List screens let the reader reach. */
export function viewWindow(current: string): { first: string; last: string } {
  return { first: addWeeks(current, -WEEKS_BACK), last: addWeeks(current, WEEKS_AHEAD) };
}

/** The viewed week and a setter. An unreadable ?week is dropped, which shows the current week. */
export function useViewedWeek(): { weekOf: string; current: string; go: (weekOf: string) => void } {
  const [params, setParams] = useSearchParams();
  const current = planWeekOf(new Date());
  const raw = params.get('week');
  const valid = raw === null || isViewableWeek(raw, current);
  const weekOf = raw !== null && valid ? raw : current;

  useEffect(() => {
    if (raw !== null && !valid) {
      setParams(
        (prev) => {
          prev.delete('week');
          return prev;
        },
        { replace: true },
      );
    }
  }, [raw, valid, setParams]);

  // The current week has no ?week, so the URL stays clean. Arrows replace the entry rather than pushing one.
  const go = useCallback(
    (next: string) => {
      setParams(
        (prev) => {
          if (next === current) prev.delete('week');
          else prev.set('week', next);
          return prev;
        },
        { replace: true },
      );
    },
    [setParams, current],
  );

  return { weekOf, current, go };
}

/** Plan button and link label: "Plan this week", "Plan next week", "Plan the week of Nov 22–28"; "Re-plan" when a plan exists. */
export function planLabel(weekOf: string, current: string, hasPlan: boolean): string {
  const verb = hasPlan ? 'Re-plan' : 'Plan';
  const n = weekOffset(weekOf, current);
  if (n === 0) return `${verb} this week`;
  if (n === 1) return `${verb} next week`;
  return `${verb} the week of ${weekShortRange(weekOf, current)}`;
}

/** The Plan screen's heading. */
export function planTitle(weekOf: string, current: string): string {
  return planLabel(weekOf, current, false);
}

/** The confirm question before a saved plan is replaced. */
export function replaceTitle(weekOf: string, current: string): string {
  const n = weekOffset(weekOf, current);
  if (n === 0) return "Replace this week's plan?";
  if (n === 1) return "Replace next week's plan?";
  return `Replace the plan for ${weekShortRange(weekOf, current)}?`;
}

/** The sentence that opens the "already has a plan" note. */
export function existingNote(weekOf: string, current: string): string {
  const n = weekOffset(weekOf, current);
  if (n === 0) return 'This week already has a plan.';
  if (n === 1) return 'Next week already has a plan.';
  return 'That week already has a plan.';
}

/** What the switcher says above the range: "This week", "Next week", "3 weeks ago". */
export function weekCaption(weekOf: string, current: string): string {
  const n = weekOffset(weekOf, current);
  if (n === 0) return 'This week';
  if (n === 1) return 'Next week';
  if (n === -1) return 'Last week';
  if (n > 1) return `In ${n} weeks`;
  return `${-n} weeks ago`;
}

/** The phrase for the week in sentences: "this week", "next week", or "the week of Nov 22–28". */
export function weekPhrase(weekOf: string, current: string): string {
  const n = weekOffset(weekOf, current);
  if (n === 0) return 'this week';
  if (n === 1) return 'next week';
  return `the week of ${weekShortRange(weekOf, current)}`;
}
