// Targeted repair: when a checked attempt has errors, find the meals they belong to, so the planner rewrites only
// those meals (and the meals linked to them by leftovers). The rest of the attempt is kept byte-for-byte. Pure, so the
// Worker's attempt loop and its tests share one rule. Anything that cannot be pinned on meals returns null, and the
// caller asks for a whole new attempt instead.
import { DAYS } from './calendar';
import { INGREDIENT_BY_ID } from './catalog';
import { avoidedDish } from './dishes';
import { nameHasWord } from './itemRules';
import type { MealPlan, PlannedMeal, SlotCell, ValidationIssue } from './plan';
import { swapClosure } from './swap';
import { isVegetable, type ValidateContext } from './validate';

export interface Repair {
  replaceIds: string[]; // the meals to replace, leftover links included, in plan order
  refill: SlotCell[]; // the cells the planner fills: those of the replaced meals, plus cells left with no meal
  reason: string; // the first error's check, for the progress line
}

// Checks a targeted repair can answer. Anything else (macros, waste, cravings, prices, minimum vegetables) gets a full attempt.
const REPAIRABLE = new Set([
  'budget',
  'slot-coverage',
  'unknown-ingredient',
  'never-buy',
  'allergen',
  'never-again',
  'busy',
  'variety',
  'form',
  'avoid-dish',
]);

const cellOf = (c: { day: string; slot: string }) => `${c.day}-${c.slot}`;
const nameKey = (s: string) => s.trim().toLowerCase();

/**
 * What each meal costs: every list item's total is shared among the meals that use its ingredient, by quantity.
 * Used to pick the most expensive meals when the week is over budget.
 */
export function mealCosts(plan: Pick<MealPlan, 'meals' | 'list'>): Map<string, number> {
  const qtyByIngredient = new Map<string, number>();
  for (const m of plan.meals) for (const ing of m.ingredients) qtyByIngredient.set(ing.ingredientId, (qtyByIngredient.get(ing.ingredientId) ?? 0) + ing.qty);
  const totalByIngredient = new Map(plan.list.map((i) => [i.ingredientId, i.total]));
  const costs = new Map<string, number>();
  for (const m of plan.meals) {
    let cost = 0;
    for (const ing of m.ingredients) {
      const total = totalByIngredient.get(ing.ingredientId) ?? 0;
      const all = qtyByIngredient.get(ing.ingredientId) ?? 0;
      if (all > 0) cost += total * (ing.qty / all);
    }
    costs.set(m.id, cost);
  }
  return costs;
}

/** The two most expensive meals that are not eaten as leftovers, when they cost something. */
function mostExpensive(plan: MealPlan): string[] {
  const costs = mealCosts(plan);
  return plan.meals
    .filter((m) => m.usesLeftoversFrom === undefined && (costs.get(m.id) ?? 0) > 0)
    .sort((a, b) => (costs.get(b.id) ?? 0) - (costs.get(a.id) ?? 0))
    .slice(0, 2)
    .map((m) => m.id);
}

/** Meals that break a per-meal rule, by the check that names it. Coverage also names the cells left empty. */
function attribute(check: string, plan: MealPlan, ctx: ValidateContext): { meals: string[]; cells: string[] } {
  const meals: string[] = [];
  const cells: string[] = [];
  const capOf = new Map(ctx.cells.map((c) => [cellOf(c), c.maxMinutes]));
  switch (check) {
    case 'unknown-ingredient':
      for (const m of plan.meals) if (m.ingredients.some((i) => !ctx.available.has(i.ingredientId))) meals.push(m.id);
      break;
    case 'never-buy':
      for (const m of plan.meals) {
        const hit = m.ingredients.some((i) => ctx.neverBuy.has(i.ingredientId));
        const named = (ctx.neverWords ?? []).some((w) => nameHasWord(m.name, w));
        if (hit || named) meals.push(m.id);
      }
      break;
    case 'allergen':
      for (const m of plan.meals) {
        const clash = m.eaters.some((id) => {
          const person = ctx.household.people.find((p) => p.id === id);
          if (!person || person.allergies.length === 0) return false;
          return m.ingredients.some((i) => (INGREDIENT_BY_ID[i.ingredientId]?.allergens ?? []).some((a) => person.allergies.includes(a)));
        });
        if (clash) meals.push(m.id);
      }
      break;
    case 'never-again': {
      const never = new Set((ctx.neverMeals ?? []).map(nameKey));
      for (const m of plan.meals) if (never.has(nameKey(m.name))) meals.push(m.id);
      break;
    }
    case 'form':
      for (const m of plan.meals) if (m.ingredients.some((i) => ctx.formBlocked?.has(i.ingredientId))) meals.push(m.id);
      break;
    case 'avoid-dish':
      for (const m of plan.meals) if (avoidedDish(m.name, ctx.avoidDishes) !== undefined) meals.push(m.id);
      break;
    case 'busy':
      for (const m of plan.meals) {
        const cap = capOf.get(cellOf(m));
        if (cap !== undefined && m.activeMinutes > cap) meals.push(m.id);
      }
      break;
    case 'variety': {
      // Only the two rules that name meals. The minimum-vegetables rule names none, so it gets a full attempt.
      if (ctx.household.varietyRules.minVeg5 === true) break;
      const dinners = plan.meals.filter((m) => m.slot === 'dinner');
      if (ctx.household.varietyRules.noRepeatDinner14 === true) {
        const recent = new Set((ctx.recentDinnerNames ?? []).map(nameKey));
        for (const m of dinners) if (recent.has(nameKey(m.name))) meals.push(m.id);
      }
      if (ctx.household.varietyRules.noRepeatProteinConsecutive === true) {
        const protein = (m: PlannedMeal) => m.ingredients.map((i) => INGREDIENT_BY_ID[i.ingredientId]?.protein).find((p) => p);
        const order = (m: PlannedMeal) => DAYS.indexOf(m.day);
        const byDay = dinners.filter((m) => protein(m) !== undefined).sort((a, b) => order(a) - order(b));
        for (let i = 1; i < byDay.length; i++) {
          const prev = byDay[i - 1]!;
          const cur = byDay[i]!;
          if (order(cur) === order(prev) + 1 && protein(cur) === protein(prev)) meals.push(cur.id);
        }
      }
      break;
    }
    case 'slot-coverage': {
      const count = new Map<string, number>();
      for (const m of plan.meals) count.set(cellOf(m), (count.get(cellOf(m)) ?? 0) + 1);
      const weekCells = new Set(ctx.cells.map(cellOf));
      for (const c of ctx.cells) if (!count.has(cellOf(c))) cells.push(cellOf(c));
      // A cell with two meals, or a meal in a cell nobody eats: both are replaced, and the cell is filled again.
      for (const m of plan.meals) {
        if (!weekCells.has(cellOf(m)) || (count.get(cellOf(m)) ?? 0) > 1) meals.push(m.id);
      }
      break;
    }
  }
  return { meals, cells };
}

/**
 * The repair for a checked attempt, or null when the errors cannot be pinned on meals. Every error must be one a repair
 * can answer, and each must name at least one meal or an empty cell. Budget names the two most expensive meals.
 */
export function repairFor(plan: MealPlan, ctx: ValidateContext, issues: ValidationIssue[]): Repair | null {
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length === 0) return null;
  const checks = [...new Set(errors.map((e) => e.check))];
  if (checks.some((c) => !REPAIRABLE.has(c))) return null;

  const targets = new Set<string>();
  const missing = new Set<string>();
  for (const check of checks) {
    if (check === 'budget') {
      const expensive = mostExpensive(plan);
      if (expensive.length === 0) return null;
      expensive.forEach((id) => targets.add(id));
      continue;
    }
    const found = attribute(check, plan, ctx);
    if (found.meals.length === 0 && found.cells.length === 0) return null;
    found.meals.forEach((id) => targets.add(id));
    found.cells.forEach((k) => missing.add(k));
  }

  const replaceIds = swapClosure(plan.meals, [...targets]);
  const replaced = new Set(replaceIds);
  const refillKeys = new Set([...missing, ...plan.meals.filter((m) => replaced.has(m.id)).map(cellOf)]);
  const refill = ctx.cells.filter((c) => refillKeys.has(cellOf(c)));
  return { replaceIds, refill, reason: errors[0]!.check };
}

