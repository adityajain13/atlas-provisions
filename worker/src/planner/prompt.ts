import {
  DAYS,
  INGREDIENT_BY_ID,
  MONTH_NAMES,
  VARIETY_RULES,
  formOf,
  monthOfWeek,
  seasonStatus,
  type Day,
  type Deal,
  type FeedbackSignals,
  type FoodForm,
  type EstimateBasis,
  type PantryItem,
  type FixedCost,
  type FixedPlacement,
  type Household,
  type PlanRequest,
  type SlotCell,
  type Storage,
  type ValidationIssue,
  cuisineMixOf,
} from '@provisions/shared';
import { PREP_RULES, PREP_STEP_PROPERTIES } from './prep';

/** Most leftover chains the planner is asked for: lunches that eat a previous day's dinner. */
const LEFTOVER_CHAIN_CAP = 2;
/** Shelf life under this many days is sent per item; longer ones are left out. */
const SHORT_SHELF_DAYS = 7;

/** The rules every week is planned by. `prep` and `leftovers` add their rules when the week has them. */
function baseRules(opts: { prep: boolean; leftovers: boolean }): string[] {
  return [
    'You plan a week of home-cooked meals for a budget-conscious household in Ontario, Canada.',
    'Fill ONLY the meals in `slots`; each lists who eats it. Scale quantities to that headcount. Do not plan `fixedMeals`.',
    'Use ONLY ingredient ids from `available`, which holds everything the household may buy or use. Only salt, pepper, oil and water are assumed. Items with `shelfLifeDays` keep under a week; the rest keep longer.',
    "Plan dinners as authentic home-style dishes from the cuisines in cuisineMix: roughly half from 'often', most of the rest from 'sometimes', at most one from 'rarely', none from 'never'. No cuisine more than 3 dinners a week. Label each meal with its cuisine in `cuisine`.",
    'Prefer deals; use regular items when a dish needs them. Each available item shows packPrice (0 when on hand or already bought); keep the week near remainingBudget (about perMealTarget per meal, which is remainingBudget over the meals to fill).',
    "Never plan a meal built around a word in `neverBuyWords` (e.g. 'beef' rules out a beef stir-fry), even if no listed ingredient contains it. Never use an ingredient containing a listed allergen for a meal eaten by that person (`allergies` maps person id to allergens).",
    'Prefer `useFirst` and pantry/fixed-meal leftovers, then higher-scored deals. Respect packQty: plan to use most of each pack bought.',
    ...(opts.leftovers
      ? [`Chain leftovers: make \`leftoverChains\` dinners produce a later lunch (set makesLeftoversFor / usesLeftoversFrom with meal ids).`]
      : []),
    "A leftover meal's ingredients and steps lists are empty and activeMinutes 5.",
    "Cravings: a dish craving (e.g. 'butter chicken', 'ramen') is a meal name: plan at least one such dinner and tag it 'craving'. An ingredient craving (e.g. 'chicken', 'tofu') is a main ingredient in at least a third of the dinners (at least 2, rounded up; fewer when several ingredient cravings share the week), listed in those meals' ingredients.",
    'cravingDinners assigns dinners to ingredient cravings: make that craving a main ingredient of that day\'s dinner (other dinners may also use it).',
    'Balance: every lunch and dinner that is not a leftover meal has a substantial protein (meat, fish, eggs, tofu, paneer or legumes). Unless someone is vegetarian, at most 2 dinners a week have no meat or fish.',
    'Seasonality: payload.month is the plan month. When preferSeasonal: avoid produce marked outOfSeason or imported unless it is on a flyer deal this week; build around in-season and storage produce (root vegetables, squash, cabbage family, apples, citrus in winter).',
    "onHandCustom staples are free: use them in steps when a dish needs them, never in a meal's ingredients, and they never go on the list.",
    "Keep output short: at most 4 steps per meal (under 90 characters each), 2 tags, notes under 200 characters. Tags are short descriptors like 'craving' or 'quick', never the slot name. Meal names describe the dish only: no portion counts or notes like '(2 portions)' or 'x2'.",
    'Balanced dinners: a protein, a vegetable, a grain or starch. Weeknight dinners are 40 active minutes or fewer unless a slot has maxMinutes, which is a hard cap.',
    'Use only methods possible with `equipment`.',
    'Respect `varietyRules` that are true. Avoid `avoid` meals; you may reuse `favourites`.',
    "Never plan a dish in `avoidDishes` or a close variant of it (e.g. 'slaw' rules out coleslaw, cabbage slaw and any raw shredded-cabbage salad). An available item with a `form` is that form.",
    'If `ingredientFeedback` is given: avoid `oftenSkipped` ingredients unless essential (then optional in the steps); use an ingredient\'s `to` (or `toId`) from `preferredSwaps` in its place when available.',
    'Variety matters more than using every bit of a big pack: use a non-staple ingredient in at most 3 meals a week. Ingredients of cravings are exempt from the 3-meal limit. Onions, garlic, rice, oil, butter, eggs, milk, flour, stock, soy sauce, spices and bread are exempt. If a pack (like a whole cabbage) would need more, pick a different vegetable or accept some left over.',
    'Variety rule oneVegDinner ("One vegetarian meal a week", when in varietyRules): one lunch or dinner that week has no meat, fish or seafood.',
    "Quantities are in each ingredient's `unit`, as the total for that meal. Do not estimate prices; code computes cost. For `each` ingredients, qty counts packages or pieces as sold (see eachMeans), never slices or servings: two people having toast all week is 1 loaf, not 7.",
    ...(opts.prep
      ? [
          'Batch prep: when `prepDay` is set, also return `prep` for that day, following the prep rules below.',
          'Steps may refer to prepped items only if they appear in `prep`.',
          ...PREP_RULES.map((rule) => `Prep rule: ${rule}`),
        ]
      : [
          "There is no prep day: every meal's steps must be self-contained — cook rice and other components within the meal, never refer to prepped or batch-cooked items.",
        ]),
    'If `feedback` is present, the previous plan broke these checks: fix every error listed there and keep what already worked.',
    'Return the plan only via the submit_plan tool.',
  ];
}

const SWAP_RULES = (prep: boolean): string[] => [
  'This is a swap: part of a week is already planned and the household is changing only some of its meals.',
  'Fill only the slots listed. Keep every meal in keptMeals exactly as it is; new meals may share leftovers only with other new meals.',
  "Don't reuse any name in `replacing`. Follow swapNote if given.",
  ...(prep ? ["Return the full week's prep list (kept + new meals) in `prep`."] : []),
];

const memo = new Map<string, string>();
const memoised = (key: string, build: () => string): string => {
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const text = build();
  memo.set(key, text);
  return text;
};

/**
 * The system prompt for one kind of week. Prep rules come in only with a prep day; the leftover-chain sentence only when
 * the week has chains to make. Built once per variant, so every attempt of a week sends the same bytes.
 */
export function plannerSystem(opts: { prep: boolean; leftovers: boolean }): string {
  return memoised(`base:${opts.prep ? 1 : 0}${opts.leftovers ? 1 : 0}`, () => baseRules(opts).join('\n'));
}

/** The block added for a swap or repair, where `keptMeals` is in the payload: the rest of the week stays as it is. */
export function swapPrompt(prep: boolean): string {
  return memoised(`swap:${prep ? 1 : 0}`, () => SWAP_RULES(prep).join('\n'));
}

/** The full system prompt for a week with prep and leftover chains: the longest variant. */
export const SYSTEM_PROMPT = plannerSystem({ prep: true, leftovers: true });
export const SWAP_PROMPT = swapPrompt(true);

/** Days of leftover chains a week can make: lunches whose previous-day dinner is a cell of the week, capped. */
export function leftoverChainsOf(cells: SlotCell[]): number {
  const dinnerDays = new Set(cells.filter((c) => c.slot === 'dinner').map((c) => DAYS.indexOf(c.day)));
  const lunches = cells.filter((c) => c.slot === 'lunch' && dinnerDays.has(DAYS.indexOf(c.day) - 1)).length;
  return Math.min(LEFTOVER_CHAIN_CAP, lunches);
}

const SUBMIT_PLAN_SCHEMA = {
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
            activeMinutes: { type: 'number', description: 'Active cooking minutes. A leftover meal is 5.' },
            usesLeftoversFrom: { type: 'string', description: 'Meal id this meal reuses leftovers from' },
            makesLeftoversFor: { type: 'string', description: 'Meal id that will eat the leftovers' },
            steps: {
              type: 'array',
              maxItems: 4,
              items: { type: 'string', description: 'One short cooking step, at most 90 characters' },
              description: 'At most 4 steps. Leftover meals have none.',
            },
            tags: { type: 'array', maxItems: 2, items: { type: 'string' }, description: 'At most 2 short tags' },
            cuisine: { type: 'string', description: 'The cuisine key from cuisineMix that this dinner is from, e.g. "indian"' },
          },
          required: ['id', 'slotId', 'name', 'ingredients', 'activeMinutes', 'steps', 'tags'],
        },
      },
      notes: { type: 'string', description: 'Short notes for the household about the week, at most 200 characters' },
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

export const SUBMIT_PLAN_TOOL = SUBMIT_PLAN_SCHEMA;

export interface SubmitPlanTool {
  name: string;
  description: string;
  input_schema: object;
}

let noPrepTool: SubmitPlanTool | undefined;

/**
 * The submit_plan tool for a week. Without a prep day the `prep` property is left out of the schema: a clone, built once,
 * so the shared tool object is never changed.
 */
export function submitPlanTool(prep: boolean): SubmitPlanTool {
  if (prep) return SUBMIT_PLAN_SCHEMA;
  if (!noPrepTool) {
    const properties = Object.fromEntries(Object.entries(SUBMIT_PLAN_SCHEMA.input_schema.properties).filter(([k]) => k !== 'prep'));
    noPrepTool = { ...SUBMIT_PLAN_SCHEMA, input_schema: { ...SUBMIT_PLAN_SCHEMA.input_schema, properties } };
  }
  return noPrepTool;
}

export interface AvailableItem {
  id: string;
  name: string;
  unit: string;
  packQty: number;
  packPrice: number; // the price the item is scored at, for one pack: a deal, a regular estimate, or 0 when already paid for or free
  score: number;
  // 'on-hand': a staple the household keeps, free. 'regular': no flyer price this week; priced from an estimate.
  source: 'deal' | 'staple' | 'pantry' | 'fixed-leftover' | 'on-hand' | 'regular';
  estimate?: { basis: EstimateBasis }; // for regular items: the price basis it is costed from
  allergens: string[];
  vegetarian: boolean;
  shelfLifeDays: number;
  eachMeans?: string; // for `each` items: what one unit of qty is, as sold
  form?: FoodForm; // for items sold in a form the household's forms apply to
  imported?: true; // tropical or always-imported produce
  outOfSeason?: true; // produce not in season this month (with preferSeasonal)
}

/** What one `each` unit means for this ingredient, from its catalogue weight. */
export function eachMeansFor(ing: { baseUnit: string; eachWeightKg?: number; eachLabel?: string }): string | undefined {
  if (ing.baseUnit !== 'each') return undefined;
  if (ing.eachWeightKg === undefined) return '1 = one item as sold (a loaf, a bunch, a dozen eggs carton, one pepper)';
  const grams = Math.round(ing.eachWeightKg * 1000);
  return `1 = ${ing.eachLabel ?? 'one item'} as sold (~${grams} g)`;
}

/** Extra items for the planner, after deals, pantry and fixed-meal leftovers. */
export interface AvailableExtras {
  onHand?: string[]; // catalogue ids the household keeps: free, so they replace a deal for the same ingredient
  regular?: { id: string; packQty: number; packPrice: number; basis?: EstimateBasis }[]; // regular-priced items, added only when nothing else covers them
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * What the planner may use: one entry per ingredient. Deals and staples come from scoring.
 * Pantry stock is added as 'pantry' with its quantity as packQty and score 1, so it beats a deal
 * for the same ingredient. Fixed-meal pack remainders are added as 'fixed-leftover', with the
 * remainder as packQty, when nothing else covers the ingredient. On-hand staples are added as 'on-hand'
 * (free), unless pantry stock covers them. Regular items are added last, as 'regular'.
 */
export function buildAvailable(deals: Deal[], fixed: FixedCost, pantry: PantryItem[] = [], extras: AvailableExtras = {}): AvailableItem[] {
  const byId = new Map<string, AvailableItem>();
  const entry = (
    ingredientId: string,
    packQty: number,
    packPrice: number,
    score: number,
    source: AvailableItem['source'],
  ): AvailableItem | null => {
    const ing = INGREDIENT_BY_ID[ingredientId];
    if (!ing) return null;
    const eachMeans = eachMeansFor(ing);
    const form = formOf(ing.id);
    return {
      id: ing.id,
      name: ing.name,
      unit: ing.baseUnit,
      packQty,
      packPrice: cents(packPrice),
      score,
      source,
      allergens: ing.allergens,
      vegetarian: ing.vegetarian,
      shelfLifeDays: ing.shelfLifeDays,
      ...(eachMeans ? { eachMeans } : {}),
      ...(form ? { form } : {}),
    };
  };
  for (const d of deals) {
    const source = d.staple ? 'staple' : 'deal';
    const prev = byId.get(d.ingredientId);
    if (prev && prev.score >= d.score) continue;
    const item = entry(d.ingredientId, d.packQty, d.packPrice, Number(d.score.toFixed(3)), source);
    if (item) byId.set(d.ingredientId, item);
  }
  const stock = new Map<string, number>();
  for (const item of pantry) stock.set(item.ingredientId, (stock.get(item.ingredientId) ?? 0) + item.qty);
  for (const [ingredientId, qty] of stock) {
    const prev = byId.get(ingredientId);
    if (prev && prev.score >= 1) continue;
    const item = entry(ingredientId, Number(qty.toFixed(3)), 0, 1, 'pantry');
    if (item) byId.set(ingredientId, item);
  }
  for (const l of fixed.leftovers) {
    if (byId.has(l.ingredientId)) continue;
    const item = entry(l.ingredientId, Number(l.qty.toFixed(3)), 0, 0, 'fixed-leftover');
    if (item) byId.set(l.ingredientId, item);
  }
  for (const id of extras.onHand ?? []) {
    if (byId.get(id)?.source === 'pantry') continue;
    const item = entry(id, 1, 0, 0, 'on-hand');
    if (item) byId.set(id, item);
  }
  for (const r of extras.regular ?? []) {
    if (byId.has(r.id)) continue;
    const item = entry(r.id, Number(r.packQty.toFixed(3)), r.packPrice, 0, 'regular');
    if (!item) continue;
    byId.set(r.id, r.basis ? { ...item, estimate: { basis: r.basis } } : item);
  }
  return [...byId.values()];
}

/** A meal that stays in the week during a swap. The planner must not change it. */
export interface KeptMealPayload {
  id: string;
  day: string;
  slot: string;
  name: string;
  ingredients: { id: string; qty: number; unit: string }[];
  usesLeftoversFrom?: string;
  makesLeftoversFor?: string;
}

export interface PayloadInput {
  household: Household;
  request: PlanRequest;
  cells: SlotCell[]; // the cells to fill: the whole week, or only the slots being swapped
  fixed: FixedPlacement[];
  fixedCost: FixedCost;
  available: AvailableItem[];
  recentDinnerNames: string[];
  pantryUseFirst?: string[]; // ingredient ids from pantry stock due soon
  favourites?: string[]; // meal names the household has liked
  avoid?: string[]; // meal names to skip, from ratings
  neverBuyWords?: string[]; // never-buy names as typed, e.g. "beef"
  // Swap only: the meals that stay, what they cost, the names being replaced, and the household's note.
  keptMeals?: KeptMealPayload[];
  keptCost?: number;
  replacing?: string[];
  swapNote?: string;
  issues?: ValidationIssue[]; // the previous attempt's errors, for a retry or repair
  feedback?: FeedbackSignals; // skipped and replaced ingredients, from past meals
  guests?: Record<string, { allergies: string[] }>; // guests who joined swapped meals: their ids are eaters, and their allergies go in `allergies`
  cravingDinners?: Partial<Record<Day, string>>; // a new plan's assignment of ingredient cravings to dinners, for the days being written
}

/** One available item as the planner sees it: the fields it needs, and only the ones that carry something. */
export interface PayloadItem {
  id: string;
  name: string;
  unit: string;
  packQty: number;
  packPrice: number;
  score: number;
  source: AvailableItem['source'];
  estimate?: { basis: EstimateBasis };
  allergens?: string[];
  vegetarian?: boolean;
  shelfLifeDays?: number;
  eachMeans?: string;
  form?: FoodForm;
  imported?: true;
  outOfSeason?: true;
}

export interface PlannerPayload {
  weekOf: string;
  remainingBudget: number;
  perMealTarget?: number; // remainingBudget over the meals to fill, when there are meals to fill
  slots: { id: string; day: string; slot: string; eaters: string[]; maxMinutes?: number }[];
  leftoverChains?: number; // lunches that can eat a previous day's dinner, when this is a new plan
  fixedMeals: { name: string; day: string; slot: string; eaters: string[] }[];
  people: { id: string; name: string; proteinTargetG?: number; dietTags?: string[] }[];
  allergies?: Record<string, string[]>;
  cravings?: string[];
  month: string; // the plan month, by name, from the week's Sunday
  preferSeasonal: boolean;
  onHandCustom?: string[]; // staples with no catalogue id: free, named in steps only
  neverBuyWords?: string[];
  equipment?: string[];
  varietyRules?: { key: string; label: string }[];
  available: PayloadItem[];
  useFirst?: string[];
  favourites?: string[];
  avoid?: string[];
  avoidDishes?: string[]; // dish words the household does not want, as typed
  cuisineMix: Record<'often' | 'sometimes' | 'rarely' | 'never', string[]>; // cuisine keys at each level, from the household's ranking
  storage: Storage;
  ingredientFeedback?: FeedbackSignals; // what the household skipped or replaced in past meals, when there is any
  prepDay?: Day; // only when the household has a prep day
  cravingDinners?: Partial<Record<Day, string>>; // the dinner each ingredient craving must feature in, by day key
  keptMeals?: KeptMealPayload[];
  replacing?: string[];
  swapNote?: string;
  feedback?: ValidationIssue[]; // the previous attempt's errors, present on a retry or repair only
}

/** Season flags for one produce item: outOfSeason when the month is not in its season, imported when it is imported. */
export function seasonFlags(id: string, month: number, preferSeasonal: boolean): Pick<AvailableItem, 'imported' | 'outOfSeason'> {
  const status = seasonStatus(id, month);
  if (!status) return {};
  return {
    ...(status.imported ? { imported: true as const } : {}),
    ...(preferSeasonal && status.outOfSeason ? { outOfSeason: true as const } : {}),
  };
}

const hasVegetarian = (household: Household) => household.people.some((p) => p.dietTags.some((t) => /vegetarian|vegan/i.test(t)));

function payloadItem(a: AvailableItem, month: number, household: Household): PayloadItem {
  return {
    id: a.id,
    name: a.name,
    unit: a.unit,
    packQty: a.packQty,
    packPrice: a.packPrice,
    score: a.score,
    source: a.source,
    ...(a.estimate ? { estimate: a.estimate } : {}),
    ...(a.allergens.length > 0 ? { allergens: a.allergens } : {}),
    ...(hasVegetarian(household) ? { vegetarian: a.vegetarian } : {}),
    ...(a.shelfLifeDays < SHORT_SHELF_DAYS ? { shelfLifeDays: a.shelfLifeDays } : {}),
    ...(a.eachMeans ? { eachMeans: a.eachMeans } : {}),
    ...(a.form ? { form: a.form } : {}),
    ...seasonFlags(a.id, month, household.preferSeasonal),
  };
}

export function buildPayload(input: PayloadInput): PlannerPayload {
  const { household, request } = input;
  const names = new Map(household.fixedMeals.map((m) => [m.id, m.name]));
  const noRepeat = household.varietyRules.noRepeatDinner14 === true;
  const month = monthOfWeek(request.weekOf);
  const remaining = Math.max(0, Math.round((request.budget - input.fixedCost.cost - (input.keptCost ?? 0)) * 100) / 100);
  const allergies = {
    ...Object.fromEntries(household.people.map((p) => [p.id, p.allergies])),
    ...Object.fromEntries(Object.entries(input.guests ?? {}).map(([id, g]) => [id, g.allergies])),
  };
  const withAllergies = Object.entries(allergies).filter(([, a]) => a.length > 0);
  const avoid = [...new Set([...(noRepeat ? input.recentDinnerNames : []), ...(input.avoid ?? [])])];
  const equipment = household.equipment.filter((e) => e.owned).map((e) => e.name);
  const varietyRules = VARIETY_RULES.filter((r) => household.varietyRules[r.key] === true).map((r) => ({ key: r.key, label: r.label }));
  const useFirst = request.useItUp
    ? [
        ...new Set([
          ...input.available.filter((a) => a.source === 'fixed-leftover').map((a) => a.id),
          ...(input.pantryUseFirst ?? []),
        ]),
      ]
    : [];
  const feedback = input.feedback ?? { oftenSkipped: [], preferredSwaps: [] };
  const hasFeedback = feedback.oftenSkipped.length > 0 || feedback.preferredSwaps.length > 0;
  // Leftover chains are for a new plan only: a swap or repair keeps its meals as they are.
  const chains = input.keptMeals === undefined ? leftoverChainsOf(input.cells) : 0;

  const payload: PlannerPayload = {
    weekOf: request.weekOf,
    remainingBudget: remaining,
    ...(input.cells.length > 0 ? { perMealTarget: cents(remaining / input.cells.length) } : {}),
    slots: input.cells.map((c) => ({
      id: `${c.day}-${c.slot}`,
      day: c.day,
      slot: c.slot,
      eaters: c.eaters,
      ...(c.maxMinutes !== undefined ? { maxMinutes: c.maxMinutes } : {}),
    })),
    ...(chains > 0 ? { leftoverChains: chains } : {}),
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
      ...(p.dietTags.length > 0 ? { dietTags: p.dietTags } : {}),
    })),
    ...(withAllergies.length > 0 ? { allergies: Object.fromEntries(withAllergies) } : {}),
    ...(request.cravings.length > 0 ? { cravings: request.cravings } : {}),
    month: MONTH_NAMES[month - 1] ?? '',
    preferSeasonal: household.preferSeasonal,
    ...(household.onHandCustom.length > 0 ? { onHandCustom: household.onHandCustom } : {}),
    ...(input.neverBuyWords && input.neverBuyWords.length > 0 ? { neverBuyWords: input.neverBuyWords } : {}),
    ...(equipment.length > 0 ? { equipment } : {}),
    ...(varietyRules.length > 0 ? { varietyRules } : {}),
    available: input.available.map((a) => payloadItem(a, month, household)),
    ...(useFirst.length > 0 ? { useFirst } : {}),
    ...(input.favourites && input.favourites.length > 0 ? { favourites: input.favourites } : {}),
    ...(avoid.length > 0 ? { avoid } : {}),
    ...(household.avoidDishes.length > 0 ? { avoidDishes: household.avoidDishes } : {}),
    cuisineMix: cuisineMixOf(household.cuisines),
    storage: household.storage,
    ...(hasFeedback ? { ingredientFeedback: feedback } : {}),
    ...(household.prepDay ? { prepDay: household.prepDay } : {}),
    ...(input.cravingDinners && Object.keys(input.cravingDinners).length > 0 ? { cravingDinners: input.cravingDinners } : {}),
    ...(input.keptMeals
      ? {
          keptMeals: input.keptMeals,
          replacing: input.replacing ?? [],
          ...(input.swapNote ? { swapNote: input.swapNote } : {}),
        }
      : {}),
    ...(input.issues && input.issues.length > 0 ? { feedback: input.issues } : {}),
  };
  return payload;
}

/** Fields that change between attempts of one week. Everything else in the payload is the same on every attempt. */
const VARIABLE_KEYS: ReadonlySet<string> = new Set([
  'weekOf',
  'remainingBudget',
  'perMealTarget',
  'slots',
  'leftoverChains',
  'cravingDinners',
  'feedback',
  'keptMeals',
  'replacing',
  'swapNote',
]);

/**
 * Splits a payload into the part every attempt shares (sent first, cached) and the part that varies (sent after it).
 * Keys are sorted, so the same payload always produces the same bytes.
 */
export function splitPayload(payload: PlannerPayload): { stable: Record<string, unknown>; variable: Record<string, unknown> } {
  const keys = Object.keys(payload).sort();
  const stable: Record<string, unknown> = {};
  const variable: Record<string, unknown> = {};
  for (const k of keys) {
    const value = (payload as unknown as Record<string, unknown>)[k];
    (VARIABLE_KEYS.has(k) ? variable : stable)[k] = value;
  }
  return { stable, variable };
}
