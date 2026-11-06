import { z } from 'zod';
import { DAYS, PLAN_RETENTION_WEEKS, SLOTS, WEEKS_AHEAD, addWeeks, isSunday, type Day, type Slot } from './calendar';
import type { Category, BaseUnit } from './catalog';
import type { PrepPlan } from './prep';
import type { EstimateBasis } from './offers';

// ---- Request ----

export interface SlotCell {
  day: Day;
  slot: Slot;
  eaters: string[]; // person ids, plus guest-1, guest-2 ... for extra headcount
  fixedMealId?: string;
  maxMinutes?: number; // hard cap on active minutes, from the household's time caps or a week override
}

export interface WeekOverride {
  day: Day;
  slot: Slot;
  headcount?: number; // replaces the eater count; extra people are guests
  eatingOut?: boolean;
  spend?: number;
  skipFixed?: boolean;
  maxMinutes?: number; // busy night for this week only; wins over the household time cap
}

export interface PlanRequest {
  weekOf: string; // Sunday YYYY-MM-DD, the first day of the plan week
  budget: number;
  cravings: string[];
  overrides: WeekOverride[];
  useItUp: boolean;
}

const WeekOverrideSchema = z.object({
  day: z.enum(DAYS),
  slot: z.enum(SLOTS),
  headcount: z.number().int().min(0, 'Headcount cannot be negative').max(20).optional(),
  eatingOut: z.boolean().optional(),
  spend: z.number().min(0).max(1000).optional(),
  skipFixed: z.boolean().optional(),
  maxMinutes: z.number().int().min(5, 'Time cap is at least 5 minutes').max(180).optional(),
});

/** True for a real calendar date in YYYY-MM-DD form. */
export function isRealIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** A real calendar date in YYYY-MM-DD form. */
export const IsoDateSchema = z.string().refine(isRealIsoDate, 'Dates must be real YYYY-MM-DD dates');

/** True for a real calendar date in YYYY-MM-DD form that falls on a Sunday. */
export function isSundayIso(s: string): boolean {
  return isRealIsoDate(s) && new Date(`${s}T00:00:00Z`).getUTCDay() === 0;
}

export const PlanRequestSchema = z.object({
  weekOf: z.string().refine(isSundayIso, 'weekOf must be a Sunday (YYYY-MM-DD)'),
  budget: z.number().min(1, 'Budget must be at least 1').max(2000, 'Budget must be 2000 or less'),
  cravings: z.array(z.string().trim().min(1).max(60)).max(10, 'At most 10 cravings'),
  overrides: z.array(WeekOverrideSchema),
  useItUp: z.boolean(),
});

// ---- Planner output ----

export interface PlannedIngredient {
  ingredientId: string;
  qty: number; // total for that meal
  unit: BaseUnit;
}

export interface PlannedMeal {
  id: string;
  day: Day;
  slot: Slot;
  name: string;
  eaters: string[];
  ingredients: PlannedIngredient[];
  activeMinutes: number;
  usesLeftoversFrom?: string;
  makesLeftoversFor?: string;
  steps: string[];
  tags: string[]; // e.g. 'craving'
}

export interface ListItem {
  ingredientId: string;
  name: string;
  category: Category;
  store: string; // 'Unpriced' when no enabled store sells it
  packs: number;
  packQty: number; // base units per pack
  packPrice: number;
  total: number;
  usedIn: string[]; // planned meal ids and fixed placement ids
  priceMatch?: { fromStore: string; pricePerUnit: number };
  needed?: number; // unpriced items only: base units the plan needs, since packs are 0
  // Unpriced items an enabled store sells, but not one of the chosen stores: the cheapest of them.
  cheapestElsewhere?: { store: string; price: number };
  // A fixed-meal ingredient that is not in the catalogue. It has no price and is listed as typed.
  custom?: boolean;
  label?: string; // the name as typed, for custom items
  qtyText?: string; // the quantity as typed, e.g. "750 g", for custom items
  // The price is an estimate: the household's last receipt price at this store, not a flyer price this week.
  estimate?: { basis: EstimateBasis; date: string };
  // Pinned to this store by an item rule ("Eggs at Costco"). Its price is unknown when no store offer is known.
  pinned?: boolean;
  priceUnknown?: boolean; // pinned, and no price is known at its store: listed under the store, not priced
}

export interface ValidationIssue {
  check:
    | 'budget'
    | 'unknown-ingredient'
    | 'allergen'
    | 'never-buy'
    | 'slot-coverage'
    | 'macros'
    | 'waste'
    | 'busy'
    | 'cravings'
    | 'variety'
    | 'equipment'
    | 'use-it-up'
    | 'never-again'
    | 'form'
    | 'avoid-dish'
    | 'store-cap'
    | 'pin'
    | 'prep'
    | 'prep-timing'
    | 'prices'
    | 'repetition';
  severity: 'error' | 'warning';
  message: string; // written as an instruction to the planner
}

/** A meal as Claude returns it, before ids are mapped to cells. */
export interface RawMeal {
  id: string;
  slotId: string; // `${day}-${slot}`
  name: string;
  ingredients: { id: string; qty: number }[];
  activeMinutes: number;
  usesLeftoversFrom?: string;
  makesLeftoversFor?: string;
  steps: string[];
  tags: string[];
}

export interface RawPlan {
  meals: RawMeal[];
  notes: string;
  prep?: unknown; // the batch-prep list from the same call, when prepDay is set; checked by the worker
}

// Which flyer prices priced the week: the flyers valid on its Sunday, those overlapping it, or today's.
export type PriceSource = 'week' | 'overlap' | 'current';

export interface MealPlan {
  weekOf: string;
  priceSource?: PriceSource; // absent on plans saved before this was recorded
  request: PlanRequest;
  meals: PlannedMeal[];
  fixedMeals: { id: string; name: string; day: Day; slot: Slot; eaters: string[] }[];
  list: ListItem[];
  stores: string[];
  totalCost: number; // everything on the list, fixed meals included
  fixedCost: number; // what the fixed meals cost on their own
  issues: ValidationIssue[];
  attempts: number;
  timings?: PlanTimings; // how the planner spent its time; absent on plans saved before this was recorded
  generatedAt: string;
  notes: string;
  prep?: PrepPlan; // batch prep for the household's prep day, when one is set and generated
}

/** One model call: how long it took, whether it wrote a whole week or only some meals, how many meals it was asked for, and the errors it left. */
export interface AttemptTiming {
  ms: number;
  mode: 'full' | 'repair';
  replaced: number; // cells the model was asked to fill
  errors: number;
}

export interface PlanTimings {
  totalMs: number;
  attempts: AttemptTiming[];
}

// ---- Dates ----

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * The plan week a date belongs to: the Sunday on or before `date`, judged on the Toronto calendar.
 * Returns YYYY-MM-DD. Week days are weekOf + 0 (Sunday) to weekOf + 6 (Saturday).
 */
export function planWeekOf(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const dayOfMonth = Number(get('day'));
  const weekday = WEEKDAY_INDEX[get('weekday')];
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(dayOfMonth) || weekday === undefined) {
    throw new Error(`Could not read the Toronto date for ${date.toISOString()}`);
  }
  return new Date(Date.UTC(year, month - 1, dayOfMonth - weekday)).toISOString().slice(0, 10); // Sunday is 0
}

export const PLAN_WINDOW_MESSAGE = 'You can plan this week or up to 2 weeks ahead.';

/** True when a plan may be made for the Sunday `weekOf`: the current plan week, or up to WEEKS_AHEAD after it. */
export function isPlannableWeek(weekOf: string, now: Date): boolean {
  const current = planWeekOf(now);
  return isSunday(weekOf) && weekOf >= current && weekOf <= addWeeks(current, WEEKS_AHEAD);
}

/** The oldest week whose plans and ticks are kept, as of `now`. Rows for earlier weeks are deleted. */
export function retentionCutoff(now: Date): string {
  return addWeeks(planWeekOf(now), -PLAN_RETENTION_WEEKS);
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Dinner names served in the `windowDays` before `weekOf`, from earlier saved plans.
 * Each meal's date is its plan's Sunday plus its day offset in DAYS order (Sunday first).
 */
export function recentDinnerNames(plans: MealPlan[], weekOf: string, windowDays = 14): string[] {
  const start = addDaysIso(weekOf, -windowDays);
  const names = new Set<string>();
  for (const plan of plans) {
    if (plan.weekOf >= weekOf) continue;
    for (const meal of plan.meals) {
      if (meal.slot !== 'dinner') continue;
      const date = addDaysIso(plan.weekOf, DAYS.indexOf(meal.day));
      if (date >= start && date < weekOf) names.add(meal.name);
    }
  }
  return [...names];
}
