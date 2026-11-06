// Swapping meals in a saved week. The chosen meals and the meals they are linked to by leftovers are replaced; the
// rest of the week is kept exactly as it was. The model fills only the freed slots, and the whole week is then
// priced and checked, as a new plan is.
import {
  DAYS,
  PrepPlanSchema,
  SLOTS,
  prepTimingIssues,
  buildList,
  round2,
  swapClosure,
  toPlannedMeals,
  type Day,
  type Deal,
  type Household,
  type MatchedItem,
  type MealPlan,
  type PantryItem,
  type PlannedMeal,
  type PrepPlan,
  type PrepStep,
  type RatingSignals,
  type SlotCell,
  type ValidationIssue,
  DAY_LONG,
} from '@provisions/shared';
import { buildPayload, SWAP_PROMPT, SYSTEM_PROMPT, type KeptMealPayload, type PlannerPayload } from './prompt';
import type { PlannerClient } from './claude';
import { attachWeekPrep, bestAttempt, evaluateWeek, PREP_MISSING, prepFrom, weekFrame, type Attempt } from './run';

export interface SwapInput {
  household: Household;
  plan: MealPlan; // the saved plan being changed
  mealIds: string[]; // the meals chosen; the meals linked to them by leftovers come in too
  note?: string;
  deals: Deal[];
  matched: MatchedItem[];
  neverBuy: string[];
  recentDinnerNames: string[];
  pantry?: PantryItem[];
  ratings?: RatingSignals;
  today?: string;
  client: PlannerClient;
  maxAttempts?: number;
}

export interface SwapOutcome {
  plan: MealPlan; // the whole week after the swap
  swapped: string[]; // ids of the meals replaced, in plan order
  added: string[]; // ids of the new meals in their place
}

const cellKey = (c: { day: string; slot: string }) => `${c.day}-${c.slot}`;

/** Plan order: by day, then by slot. */
const weekOrder = (a: PlannedMeal, b: PlannedMeal) =>
  DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot);

/**
 * The model's new meals, with ids that do not collide with the kept meals or each other. A link is kept only when it
 * points at another new meal: a new meal never shares leftovers with a kept one.
 */
function renameFresh(fresh: PlannedMeal[], keptIds: ReadonlySet<string>): PlannedMeal[] {
  const taken = new Set(keptIds);
  const assigned = fresh.map((m) => {
    let id = m.id;
    for (let n = 2; taken.has(id); n++) id = `${m.id}-${n}`;
    taken.add(id);
    return id;
  });
  const byRaw = new Map<string, string>();
  fresh.forEach((m, i) => {
    if (!byRaw.has(m.id)) byRaw.set(m.id, assigned[i]!);
  });
  return fresh.map((m, i) => {
    const { usesLeftoversFrom, makesLeftoversFor, ...rest } = m;
    const id = assigned[i]!;
    const uses = usesLeftoversFrom !== undefined ? byRaw.get(usesLeftoversFrom) : undefined;
    const makes = makesLeftoversFor !== undefined ? byRaw.get(makesLeftoversFor) : undefined;
    return {
      ...rest,
      id,
      ...(uses && uses !== id ? { usesLeftoversFrom: uses } : {}),
      ...(makes && makes !== id ? { makesLeftoversFor: makes } : {}),
    };
  });
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
  if (prep) return attachWeekPrep(plan, prep, prepDay);
  const kept = keptPrep(saved.prep, keptIds, prepDay);
  const withSteps: MealPlan = kept ? { ...plan, prep: kept, issues: [...plan.issues, ...prepTimingIssues(kept, plan.meals)] } : plan;
  return { ...withSteps, issues: [...withSteps.issues, PREP_MISSING] };
}

/**
 * Swap the chosen meals (and their leftover links) in a saved week. Fills only the freed slots, keeps the other
 * meals as they are, and checks the whole week. Up to three attempts, as for a new plan.
 */
export async function runSwap(input: SwapInput): Promise<SwapOutcome> {
  const { household, plan: saved } = input;
  const maxAttempts = Math.max(1, input.maxAttempts ?? 3);
  const frame = weekFrame({
    household,
    request: saved.request,
    deals: input.deals,
    matched: input.matched,
    neverBuy: input.neverBuy,
    recentDinnerNames: input.recentDinnerNames,
    pantry: input.pantry,
    ratings: input.ratings,
    today: input.today,
  });

  const closure = swapClosure(saved.meals, input.mealIds);
  const replacedIds = new Set(closure);
  const replaced = saved.meals.filter((m) => replacedIds.has(m.id));
  const kept = saved.meals.filter((m) => !replacedIds.has(m.id));
  const keptIds = new Set(kept.map((m) => m.id));
  // The freed slots: the cells of the replaced meals that the week still has.
  const refill: SlotCell[] = frame.cells.filter((c) => replaced.some((m) => m.day === c.day && m.slot === c.slot));
  const refillKeys = new Set(refill.map(cellKey));
  const replacing = [...new Set(replaced.map((m) => m.name))];

  const keptCost = round2(
    buildList(kept, { ...frame.fixedCost, needs: [] }, frame.deals, frame.matched, frame.stores, household.maxStores, frame.priceMatchStores, frame.pantry)
      .reduce((sum, i) => sum + i.total, 0),
  );
  const keptMeals: KeptMealPayload[] = kept.map((m) => ({
    id: m.id,
    day: m.day,
    slot: m.slot,
    name: m.name,
    ingredients: m.ingredients.map((i) => ({ id: i.ingredientId, qty: i.qty, unit: i.unit })),
    ...(m.usesLeftoversFrom ? { usesLeftoversFrom: m.usesLeftoversFrom } : {}),
    ...(m.makesLeftoversFor ? { makesLeftoversFor: m.makesLeftoversFor } : {}),
  }));

  const payload: PlannerPayload = buildPayload({
    household,
    request: saved.request,
    cells: refill,
    fixed: frame.placements,
    fixedCost: frame.fixedCost,
    available: frame.available,
    neverBuy: frame.neverBuy,
    neverBuyWords: frame.neverWords,
    recentDinnerNames: frame.recentDinnerNames,
    pantryUseFirst: frame.dueSoon.map((i) => i.ingredientId),
    favourites: frame.ratings.favourites,
    avoid: [...frame.ratings.avoid, ...frame.ratings.never],
    keptMeals,
    keptCost,
    replacing,
    ...(input.note ? { swapNote: input.note } : {}),
  });

  // Nothing to fill (the freed slots have left the schedule): the replaced meals just go, and the model is not called.
  const attempted: { best: Attempt; attempts: number } =
    refill.length === 0
      ? { best: { plan: evaluateWeek(frame, kept, [], saved.notes) }, attempts: 0 }
      : await bestAttempt(payload, maxAttempts, async (p) => {
          const raw = await input.client.submitPlan(`${SYSTEM_PROMPT}\n${SWAP_PROMPT}`, p);
          const { meals: everyNew, issues: shapeIssues } = toPlannedMeals(raw.meals, frame.cells);
          const fresh = everyNew.filter((m) => refillKeys.has(cellKey(m)));
          const strays: ValidationIssue[] = everyNew
            .filter((m) => !refillKeys.has(cellKey(m)))
            .map((m) => ({
              check: 'slot-coverage',
              severity: 'error',
              message: `"${m.name}" is for ${DAY_LONG[m.day]} ${m.slot}, which is not being swapped. Plan only the slots listed.`,
            }));
          const merged = [...kept, ...renameFresh(fresh, keptIds)].sort(weekOrder);
          return {
            plan: evaluateWeek(frame, merged, [...shapeIssues, ...strays], raw.notes),
            prep: household.prepDay ? prepFrom(raw, merged, household.prepDay) : undefined,
          };
        });

  const { best, attempts } = attempted;
  const plan = swapPrep(best.plan, best.prep, saved, keptIds, household.prepDay);
  const result: MealPlan = {
    ...plan,
    attempts,
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
