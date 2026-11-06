import {
  buildList,
  costFixedMeals,
  expandWeek,
  expiringSoon,
  round2,
  toPlannedMeals,
  torontoDate,
  usableItems,
  validate,
  type Day,
  type Deal,
  type FixedCost,
  type FixedPlacement,
  type Household,
  type MatchedItem,
  type MealPlan,
  type PantryItem,
  type PlannedMeal,
  type PlanRequest,
  prepTimingIssues,
  type PrepPlan,
  type RatingSignals,
  type RawPlan,
  type SlotCell,
  type ValidationIssue,
} from '@provisions/shared';
import { buildAvailable, buildPayload, SYSTEM_PROMPT, type AvailableItem, type PlannerPayload } from './prompt';
import type { PlannerClient } from './claude';
import { normalisePrep } from './prep';

export const PREP_MISSING: ValidationIssue = {
  check: 'prep',
  severity: 'warning',
  message: "Prep plan wasn't included; tap Regenerate prep.",
};

/** The prep list from one call's output, checked against that call's meals. Undefined when missing or invalid. */
export function prepFrom(raw: RawPlan, meals: PlannedMeal[], prepDay: Day): PrepPlan | undefined {
  try {
    return normalisePrep(raw.prep, prepDay, new Set(meals.map((m) => m.id)));
  } catch {
    return undefined;
  }
}

export interface RunInput {
  household: Household;
  request: PlanRequest;
  deals: Deal[];
  matched: MatchedItem[];
  client: PlannerClient;
  recentDinnerNames: string[];
  neverBuy: string[]; // ingredient ids from never-buy item rules
  pantry?: PantryItem[]; // all pantry items; expired ones are ignored
  ratings?: RatingSignals; // favourites, avoid and never from meal ratings
  today?: string; // YYYY-MM-DD on the Toronto calendar; defaults to today
  maxAttempts?: number;
}

/** Everything a week is priced and checked against. A new plan and a swap of part of a plan use the same frame. */
export interface WeekFrame {
  household: Household;
  request: PlanRequest;
  deals: Deal[];
  matched: MatchedItem[];
  stores: string[];
  priceMatchStores: string[];
  neverBuy: string[];
  neverWords: string[];
  recentDinnerNames: string[];
  pantry: PantryItem[]; // usable stock only
  dueSoon: PantryItem[];
  ratings: RatingSignals;
  cells: SlotCell[]; // every cell of the week
  placements: FixedPlacement[];
  fixedCost: FixedCost;
  fixedMeals: MealPlan['fixedMeals'];
  available: AvailableItem[];
}

type FrameInput = Omit<RunInput, 'client' | 'maxAttempts'>;

/** Enabled store names, or every store in the flyer data when none is enabled. */
function storeNames(household: Household, deals: Deal[], matched: MatchedItem[]): string[] {
  const enabled = household.stores.filter((s) => s.enabled).map((s) => s.name);
  if (enabled.length > 0) return enabled;
  return [...new Set([...deals.map((d) => d.store), ...matched.map((m) => m.store)])];
}

/** The week's cells, fixed placements, costs and what the planner may use, for the request as saved. */
export function weekFrame(input: FrameInput): WeekFrame {
  const { household, request, deals, matched } = input;
  const today = input.today ?? torontoDate();
  const pantry = usableItems(input.pantry ?? [], today);
  const ratings = input.ratings ?? { favourites: [], avoid: [], never: [] };
  // Never-buy names as typed. The planner must not build a meal around one, listed ingredient or not.
  const neverWords = household.itemRules.filter((r) => r.rule === 'never').map((r) => r.name);
  const { cells, fixed: placements } = expandWeek(household, request);
  const fixedCost = costFixedMeals(placements, household, deals, matched);
  const names = new Map(household.fixedMeals.map((m) => [m.id, m.name]));
  return {
    household,
    request,
    deals,
    matched,
    stores: storeNames(household, deals, matched),
    priceMatchStores: household.stores.filter((s) => s.enabled && s.priceMatches).map((s) => s.name),
    neverBuy: input.neverBuy,
    neverWords,
    recentDinnerNames: input.recentDinnerNames,
    pantry,
    dueSoon: request.useItUp ? expiringSoon(pantry, today) : [],
    ratings,
    cells,
    placements,
    fixedCost,
    fixedMeals: placements.map((p) => ({
      id: p.id,
      name: names.get(p.fixedMealId) ?? p.fixedMealId,
      day: p.day,
      slot: p.slot,
      eaters: p.eaters,
    })),
    available: buildAvailable(deals, fixedCost, pantry),
  };
}

/** Prices and checks one set of planned meals for the week. Shape issues from toPlannedMeals come in as well. */
export function evaluateWeek(frame: WeekFrame, meals: PlannedMeal[], shapeIssues: ValidationIssue[], notes: string): MealPlan {
  const { household, request, deals, matched, fixedCost, stores, priceMatchStores, pantry } = frame;
  const list = buildList(meals, fixedCost, deals, matched, stores, household.maxStores, priceMatchStores, pantry);
  const totalCost = round2(list.reduce((sum, i) => sum + i.total, 0));
  const plan: MealPlan = {
    weekOf: request.weekOf,
    request,
    meals,
    fixedMeals: frame.fixedMeals,
    list,
    stores: [...new Set(list.filter((i) => i.store !== 'Unpriced').map((i) => i.store))],
    totalCost,
    fixedCost: fixedCost.cost,
    issues: [],
    attempts: 0,
    generatedAt: new Date().toISOString(),
    notes,
  };
  plan.issues = [
    ...fixedCost.issues,
    ...shapeIssues,
    ...validate(plan, {
      household,
      cells: frame.cells,
      fixed: fixedCost,
      available: new Set(frame.available.map((a) => a.id)),
      neverBuy: new Set(frame.neverBuy),
      neverWords: frame.neverWords,
      recentDinnerNames: frame.recentDinnerNames,
      useFirst: frame.dueSoon.map((i) => ({ ingredientId: i.ingredientId, expiresOn: i.expiresOn })),
      neverMeals: frame.ratings.never,
    }),
  ];
  return plan;
}

/** One attempt: the plan it priced and checked, and the prep list that came with it. */
export interface Attempt {
  plan: MealPlan;
  prep?: PrepPlan;
}

const errorCount = (issues: ValidationIssue[]) => issues.filter((i) => i.severity === 'error').length;

/**
 * Asks for a plan until one has no errors or the attempts run out. Each attempt's errors go back to the model as
 * feedback on the next. The kept attempt is the one with the fewest errors, then the lowest cost, with its own prep.
 * Prep never counts as an error and never triggers a retry.
 */
export async function bestAttempt(
  payload: PlannerPayload,
  maxAttempts: number,
  attempt: (payload: PlannerPayload) => Promise<Attempt>,
): Promise<{ best: Attempt; attempts: number }> {
  let best: Attempt | null = null;
  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts++;
    const tried = await attempt(payload);
    const errors = errorCount(tried.plan.issues);
    if (
      best === null ||
      errors < errorCount(best.plan.issues) ||
      (errors === errorCount(best.plan.issues) && tried.plan.totalCost < best.plan.totalCost)
    ) {
      best = tried;
    }
    if (errors === 0) break;
    payload.feedback = tried.plan.issues;
  }
  return { best: best!, attempts };
}

/**
 * Puts the kept attempt's prep on its plan, with the timing warnings for it. Without prep, the plan gets the
 * "tap Regenerate prep" warning. A household with no prep day gets no prep at all.
 */
export function attachWeekPrep(plan: MealPlan, prep: PrepPlan | undefined, prepDay: Day | null): MealPlan {
  if (!prepDay) return plan;
  // Timing breaches are warnings on the prep, never errors: they do not trigger a retry.
  if (prep) return { ...plan, prep, issues: [...plan.issues, ...prepTimingIssues(prep, plan.meals)] };
  return { ...plan, issues: [...plan.issues, PREP_MISSING] };
}

/**
 * Plan one week. Expand the grid, cost the fixed meals, ask the model for meals (and, when the
 * household has a prep day, the prep list in the same call), then price and check the result. If
 * there are errors and attempts remain, the issues go back to the model as feedback and it tries
 * again. The attempt with the fewest errors, then the lowest cost, is kept, with its own prep.
 * Prep never counts as an error and never triggers a retry: missing or invalid prep is a warning.
 * With no plannable cells the model is not called.
 */
export async function runPlanner(input: RunInput): Promise<MealPlan> {
  const { household, client } = input;
  const maxAttempts = Math.max(1, input.maxAttempts ?? 3);
  const frame = weekFrame(input);
  const { cells } = frame;

  if (cells.length === 0) return evaluateWeek(frame, [], [], '');

  const payload: PlannerPayload = buildPayload({
    household,
    request: frame.request,
    cells,
    fixed: frame.placements,
    fixedCost: frame.fixedCost,
    available: frame.available,
    neverBuy: frame.neverBuy,
    neverBuyWords: frame.neverWords,
    recentDinnerNames: frame.recentDinnerNames,
    pantryUseFirst: frame.dueSoon.map((i) => i.ingredientId),
    favourites: frame.ratings.favourites,
    avoid: [...frame.ratings.avoid, ...frame.ratings.never],
  });

  const { best, attempts } = await bestAttempt(payload, maxAttempts, async (p) => {
    const raw = await client.submitPlan(SYSTEM_PROMPT, p);
    const { meals, issues: shapeIssues } = toPlannedMeals(raw.meals, cells);
    return {
      plan: evaluateWeek(frame, meals, shapeIssues, raw.notes),
      prep: household.prepDay ? prepFrom(raw, meals, household.prepDay) : undefined,
    };
  });
  return { ...attachWeekPrep(best.plan, best.prep, household.prepDay), attempts };
}
