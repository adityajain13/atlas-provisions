import {
  DAYS,
  INGREDIENT_BY_ID,
  VARIETY_RULES,
  type Day,
  type Deal,
  type PantryItem,
  type FixedCost,
  type FixedPlacement,
  type Household,
  type PlanRequest,
  type SlotCell,
  type ValidationIssue,
} from '@provisions/shared';
import { PREP_RULES, PREP_STEP_PROPERTIES } from './prep';

export const SYSTEM_PROMPT = [
  'You plan a week of home-cooked meals for a budget-conscious household in Ontario, Canada.',
  'Fill ONLY the meals in `slots`; each lists who eats it. Scale quantities to that headcount. Do not plan `fixedMeals`.',
  'Use ONLY ingredient ids from `available`. Basic seasonings, oil, salt, pepper and common dried spices are assumed on hand; do not list them.',
  'Never use `neverBuy`. Never use an ingredient containing a listed allergen for a meal eaten by that person (`allergies` maps person id to allergens).',
  "Never plan a meal built around a word in `neverBuyWords` (e.g. 'beef' rules out a beef stir-fry) even if no listed ingredient contains it.",
  'Prefer `useFirst` and pantry/fixed-meal leftovers, then higher-scored deals. Respect packQty: plan to use most of each pack bought.',
  'Chain leftovers: at least 2 dinners should produce a later lunch (set makesLeftoversFor / usesLeftoversFrom with meal ids). A leftover meal\'s ingredients list is empty and activeMinutes 5.',
  'Include each craving at least once and tag it \'craving\'.',
  "Tags are short descriptors like 'craving', 'vegetarian', 'quick' — never the meal slot name.",
  'Meal names describe the dish only: no portion counts or notes like \'(2 portions)\' or \'x2\'.',
  'Balanced dinners: a protein, a vegetable, a grain or starch. Weeknight dinners are 40 active minutes or fewer unless a slot has maxMinutes, which is a hard cap.',
  'Use only methods possible with `equipment`.',
  'Respect `varietyRules` that are true. Avoid `avoid` meals; you may reuse `favourites`.',
  'Quantities are in each ingredient\'s `unit`, as the total for that meal. Do not estimate prices; code computes cost.',
  'For `each` ingredients, qty counts packages or pieces as sold (see eachMeans), never slices or servings: two people having toast all week is 1 loaf, not 7.',
  'If `feedback` is present, the previous plan broke these checks. Fix every error listed there and keep what already worked.',
  'Batch prep: when `prepDay` is set, also return `prep` for that day, following the prep rules below.',
  ...PREP_RULES.map((rule) => `Prep rule: ${rule}`),
  'If `prepDay` is null, omit `prep`.',
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
            id: { type: 'string', description: 'Unique meal id, e.g. "sun-dinner"' },
            slotId: { type: 'string', description: 'The slot id from `slots`, e.g. "sun-dinner"' },
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
      prep: {
        type: 'object',
        description: "Batch-prep list for the household's prep day, only when payload.prepDay is set.",
        properties: {
          day: { type: 'string', enum: [...DAYS], description: 'The prep day, as given in `prepDay` (its key)' },
          steps: {
            type: 'array',
            maxItems: 30,
            items: {
              type: 'object',
              properties: PREP_STEP_PROPERTIES,
              required: ['task', 'minutes', 'forMeals', 'day', 'storage'],
            },
          },
        },
        required: ['day', 'steps'],
      },
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
  source: 'deal' | 'staple' | 'pantry' | 'fixed-leftover';
  allergens: string[];
  vegetarian: boolean;
  shelfLifeDays: number;
  eachMeans?: string; // for `each` items: what one unit of qty is, as sold
}

/** What one `each` unit means for this ingredient, from its catalogue weight. */
export function eachMeansFor(ing: { baseUnit: string; eachWeightKg?: number; eachLabel?: string }): string | undefined {
  if (ing.baseUnit !== 'each') return undefined;
  if (ing.eachWeightKg === undefined) return '1 = one item as sold (a loaf, a bunch, a dozen eggs carton, one pepper)';
  const grams = Math.round(ing.eachWeightKg * 1000);
  return `1 = ${ing.eachLabel ?? 'one item'} as sold (~${grams} g)`;
}

/**
 * What the planner may use: one entry per ingredient. Deals and staples come from scoring.
 * Pantry stock is added as 'pantry' with its quantity as packQty and score 1, so it beats a deal
 * for the same ingredient. Fixed-meal pack remainders are added as 'fixed-leftover', with the
 * remainder as packQty, when nothing else covers the ingredient.
 */
export function buildAvailable(deals: Deal[], fixed: FixedCost, pantry: PantryItem[] = []): AvailableItem[] {
  const byId = new Map<string, AvailableItem>();
  const entry = (
    ingredientId: string,
    packQty: number,
    score: number,
    source: AvailableItem['source'],
  ): AvailableItem | null => {
    const ing = INGREDIENT_BY_ID[ingredientId];
    if (!ing) return null;
    const eachMeans = eachMeansFor(ing);
    return {
      id: ing.id,
      name: ing.name,
      unit: ing.baseUnit,
      packQty,
      score,
      source,
      allergens: ing.allergens,
      vegetarian: ing.vegetarian,
      shelfLifeDays: ing.shelfLifeDays,
      ...(eachMeans ? { eachMeans } : {}),
    };
  };
  for (const d of deals) {
    const source = d.staple ? 'staple' : 'deal';
    const prev = byId.get(d.ingredientId);
    if (prev && prev.score >= d.score) continue;
    const item = entry(d.ingredientId, d.packQty, Number(d.score.toFixed(3)), source);
    if (item) byId.set(d.ingredientId, item);
  }
  const stock = new Map<string, number>();
  for (const item of pantry) stock.set(item.ingredientId, (stock.get(item.ingredientId) ?? 0) + item.qty);
  for (const [ingredientId, qty] of stock) {
    const prev = byId.get(ingredientId);
    if (prev && prev.score >= 1) continue;
    const item = entry(ingredientId, Number(qty.toFixed(3)), 1, 'pantry');
    if (item) byId.set(ingredientId, item);
  }
  for (const l of fixed.leftovers) {
    if (byId.has(l.ingredientId)) continue;
    const item = entry(l.ingredientId, Number(l.qty.toFixed(3)), 0, 'fixed-leftover');
    if (item) byId.set(l.ingredientId, item);
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
  pantryUseFirst?: string[]; // ingredient ids from pantry stock due soon
  favourites?: string[]; // meal names the household has liked
  avoid?: string[]; // meal names to skip, from ratings
  neverBuyWords?: string[]; // never-buy names as typed, e.g. "beef"
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
  neverBuyWords: string[];
  equipment: string[];
  varietyRules: { key: string; label: string }[];
  available: AvailableItem[];
  useFirst: string[];
  favourites: string[];
  avoid: string[];
  feedback: ValidationIssue[] | null;
  prepDay: Day | null;
}

export function buildPayload(input: PayloadInput): PlannerPayload {
  const { household, request } = input;
  const names = new Map(household.fixedMeals.map((m) => [m.id, m.name]));
  const noRepeat = household.varietyRules.noRepeatDinner14 === true;
  return {
    weekOf: request.weekOf,
    prepDay: household.prepDay,
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
    neverBuyWords: input.neverBuyWords ?? [],
    equipment: household.equipment.filter((e) => e.owned).map((e) => e.name),
    varietyRules: VARIETY_RULES.filter((r) => household.varietyRules[r.key] === true).map((r) => ({ key: r.key, label: r.label })),
    available: input.available,
    useFirst: request.useItUp
      ? [
          ...new Set([
            ...input.available.filter((a) => a.source === 'fixed-leftover').map((a) => a.id),
            ...(input.pantryUseFirst ?? []),
          ]),
        ]
      : [],
    favourites: input.favourites ?? [],
    avoid: [...new Set([...(noRepeat ? input.recentDinnerNames : []), ...(input.avoid ?? [])])],
    feedback: null,
  };
}
