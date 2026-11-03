import {
  INGREDIENT_BY_ID,
  VARIETY_RULES,
  type Deal,
  type FixedCost,
  type FixedPlacement,
  type Household,
  type PlanRequest,
  type SlotCell,
  type ValidationIssue,
} from '@provisions/shared';

export const SYSTEM_PROMPT = [
  'You plan a week of home-cooked meals for a budget-conscious household in Ontario, Canada.',
  'Fill ONLY the meals in `slots`; each lists who eats it. Scale quantities to that headcount. Do not plan `fixedMeals`.',
  'Use ONLY ingredient ids from `available`. Basic seasonings, oil, salt, pepper and common dried spices are assumed on hand; do not list them.',
  'Never use `neverBuy`. Never use an ingredient containing a listed allergen for a meal eaten by that person (`allergies` maps person id to allergens).',
  'Prefer `useFirst` and pantry/fixed-meal leftovers, then higher-scored deals. Respect packQty: plan to use most of each pack bought.',
  'Chain leftovers: at least 2 dinners should produce a later lunch (set makesLeftoversFor / usesLeftoversFrom with meal ids). A leftover meal\'s ingredients list is empty and activeMinutes 5.',
  'Include each craving at least once and tag it \'craving\'.',
  'Balanced dinners: a protein, a vegetable, a grain or starch. Weeknight dinners are 40 active minutes or fewer unless a slot has maxMinutes, which is a hard cap.',
  'Use only methods possible with `equipment`.',
  'Respect `varietyRules` that are true. Avoid `avoid` meals; you may reuse `favourites`.',
  'Quantities are in each ingredient\'s `unit`, as the total for that meal. Do not estimate prices; code computes cost.',
  'If `feedback` is present, the previous plan broke these checks. Fix every error listed there and keep what already worked.',
  'Return the plan only via the submit_plan tool.',
].join('\n');

export const SUBMIT_PLAN_TOOL = {
  name: 'submit_plan',
  description: 'Submit the planned meals for the week. Call this exactly once, with one meal per slot in `slots`.',
  input_schema: {
    type: 'object',
    properties: {
      meals: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique meal id, e.g. "thu-dinner"' },
            slotId: { type: 'string', description: 'The slot id from `slots`, e.g. "thu-dinner"' },
            name: { type: 'string' },
            ingredients: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'An id from `available`' },
                  qty: { type: 'number', description: 'Total for this meal, in the ingredient unit' },
                },
                required: ['id', 'qty'],
              },
            },
            activeMinutes: { type: 'number' },
            usesLeftoversFrom: { type: 'string', description: 'Meal id this meal reuses leftovers from' },
            makesLeftoversFor: { type: 'string', description: 'Meal id that will eat the leftovers' },
            steps: { type: 'array', items: { type: 'string' }, maxItems: 6 },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'slotId', 'name', 'ingredients', 'activeMinutes', 'steps', 'tags'],
        },
      },
      notes: { type: 'string', description: 'Short notes for the household about the week' },
    },
    required: ['meals', 'notes'],
  },
} as const;

export interface AvailableItem {
  id: string;
  name: string;
  unit: string;
  packQty: number;
  score: number;
  source: 'deal' | 'staple' | 'fixed-leftover';
  allergens: string[];
  vegetarian: boolean;
}

/**
 * What the planner may use: one entry per ingredient. Deals and staples come from scoring.
 * Fixed-meal pack remainders are added as 'fixed-leftover', with the remainder as packQty.
 */
export function buildAvailable(deals: Deal[], fixed: FixedCost): AvailableItem[] {
  const byId = new Map<string, AvailableItem>();
  for (const d of deals) {
    const ing = INGREDIENT_BY_ID[d.ingredientId];
    if (!ing) continue;
    const source = d.staple ? 'staple' : 'deal';
    const prev = byId.get(d.ingredientId);
    if (prev && prev.score >= d.score) continue;
    byId.set(d.ingredientId, {
      id: ing.id,
      name: ing.name,
      unit: ing.baseUnit,
      packQty: d.packQty,
      score: Number(d.score.toFixed(3)),
      source,
      allergens: ing.allergens,
      vegetarian: ing.vegetarian,
    });
  }
  for (const l of fixed.leftovers) {
    if (byId.has(l.ingredientId)) continue;
    const ing = INGREDIENT_BY_ID[l.ingredientId];
    if (!ing) continue;
    byId.set(l.ingredientId, {
      id: ing.id,
      name: ing.name,
      unit: ing.baseUnit,
      packQty: Number(l.qty.toFixed(3)),
      score: 0,
      source: 'fixed-leftover',
      allergens: ing.allergens,
      vegetarian: ing.vegetarian,
    });
  }
  return [...byId.values()];
}

export interface PayloadInput {
  household: Household;
  request: PlanRequest;
  cells: SlotCell[];
  fixed: FixedPlacement[];
  fixedCost: FixedCost;
  available: AvailableItem[];
  neverBuy: string[];
  recentDinnerNames: string[];
}

export interface PlannerPayload {
  weekOf: string;
  slots: { id: string; day: string; slot: string; eaters: string[]; maxMinutes?: number }[];
  fixedMeals: { name: string; day: string; slot: string; eaters: string[] }[];
  people: { id: string; name: string; proteinTargetG?: number; dietTags: string[] }[];
  allergies: Record<string, string[]>;
  remainingBudget: number;
  cravings: string[];
  neverBuy: string[];
  equipment: string[];
  varietyRules: { key: string; label: string }[];
  available: AvailableItem[];
  useFirst: string[];
  favourites: string[];
  avoid: string[];
  feedback: ValidationIssue[] | null;
}

export function buildPayload(input: PayloadInput): PlannerPayload {
  const { household, request } = input;
  const names = new Map(household.fixedMeals.map((m) => [m.id, m.name]));
  const noRepeat = household.varietyRules.noRepeatDinner14 === true;
  return {
    weekOf: request.weekOf,
    slots: input.cells.map((c) => ({
      id: `${c.day}-${c.slot}`,
      day: c.day,
      slot: c.slot,
      eaters: c.eaters,
      ...(c.maxMinutes !== undefined ? { maxMinutes: c.maxMinutes } : {}),
    })),
    fixedMeals: input.fixed.map((p) => ({
      name: names.get(p.fixedMealId) ?? p.fixedMealId,
      day: p.day,
      slot: p.slot,
      eaters: p.eaters,
    })),
    people: household.people.map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.proteinTargetG !== undefined ? { proteinTargetG: p.proteinTargetG } : {}),
      dietTags: p.dietTags,
    })),
    allergies: Object.fromEntries(household.people.map((p) => [p.id, p.allergies])),
    remainingBudget: Math.max(0, Math.round((request.budget - input.fixedCost.cost) * 100) / 100),
    cravings: request.cravings,
    neverBuy: input.neverBuy,
    equipment: household.equipment.filter((e) => e.owned).map((e) => e.name),
    varietyRules: VARIETY_RULES.filter((r) => household.varietyRules[r.key] === true).map((r) => ({ key: r.key, label: r.label })),
    available: input.available,
    useFirst: request.useItUp ? input.available.filter((a) => a.source === 'fixed-leftover').map((a) => a.id) : [],
    favourites: [],
    avoid: noRepeat ? input.recentDinnerNames : [],
    feedback: null,
  };
}
