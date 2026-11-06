import {
  DAYS,
  DAY_LONG,
  ESTIMATE_PRIORITY,
  INGREDIENT_BY_ID,
  SLOTS,
  blockedFormIds,
  featuredIdsOf,
  regularCandidates,
  typicalOffers,
  buildList,
  costFixedMeals,
  pinsOf,
  expandWeek,
  expiringSoon,
  nameHasWord,
  repairFor,
  round2,
  swapClosure,
  toPlannedMeals,
  torontoDate,
  usableItems,
  validate,
  type AttemptTiming,
  type BuildListOptions,
  type Day,
  type Deal,
  type EstimateBasis,
  type FeedbackSignals,
  type Offer,
  type FixedCost,
  type FixedPlacement,
  type Household,
  type MatchedItem,
  type MealPlan,
  type PantryItem,
  type PlanTimings,
  type PlannedMeal,
  type PlanRequest,
  prepTimingIssues,
  type PrepPlan,
  type RatingSignals,
  type RawPlan,
  type Repair,
  type SlotCell,
  type ValidationIssue,
  type ValidateContext,
} from '@provisions/shared';
import {
  buildAvailable,
  buildPayload,
  leftoverChainsOf,
  plannerSystem,
  swapPrompt,
  type AvailableItem,
  type KeptMealPayload,
  type PlannerPayload,
} from './prompt';
import type { PlannerClient, SystemText } from './claude';
import { normalisePrep } from './prep';

/** Most regular-priced items the planner is offered at once. */
export const REGULAR_LIMIT = 40;

/** No new attempt starts once this much time has passed since the first one. The best attempt so far is kept. */
export const ATTEMPT_TIME_LIMIT_MS = 150_000;

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
  feedback?: FeedbackSignals; // ingredients skipped often, and swaps the household makes
  estimates?: Offer[]; // site and receipt prices, used where no flyer prices a store
  guests?: Record<string, { allergies: string[] }>; // guests who joined swapped meals, with their allergies
  today?: string; // YYYY-MM-DD on the Toronto calendar; defaults to today
  maxAttempts?: number;
  onProgress?: (p: PlanProgress) => void;
  now?: () => number; // clock for the timings; defaults to Date.now
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
  feedback: FeedbackSignals;
  cells: SlotCell[]; // every cell of the week
  placements: FixedPlacement[];
  fixedCost: FixedCost;
  fixedMeals: MealPlan['fixedMeals'];
  available: AvailableItem[];
  formBlocked: ReadonlySet<string>; // ingredient ids in a form the household does not keep: not planned, not bought
  listOptions: BuildListOptions; // store preference, pins and estimates, for buildList
  guests: Record<string, { allergies: string[] }>; // every guest on the plan, kept with the plan and checked for allergies
  notes: ValidationIssue[]; // warnings about the request itself, such as a craving the household never buys
}

type FrameInput = Omit<RunInput, 'client' | 'maxAttempts' | 'onProgress' | 'now'>;

/** Enabled store names, or every store in the flyer data when none is enabled. */
function storeNames(household: Household, deals: Deal[], matched: MatchedItem[]): string[] {
  const enabled = household.stores.filter((s) => s.enabled).map((s) => s.name);
  if (enabled.length > 0) return enabled;
  return [...new Set([...deals.map((d) => d.store), ...matched.map((m) => m.store)])];
}

/** The week's cells, fixed placements, costs and what the planner may use, for the request as saved. */
export function weekFrame(input: FrameInput): WeekFrame {
  const { household } = input;
  const today = input.today ?? torontoDate();
  const pantry = usableItems(input.pantry ?? [], today);
  const ratings = input.ratings ?? { favourites: [], avoid: [], never: [] };
  // Never-buy names as typed. The planner must not build a meal around one, listed ingredient or not.
  const neverWords = household.itemRules.filter((r) => r.rule === 'never').map((r) => r.name);
  // Forms the household does not keep are taken out of the prices and the planner's choices, so they are neither planned nor bought.
  const formBlocked = blockedFormIds(household.forms);
  const neverSet = new Set(input.neverBuy);
  // A craving the household never buys cannot be planned: it is dropped, with a warning, before anything is built from it.
  const cravingBlocked = (craving: string) => {
    const ids = [...featuredIdsOf(craving)];
    const allBlocked = ids.length > 0 && ids.every((id) => neverSet.has(id) || formBlocked.has(id));
    return allBlocked || neverWords.some((w) => nameHasWord(craving, w));
  };
  const notes: ValidationIssue[] = input.request.cravings.filter(cravingBlocked).map((c) => ({
    check: 'cravings',
    severity: 'warning',
    message: `Craving "${c}" is on your never-buy list, so it is not planned.`,
  }));
  const request: PlanRequest = { ...input.request, cravings: input.request.cravings.filter((c) => !cravingBlocked(c)) };
  const kept = <T extends { ingredientId: string }>(items: T[]) => items.filter((i) => !formBlocked.has(i.ingredientId));
  const deals = kept(input.deals);
  const matched = kept(input.matched);
  const { cells, fixed: placements } = expandWeek(household, request);
  // Typical prices are the last estimate for every ingredient, at the household's top-ranked enabled store.
  const topStore = household.stores.find((s) => s.enabled)?.name;
  const estimates = [...kept(input.estimates ?? []), ...typicalOffers(topStore)];
  // Kept staples: free, never listed. A staple the household may not eat (never-buy, an allergen, a form it does not keep) is left out.
  const allergens = new Set(household.people.flatMap((p) => p.allergies));
  const onHand = household.onHand.filter((id) => {
    const ing = INGREDIENT_BY_ID[id];
    return ing !== undefined && !formBlocked.has(id) && !neverSet.has(id) && !ing.allergens.some((a) => allergens.has(a));
  });
  const onHandSet = new Set(onHand);
  const fixedCost = costFixedMeals(placements, household, deals, matched, estimates, onHandSet);
  const names = new Map(household.fixedMeals.map((m) => [m.id, m.name]));
  return {
    household,
    request,
    deals,
    matched,
    formBlocked,
    stores: storeNames(household, input.deals, input.matched),
    priceMatchStores: household.stores.filter((s) => s.enabled && s.priceMatches).map((s) => s.name),
    neverBuy: input.neverBuy,
    neverWords,
    recentDinnerNames: input.recentDinnerNames,
    pantry,
    dueSoon: request.useItUp ? expiringSoon(pantry, today) : [],
    ratings,
    feedback: input.feedback ?? { oftenSkipped: [], preferredSwaps: [] },
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
    // Never-buy and blocked-form ids are left out of everything the planner may use, pantry stock and leftovers included.
    available: buildAvailable(deals, fixedCost, pantry, {
      onHand,
      regular: regularItems(household, { neverBuy: neverSet, blocked: formBlocked, allergens, deals, pantry, matched, estimates, onHand }),
    }).filter((a) => !formBlocked.has(a.id) && !neverSet.has(a.id)),
    listOptions: { preference: household.storePreference, pins: pinsOf(household.itemRules), estimates, onHand },
    guests: input.guests ?? {},
    notes,
  };
}

/**
 * Regular-priced items for the planner: the fresh and pantry staples of the household's cuisines, skipping anything already
 * on offer (a deal, pantry stock, a flyer price, a kept staple), never-buy and blocked-form ids and allergens. Each is
 * priced from the first estimate it has (site, receipt, then typical), so it always has a pack size.
 */
function regularItems(
  household: Household,
  f: {
    neverBuy: ReadonlySet<string>;
    blocked: ReadonlySet<string>;
    allergens: ReadonlySet<string>;
    deals: Deal[];
    pantry: PantryItem[];
    matched: MatchedItem[];
    estimates: Offer[];
    onHand: string[];
  },
): { id: string; packQty: number; packPrice: number; basis: EstimateBasis }[] {
  const exclude = new Set<string>([
    ...f.deals.map((d) => d.ingredientId),
    ...f.pantry.map((p) => p.ingredientId),
    ...f.matched.map((m) => m.ingredientId),
    ...f.onHand,
  ]);
  const out: { id: string; packQty: number; packPrice: number; basis: EstimateBasis }[] = [];
  for (const id of regularCandidates(household.cuisines, exclude, REGULAR_LIMIT)) {
    const ing = INGREDIENT_BY_ID[id];
    if (!ing || f.neverBuy.has(id) || f.blocked.has(id) || ing.allergens.some((a) => f.allergens.has(a))) continue;
    for (const basis of ESTIMATE_PRIORITY) {
      const offer = f.estimates.find((e) => e.ingredientId === id && e.estimate?.basis === basis);
      if (offer) {
        out.push({ id, packQty: offer.packQty, packPrice: offer.packPrice, basis });
        break;
      }
    }
  }
  return out;
}

/** Prices and checks one set of planned meals for the week. Shape issues from toPlannedMeals come in as well. */
export function evaluateWeek(frame: WeekFrame, meals: PlannedMeal[], shapeIssues: ValidationIssue[], notes: string): MealPlan {
  const { household, request, deals, matched, fixedCost, stores, priceMatchStores, pantry } = frame;
  const list = buildList(meals, fixedCost, deals, matched, stores, household.maxStores, priceMatchStores, pantry, frame.listOptions);
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
    ...(Object.keys(frame.guests).length > 0 ? { guests: frame.guests } : {}),
  };
  plan.issues = [
    ...frame.notes,
    ...fixedCost.issues,
    ...shapeIssues,
    ...validate(plan, validationContext(frame)),
  ];
  return plan;
}

/** What a week is checked against. Repair attribution reads the same context as validate. */
export function validationContext(frame: WeekFrame): ValidateContext {
  return {
    household: frame.household,
    cells: frame.cells,
    fixed: frame.fixedCost,
    available: new Set(frame.available.map((a) => a.id)),
    neverBuy: new Set(frame.neverBuy),
    neverWords: frame.neverWords,
    recentDinnerNames: frame.recentDinnerNames,
    useFirst: frame.dueSoon.map((i) => ({ ingredientId: i.ingredientId, expiresOn: i.expiresOn })),
    neverMeals: frame.ratings.never,
    formBlocked: frame.formBlocked,
    avoidDishes: frame.household.avoidDishes,
    onDeal: new Set(frame.available.filter((a) => a.source === 'deal').map((a) => a.id)),
  };
}

/** One attempt: the plan it priced and checked, and the prep list that came with it. */
export interface Attempt {
  plan: MealPlan;
  prep?: PrepPlan;
}

const errorCount = (issues: ValidationIssue[]) => issues.filter((i) => i.severity === 'error').length;

/** What the planner is doing, for the status line while a week is being planned. */
export type PlanProgress =
  | { stage: 'writing'; attempt: number }
  | { stage: 'checking'; attempt: number }
  | { stage: 'fixing'; attempt: number; meals: number; reason: string }
  | { stage: 'saving' };

/** Plan order: by day, then by slot. */
export const weekOrder = (a: PlannedMeal, b: PlannedMeal) =>
  DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot);

/**
 * The model's new meals, with ids that do not collide with the kept meals or each other. A link is kept only when it
 * points at another new meal: a new meal never shares leftovers with a kept one.
 */
export function renameFresh(fresh: PlannedMeal[], keptIds: ReadonlySet<string>): PlannedMeal[] {
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

/** A meal that stays in the week while others are written. The planner must not change it. */
export function keptPayload(m: PlannedMeal): KeptMealPayload {
  return {
    id: m.id,
    day: m.day,
    slot: m.slot,
    name: m.name,
    ingredients: m.ingredients.map((i) => ({ id: i.ingredientId, qty: i.qty, unit: i.unit })),
    ...(m.usesLeftoversFrom ? { usesLeftoversFrom: m.usesLeftoversFrom } : {}),
    ...(m.makesLeftoversFor ? { makesLeftoversFor: m.makesLeftoversFor } : {}),
  };
}

/** What the kept meals cost on their own, for the budget left for the cells being written. Fixed meals are not counted. */
export function keptCostOf(frame: WeekFrame, kept: PlannedMeal[]): number {
  if (kept.length === 0) return 0;
  const list = buildList(
    kept,
    { ...frame.fixedCost, needs: [] },
    frame.deals,
    frame.matched,
    frame.stores,
    frame.household.maxStores,
    frame.priceMatchStores,
    frame.pantry,
    frame.listOptions,
  );
  return round2(list.reduce((sum, i) => sum + i.total, 0));
}

/**
 * Where a week's attempts start: the cells the model writes first, the meals kept as they are, and what they cost.
 * A new plan starts with every cell and nothing kept. A swap starts with the freed cells and the meals that stay.
 */
export interface WeekStart {
  cells: SlotCell[];
  kept: PlannedMeal[];
  replacing: string[]; // names being replaced: the model must not reuse them
  keptCost: number;
  swap: boolean; // true for a swap, so the payload carries keptMeals even when none are kept
  note?: string; // the household's note for a swap
  notes?: string; // the notes to keep when nothing is written
}

export interface WeekJob {
  frame: WeekFrame;
  start: WeekStart;
  client: PlannerClient;
  maxAttempts: number;
  prepDay: Day | null;
  onProgress?: (p: PlanProgress) => void;
  now: () => number;
}

export interface WeekResult {
  best: Attempt;
  attempts: number;
  timings: PlanTimings;
}

/** One attempt to write: the cells to fill, the meals kept, and what the last check said. */
interface Step {
  mode: 'full' | 'repair';
  cells: SlotCell[];
  kept: PlannedMeal[];
  replacing: string[];
  keptCost: number;
  swap: boolean;
  note?: string;
  notes: string;
  feedback: ValidationIssue[] | null;
}

function payloadFor(frame: WeekFrame, step: Step): PlannerPayload {
  return buildPayload({
    household: frame.household,
    request: frame.request,
    cells: step.cells,
    fixed: frame.placements,
    fixedCost: frame.fixedCost,
    available: frame.available,
    neverBuyWords: frame.neverWords,
    recentDinnerNames: frame.recentDinnerNames,
    pantryUseFirst: frame.dueSoon.map((i) => i.ingredientId),
    favourites: frame.ratings.favourites,
    avoid: [...frame.ratings.avoid, ...frame.ratings.never],
    issues: step.feedback ?? undefined,
    feedback: frame.feedback,
    guests: frame.guests,
    ...(swapStyle(step)
      ? {
          keptMeals: step.kept.map(keptPayload),
          keptCost: step.keptCost,
          replacing: step.replacing,
          ...(step.note ? { swapNote: step.note } : {}),
        }
      : {}),
  });
}

/** Repairs and swaps keep meals, so they use the swap prompt. A new plan's first attempt does not. */
const swapStyle = (step: Step) => step.swap || step.mode === 'repair';

/**
 * The system prompt for a step: the variant for this week's prep day and leftover chains (cached), and the swap block
 * for a swap or repair (sent after it, uncached). A new plan with nothing to chain drops the leftover sentence.
 */
function systemFor(step: Step, prepDay: Day | null): SystemText {
  const prep = prepDay !== null;
  const swap = swapStyle(step);
  const leftovers = !swap && leftoverChainsOf(step.cells) > 0;
  return { cached: plannerSystem({ prep, leftovers }), ...(swap ? { uncached: swapPrompt(prep) } : {}) };
}

/** One model call for a step, checked against the whole week. A step with nothing to write is checked without a call. */
async function attemptStep(job: WeekJob, step: Step): Promise<Attempt> {
  const { frame } = job;
  if (step.cells.length === 0) return { plan: evaluateWeek(frame, step.kept, [], step.notes) };

  const payload = payloadFor(frame, step);
  const raw = await job.client.submitPlan(systemFor(step, job.prepDay), payload);
  const { meals: everyNew, issues: shapeIssues } = toPlannedMeals(raw.meals, frame.cells);

  let merged: PlannedMeal[] = everyNew;
  const strays: ValidationIssue[] = [];
  if (swapStyle(step)) {
    const refillKeys = new Set(step.cells.map(cellKey));
    const fresh = everyNew.filter((m) => refillKeys.has(cellKey(m)));
    for (const m of everyNew) {
      if (refillKeys.has(cellKey(m))) continue;
      strays.push({
        check: 'slot-coverage',
        severity: 'error',
        message: `"${m.name}" is for ${DAY_LONG[m.day]} ${m.slot}, which is not being swapped. Plan only the slots listed.`,
      });
    }
    const keptIds = new Set(step.kept.map((m) => m.id));
    merged = [...step.kept, ...renameFresh(fresh, keptIds)].sort(weekOrder);
  }
  return {
    plan: evaluateWeek(frame, merged, [...shapeIssues, ...strays], raw.notes),
    prep: job.prepDay ? prepFrom(raw, merged, job.prepDay) : undefined,
  };
}

const cellKey = (c: { day: string; slot: string }) => `${c.day}-${c.slot}`;

/**
 * The next step after a checked attempt. When every error names meals (or an empty cell), only those meals and the
 * cells they leave are written again, and the rest is kept. Otherwise the whole job is asked again with the errors.
 */
function nextStep(job: WeekJob, tried: Attempt): { step: Step; repaired: Repair | null } {
  const { start } = job;
  const errors = tried.plan.issues.filter((i) => i.severity === 'error');
  const rep = repairFor(tried.plan, validationContext(job.frame), tried.plan.issues);
  if (rep) {
    const replaced = new Set(rep.replaceIds);
    const kept = tried.plan.meals.filter((m) => !replaced.has(m.id));
    const replacing = [...new Set(tried.plan.meals.filter((m) => replaced.has(m.id)).map((m) => m.name))];
    return {
      repaired: rep,
      step: {
        mode: 'repair',
        cells: rep.refill,
        kept,
        replacing,
        keptCost: keptCostOf(job.frame, kept),
        swap: start.swap,
        note: start.note,
        notes: tried.plan.notes,
        feedback: errors,
      },
    };
  }
  return {
    repaired: null,
    step: {
      mode: 'full',
      cells: start.cells,
      kept: start.kept,
      replacing: start.replacing,
      keptCost: start.keptCost,
      swap: start.swap,
      note: start.note,
      notes: start.notes ?? '',
      feedback: tried.plan.issues,
    },
  };
}

/**
 * Asks for the week until it has no errors or the attempts run out. The first attempt writes the job's cells. After
 * that, errors that name meals are repaired by writing only those meals again; other errors ask for the whole job
 * again, with the issues as feedback. The attempt with the fewest errors, then the lowest cost, is kept, with its
 * own prep. Each attempt is timed and reported through onProgress.
 */
export async function runWeek(job: WeekJob): Promise<WeekResult> {
  const started = job.now();
  const records: AttemptTiming[] = [];
  let best: Attempt | null = null;
  let attempts = 0;
  let step: Step = {
    mode: 'full',
    cells: job.start.cells,
    kept: job.start.kept,
    replacing: job.start.replacing,
    keptCost: job.start.keptCost,
    swap: job.start.swap,
    note: job.start.note,
    notes: job.start.notes ?? '',
    feedback: null,
  };

  for (;;) {
    attempts++;
    const t0 = job.now();
    if (step.mode === 'full' && step.cells.length > 0) job.onProgress?.({ stage: 'writing', attempt: attempts });
    const tried = await attemptStep(job, step);
    if (step.cells.length > 0) job.onProgress?.({ stage: 'checking', attempt: attempts });
    const errors = errorCount(tried.plan.issues);
    records.push({ ms: job.now() - t0, mode: step.mode, replaced: step.cells.length, errors });
    if (
      best === null ||
      errors < errorCount(best.plan.issues) ||
      (errors === errorCount(best.plan.issues) && tried.plan.totalCost < best.plan.totalCost)
    ) {
      best = tried;
    }
    if (errors === 0 || attempts >= job.maxAttempts) break;
    // Out of time: the best attempt so far is kept, with its issues, rather than starting another call.
    if (job.now() - started > ATTEMPT_TIME_LIMIT_MS) break;

    const next = nextStep(job, tried);
    if (next.repaired) {
      job.onProgress?.({
        stage: 'fixing',
        attempt: attempts + 1,
        meals: next.repaired.replaceIds.length,
        reason: next.repaired.reason,
      });
    }
    step = next.step;
  }
  return { best: best!, attempts, timings: { totalMs: job.now() - started, attempts: records } };
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
 * household has a prep day, the prep list in the same call), then price and check the result. Errors
 * that name meals are repaired by writing only those meals again; other errors ask for the whole week
 * again with the issues as feedback. The attempt with the fewest errors, then the lowest cost, is kept,
 * with its own prep. Prep never counts as an error and never triggers a retry: missing or invalid prep
 * is a warning. With no plannable cells the model is not called.
 */
export async function runPlanner(input: RunInput): Promise<MealPlan> {
  const { household, client } = input;
  const maxAttempts = Math.max(1, input.maxAttempts ?? 3);
  const frame = weekFrame(input);
  const { cells } = frame;

  if (cells.length === 0) return { ...evaluateWeek(frame, [], [], ''), timings: { totalMs: 0, attempts: [] } };

  const { best, attempts, timings } = await runWeek({
    frame,
    start: { cells, kept: [], replacing: [], keptCost: 0, swap: false, notes: '' },
    client,
    maxAttempts,
    prepDay: household.prepDay,
    onProgress: input.onProgress,
    now: input.now ?? Date.now,
  });
  return { ...attachWeekPrep(best.plan, best.prep, household.prepDay), attempts, timings };
}
