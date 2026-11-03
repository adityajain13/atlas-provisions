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
  type Deal,
  type Household,
  type MatchedItem,
  type MealPlan,
  type PantryItem,
  type PlannedMeal,
  type PlanRequest,
  type RatingSignals,
  type ValidationIssue,
} from '@provisions/shared';
import { buildAvailable, buildPayload, SYSTEM_PROMPT, type PlannerPayload } from './prompt';
import type { PlannerClient } from './claude';

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

/** Enabled store names, or every store in the flyer data when none is enabled. */
function storeNames(household: Household, deals: Deal[], matched: MatchedItem[]): string[] {
  const enabled = household.stores.filter((s) => s.enabled).map((s) => s.name);
  if (enabled.length > 0) return enabled;
  return [...new Set([...deals.map((d) => d.store), ...matched.map((m) => m.store)])];
}

const errorCount = (issues: ValidationIssue[]) => issues.filter((i) => i.severity === 'error').length;

/**
 * Plan one week. Expand the grid, cost the fixed meals, ask the model for meals, then price and
 * check the result. If there are errors and attempts remain, the issues go back to the model as
 * feedback and it tries again. The attempt with the fewest errors, then the lowest cost, is kept.
 * With no plannable cells the model is not called.
 */
export async function runPlanner(input: RunInput): Promise<MealPlan> {
  const { household, request, deals, matched, client, recentDinnerNames, neverBuy } = input;
  const maxAttempts = Math.max(1, input.maxAttempts ?? 3);
  const today = input.today ?? torontoDate();
  const pantry = usableItems(input.pantry ?? [], today);
  const ratings = input.ratings ?? { favourites: [], avoid: [], never: [] };
  const dueSoon = request.useItUp ? expiringSoon(pantry, today) : [];

  const { cells, fixed: placements } = expandWeek(household, request);
  const fixedCost = costFixedMeals(placements, household, deals, matched);
  const stores = storeNames(household, deals, matched);
  const priceMatchStores = household.stores.filter((s) => s.enabled && s.priceMatches).map((s) => s.name);
  const names = new Map(household.fixedMeals.map((m) => [m.id, m.name]));
  const fixedMeals = placements.map((p) => ({
    id: p.id,
    name: names.get(p.fixedMealId) ?? p.fixedMealId,
    day: p.day,
    slot: p.slot,
    eaters: p.eaters,
  }));
  const available = buildAvailable(deals, fixedCost, pantry);
  const availableIds = new Set(available.map((a) => a.id));

  // Price and check one set of planned meals. Shape issues from toPlannedMeals come in as well.
  const evaluate = (meals: PlannedMeal[], shapeIssues: ValidationIssue[], notes: string): MealPlan => {
    const list = buildList(meals, fixedCost, deals, matched, stores, household.maxStores, priceMatchStores, pantry);
    const totalCost = round2(list.reduce((sum, i) => sum + i.total, 0));
    const plan: MealPlan = {
      weekOf: request.weekOf,
      request,
      meals,
      fixedMeals,
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
        cells,
        fixed: fixedCost,
        available: availableIds,
        neverBuy: new Set(neverBuy),
        recentDinnerNames,
        useFirst: dueSoon.map((i) => ({ ingredientId: i.ingredientId, expiresOn: i.expiresOn })),
        neverMeals: ratings.never,
      }),
    ];
    return plan;
  };

  if (cells.length === 0) return evaluate([], [], '');

  const payload: PlannerPayload = buildPayload({
    household,
    request,
    cells,
    fixed: placements,
    fixedCost,
    available,
    neverBuy,
    recentDinnerNames,
    pantryUseFirst: dueSoon.map((i) => i.ingredientId),
    favourites: ratings.favourites,
    avoid: [...ratings.avoid, ...ratings.never],
  });

  let best: MealPlan | null = null;
  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts++;
    const raw = await client.submitPlan(SYSTEM_PROMPT, payload);
    const { meals, issues: shapeIssues } = toPlannedMeals(raw.meals, cells);
    const plan = evaluate(meals, shapeIssues, raw.notes);
    const errors = errorCount(plan.issues);
    if (best === null || errors < errorCount(best.issues) || (errors === errorCount(best.issues) && plan.totalCost < best.totalCost)) {
      best = plan;
    }
    if (errors === 0) break;
    payload.feedback = plan.issues;
  }

  best!.attempts = attempts;
  return best!;
}
