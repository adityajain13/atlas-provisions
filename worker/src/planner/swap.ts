// Swapping meals in a saved week. The chosen meals and the meals they are linked to by leftovers are replaced; the
// rest of the week is kept exactly as it was. The model fills only the freed slots, and the whole week is then
// priced and checked, as a new plan is.
import {
  PrepPlanSchema,
  prepTimingIssues,
  swapClosure,
  type Day,
  type Deal,
  type FeedbackSignals,
  type Household,
  type MatchedItem,
  type MealPlan,
  type Offer,
  type PantryItem,
  type PlanTimings,
  type PrepPlan,
  type PrepStep,
  type RatingSignals,
  type SlotCell,
} from '@provisions/shared';
import type { PlannerClient } from './claude';
import { attachWeekPrep, evaluateWeek, keptCostOf, PREP_MISSING, runWeek, usablePrep, weekFrame, type Attempt, type PlanProgress, type WeekFrame } from './run';

export interface SwapInput {
  household: Household;
  plan: MealPlan; // the saved plan being changed
  mealIds: string[]; // the meals chosen; the meals linked to them by leftovers come in too
  note?: string;
  // Guests joining the swapped slots: their new ids, and the allergies they share. Their allergies are checked there.
  guests?: { ids: string[]; allergies: string[] };
  deals: Deal[];
  matched: MatchedItem[];
  neverBuy: string[];
  recentDinnerNames: string[];
  pantry?: PantryItem[];
  ratings?: RatingSignals;
  feedback?: FeedbackSignals;
  estimates?: Offer[];
  today?: string;
  client: PlannerClient;
  maxAttempts?: number;
  onProgress?: (p: PlanProgress) => void;
  now?: () => number;
}

export interface SwapOutcome {
  plan: MealPlan; // the whole week after the swap
  swapped: string[]; // ids of the meals replaced, in plan order
  added: string[]; // ids of the new meals in their place
}

/** The saved prep steps that serve only kept meals, renumbered. Undefined when none is left. */
function keptPrep(saved: PrepPlan | undefined, keptIds: ReadonlySet<string>, prepDay: Day): PrepPlan | undefined {
  const steps = (saved?.steps ?? []).filter((s) => s.forMeals.length > 0 && s.forMeals.every((id) => keptIds.has(id)));
  if (steps.length === 0) return undefined;
  const numbered: PrepStep[] = steps.map((s, i) => ({ ...s, id: `prep-${i + 1}` }));
  const parsed = PrepPlanSchema.safeParse({
    day: prepDay,
    steps: numbered,
    totalMinutes: numbered.reduce((sum, s) => sum + s.minutes, 0),
  });
  return parsed.success ? parsed.data : undefined;
}

/**
 * Prep for the swapped week. The model's list covers the whole week when it came back. When it did not, the saved
 * steps that serve only kept meals stay, and the usual warning says to regenerate prep.
 */
function swapPrep(plan: MealPlan, prep: PrepPlan | undefined, saved: MealPlan, keptIds: ReadonlySet<string>, prepDay: Day | null): MealPlan {
  if (!prepDay) return plan;
  if (usablePrep(prep)) return attachWeekPrep(plan, prep, prepDay);
  const kept = keptPrep(saved.prep, keptIds, prepDay);
  const withSteps: MealPlan = kept ? { ...plan, prep: kept, issues: [...plan.issues, ...prepTimingIssues(kept, plan.meals)] } : plan;
  return { ...withSteps, issues: [...withSteps.issues, PREP_MISSING] };
}

/**
 * Swap the chosen meals (and their leftover links) in a saved week. Fills only the freed slots, keeps the other
 * meals as they are, and checks the whole week. Errors that name meals are repaired as they are for a new plan.
 */
export async function runSwap(input: SwapInput): Promise<SwapOutcome> {
  const { household, plan: saved } = input;
  const maxAttempts = Math.max(1, input.maxAttempts ?? 3);
  // Guests on the plan stay on it. The ones joining now are added, with the allergies they came with.
  const joining = input.guests && input.guests.ids.length > 0 ? input.guests : undefined;
  const guests = {
    ...(saved.guests ?? {}),
    ...Object.fromEntries((joining?.ids ?? []).map((id) => [id, { allergies: joining!.allergies }])),
  };
  const frame = weekFrame({
    household,
    request: saved.request,
    deals: input.deals,
    matched: input.matched,
    neverBuy: input.neverBuy,
    recentDinnerNames: input.recentDinnerNames,
    pantry: input.pantry,
    ratings: input.ratings,
    feedback: input.feedback,
    estimates: input.estimates,
    today: input.today,
    guests,
  });

  const closure = swapClosure(saved.meals, input.mealIds);
  const replacedIds = new Set(closure);
  const replaced = saved.meals.filter((m) => replacedIds.has(m.id));
  const kept = saved.meals.filter((m) => !replacedIds.has(m.id));
  const keptIds = new Set(kept.map((m) => m.id));
  // The freed slots: the cells of the replaced meals that the week still has. Guests who join take a seat in every freed
  // slot, alongside the people who already eat there. The cells carry them, so the meals written for them carry them too.
  const freed = (c: SlotCell) => replaced.some((m) => m.day === c.day && m.slot === c.slot);
  const swapFrame: WeekFrame = joining
    ? { ...frame, cells: frame.cells.map((c) => (freed(c) ? { ...c, eaters: [...c.eaters, ...joining.ids] } : c)) }
    : frame;
  const refill: SlotCell[] = swapFrame.cells.filter(freed);
  const replacing = [...new Set(replaced.map((m) => m.name))];
  const keptCost = keptCostOf(frame, kept);

  // Nothing to fill (the freed slots have left the schedule): the replaced meals just go, and the model is not called.
  const outcome: { best: Attempt; attempts: number; timings: PlanTimings } =
    refill.length === 0
      ? { best: { plan: evaluateWeek(swapFrame, kept, [], saved.notes) }, attempts: 0, timings: { totalMs: 0, attempts: [] } }
      : await runWeek({
          frame: swapFrame,
          start: { cells: refill, kept, replacing, keptCost, swap: true, note: input.note, notes: saved.notes },
          client: input.client,
          maxAttempts,
          prepDay: household.prepDay,
          onProgress: input.onProgress,
          now: input.now ?? Date.now,
        });

  const { best, attempts, timings } = outcome;
  const plan = swapPrep(best.plan, best.prep, saved, keptIds, household.prepDay);
  const result: MealPlan = {
    ...plan,
    attempts,
    timings,
    generatedAt: new Date().toISOString(),
    issues: [...plan.issues, ...saved.issues.filter((i) => i.check === 'prices')],
    ...(saved.priceSource ? { priceSource: saved.priceSource } : {}),
  };
  return {
    plan: result,
    swapped: closure,
    added: result.meals.filter((m) => !keptIds.has(m.id)).map((m) => m.id),
  };
}
