import { z } from 'zod';
import { DAYS, SLOTS, type Day, type Slot } from './calendar';
import type { Category, BaseUnit } from './catalog';

// ---- Request ----

export interface SlotCell {
  day: Day;
  slot: Slot;
  eaters: string[]; // person ids, plus guest-1, guest-2 ... for extra headcount
  fixedMealId?: string;
  maxMinutes?: number; // hard cap on active minutes. Not set yet: Household has no busy tags.
}

export interface WeekOverride {
  day: Day;
  slot: Slot;
  headcount?: number; // replaces the eater count; extra people are guests
  eatingOut?: boolean;
  spend?: number;
  skipFixed?: boolean;
}

export interface PlanRequest {
  weekOf: string; // Thursday YYYY-MM-DD
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
});

/** True for a real calendar date in YYYY-MM-DD form that falls on a Thursday. */
export function isThursdayIso(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d.getUTCDay() === 4;
}

export const PlanRequestSchema = z.object({
  weekOf: z.string().refine(isThursdayIso, 'weekOf must be a Thursday (YYYY-MM-DD)'),
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
    | 'equipment';
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
}

export interface MealPlan {
  weekOf: string;
  request: PlanRequest;
  meals: PlannedMeal[];
  fixedMeals: { id: string; name: string; day: Day; slot: Slot; eaters: string[] }[];
  list: ListItem[];
  stores: string[];
  totalCost: number; // everything on the list, fixed meals included
  fixedCost: number; // what the fixed meals cost on their own
  issues: ValidationIssue[];
  attempts: number;
  generatedAt: string;
  notes: string;
}

// ---- Dates ----

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The Thursday on or before `date`, judged on the Toronto calendar. Returns YYYY-MM-DD. */
export function flyerWeekOf(date: Date): string {
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
  const back = (weekday - 4 + 7) % 7; // Thursday is 4
  return new Date(Date.UTC(year, month - 1, dayOfMonth - back)).toISOString().slice(0, 10);
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Dinner names served in the `windowDays` before `weekOf`, from earlier saved plans.
 * Each meal's date is its plan's Thursday plus its day offset in flyer-week order.
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
