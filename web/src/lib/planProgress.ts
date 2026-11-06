// The status line under Generate, and the timing line on the week. Pure, so the wording is tested without the DOM.
import type { PlanTimings } from '@provisions/shared';

/** A progress event from the planner (see the ndjson stream of POST /plan and the swap route). */
export type PlanProgressEvent =
  | { stage: 'writing'; attempt: number }
  | { stage: 'checking'; attempt: number }
  | { stage: 'fixing'; attempt: number; meals: number; reason: string }
  | { stage: 'saving' };

/** Shown until the first event arrives. */
export const WAITING_TEXT = 'This can take up to a minute.';

// Why the planner is fixing meals, in words for a person. An unknown check is shown by its name.
const REASON: Record<string, string> = {
  budget: 'over budget',
  allergen: 'an allergy',
  'never-buy': 'a never-buy item',
  'never-again': 'a meal marked never again',
  busy: 'too long to cook',
  variety: 'variety rules',
  'slot-coverage': 'missing meals',
  'unknown-ingredient': 'an ingredient not on offer',
  form: 'a form the household does not keep',
  'avoid-dish': 'a dish the household does not want',
};

export function progressText(e: PlanProgressEvent): string {
  switch (e.stage) {
    case 'writing':
      return 'Writing meals…';
    case 'checking':
      return 'Checking budget and allergies…';
    case 'fixing': {
      const why = REASON[e.reason] ?? e.reason;
      return `Fixing ${e.meals} ${e.meals === 1 ? 'meal' : 'meals'} (${why})…`;
    }
    case 'saving':
      return 'Saving…';
  }
}

/** "Planned in 48 s · 2 attempts", or null when the plan has no timings (plans saved before they were recorded). */
export function timingLine(timings: PlanTimings | undefined): string | null {
  if (!timings) return null;
  const took = timings.totalMs < 1000 ? 'Planned in under a second' : `Planned in ${Math.round(timings.totalMs / 1000)} s`;
  const n = timings.attempts.length;
  return `${took} · ${n} ${n === 1 ? 'attempt' : 'attempts'}`;
}
