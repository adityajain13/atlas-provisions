import {
  DAYS,
  DAY_LONG,
  INGREDIENT_BY_ID,
  type BaseUnit,
  type Day,
  type EstimateBasis,
  type ListItem,
  type MealPlan,
  type MealStatus,
  type PlannedMeal,
  type Slot,
  SLOTS,
  cuisineByKey,
} from '@provisions/shared';
import { headlineName } from './headline';
import { DAY_SHORT } from './labels';
import { neededQuantity, packLineQuantity } from './quantity';

// Turn a saved MealPlan into the shapes the Week and List screens already draw.

// ---- View shapes the Week and List screens draw ----

export type ViewTag = { kind: 'craving' | 'cuisine' | 'deal' | 'leftover'; text: string };

// A planned meal the household can rate. Only meals from a saved plan have one.
export type Rateable = {
  name: string;
  ingredientIds: string[];
  personIds: string[]; // real household members eating it
};

// A planned meal another meal links to, shown as "Mon dinner". skipped: that meal was marked skipped, and this one
// (the leftovers it was to feed) has not been dealt with since.
export type MealRef = { id: string; label: string; skipped?: boolean };

export type ViewMeal = {
  id?: string; // planned meals only
  slot: Slot;
  who: string;
  name: string;
  detail: string;
  cost: number | null;
  fixed?: boolean;
  tags: ViewTag[];
  rateable?: Rateable;
  // A leftover meal. from is the meal it reuses, or null when that meal is not in the plan.
  leftover?: { from: MealRef | null };
  // The meals that eat this meal's leftovers, in week order.
  makes?: MealRef[];
  // What happened to a planned meal ("Didn't go to plan?"). Absent for a meal with no mark, and for fixed meals.
  status?: MealStatus;
};

export type ViewDay = {
  key: Day;
  dayLabel: string;
  dateNum: number;
  headline: string;
  meals: ViewMeal[];
};

export type ViewWeek = {
  weekOf: string;
  label: string;
  budget: number;
  spent: number;
  stores: string[];
  days: ViewDay[];
};

/** List sections, in the order the shopping list shows them. */
export const LIST_CATEGORY_ORDER = [
  'produce',
  'bakery',
  'meat & seafood',
  'deli',
  'dairy & eggs',
  'frozen',
  'pantry',
  'household',
] as const;
export type ListCategory = (typeof LIST_CATEGORY_ORDER)[number];

export type ViewItem = {
  id: string;
  store: string;
  category: ListCategory;
  name: string;
  qty: string;
  price: number;
  note?: { kind: 'match' | 'used'; text: string };
  elsewhere?: string; // unpriced items: where the cheapest enabled store sells it
  estimate?: { basis: EstimateBasis; date?: string }; // not a flyer price: the store's regular site price or last receipt price (from this day), or a typical price
  pinnedTo?: string; // bought at this store because an item rule pins it there
  priceUnknown?: boolean; // pinned to a store with no known price: listed there, not priced
};

const SLOT_ORDER: Record<Slot, number> = { breakfast: 0, lunch: 1, dinner: 2 };

/** The Week screen's opening day: today when it falls in the plan's week (Sun to Sat), else Sunday. */
export function defaultDay(weekOf: string, todayIso: string): Day {
  const offset = DAYS.findIndex((_, i) => addDays(weekOf, i) === todayIso);
  return offset >= 0 ? DAYS[offset]! : DAYS[0];
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${iso}T00:00:00Z`))
    .replace(',', '');
}

export function weekLabel(weekOf: string): string {
  return `${shortDate(weekOf)} – ${shortDate(addDays(weekOf, 6))}`;
}

const ingredientName = (id: string) => INGREDIENT_BY_ID[id]?.name ?? id;

function eatersLabel(eaters: string[], people: Map<string, string>): string {
  if (eaters.length === 0) return '';
  if (eaters.length === 1) return people.get(eaters[0]!) ?? 'Guest';
  const allHousehold = eaters.every((id) => people.has(id));
  if (eaters.length === 2 && allHousehold) return 'Both';
  return `${eaters.length} people`;
}

/** Price per base unit for each ingredient on the list, from its pack. */
function unitPrices(list: ListItem[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of list) {
    if (item.store === 'Unpriced' || item.packQty <= 0) continue;
    out.set(item.ingredientId, item.packPrice / item.packQty);
  }
  return out;
}

function mealCost(meal: PlannedMeal, prices: Map<string, number>): number | null {
  let total = 0;
  let priced = false;
  for (const ing of meal.ingredients) {
    const p = prices.get(ing.ingredientId);
    if (p === undefined) continue;
    total += ing.qty * p;
    priced = true;
  }
  return priced ? Math.round(total * 100) / 100 : null;
}

function craving(meal: PlannedMeal, cravings: string[]): string | undefined {
  const name = meal.name.toLowerCase();
  return cravings.find((c) => name.includes(c.toLowerCase()));
}

const SLOT_WORDS = new Set<string>(SLOTS);
const LEFTOVER_WORD = /^leftovers?$/i;

/**
 * The pills a meal shows. A tag that only repeats the slot ("dinner") is dropped, and so is a
 * "leftover" tag when the Leftovers pill already says it. Repeated pills are shown once.
 */
function tagsOf(meal: PlannedMeal, cravings: string[]): ViewTag[] {
  const tags: ViewTag[] = [];
  if (meal.tags.some((t) => t.trim().toLowerCase() === 'craving')) {
    const c = craving(meal, cravings);
    tags.push({ kind: 'craving', text: c ? `Craving: ${c.toLowerCase()}` : 'Craving' });
  }
  // The cuisine comes second, so a card's first two pills show a craving and the cuisine.
  if (meal.cuisine) tags.push({ kind: 'cuisine', text: cuisineByKey(meal.cuisine)?.label ?? meal.cuisine });
  for (const raw of meal.tags) {
    const t = raw.trim();
    const lower = t.toLowerCase();
    if (!t || lower === 'craving' || SLOT_WORDS.has(lower)) continue;
    // A leftover meal says so in its own line, so its Leftovers tag is not repeated as a pill.
    if (LEFTOVER_WORD.test(t)) continue;
    const text = t.charAt(0).toUpperCase() + t.slice(1);
    if (tags.some((x) => x.text.toLowerCase() === text.toLowerCase())) continue;
    tags.push({ kind: 'deal', text });
  }
  return tags;
}

// Only household members can rate a meal. Guests are not in the people map.
function rateableOf(meal: PlannedMeal, people: Map<string, string>): { rateable?: Rateable } {
  const personIds = meal.eaters.filter((id) => people.has(id));
  if (personIds.length === 0) return {};
  return {
    rateable: { name: meal.name, ingredientIds: meal.ingredients.map((i) => i.ingredientId), personIds },
  };
}

function detailOf(meal: PlannedMeal): string {
  const names = meal.ingredients.map((i) => ingredientName(i.ingredientId));
  if (names.length <= 4) return names.join(', ');
  return `${names.slice(0, 4).join(', ')}, and ${names.length - 4} more`;
}

const refOf = (m: PlannedMeal): MealRef => ({ id: m.id, label: `${DAY_SHORT[m.day]} ${m.slot}` });

/**
 * The leftover links of a planned meal: what it reuses, and which meals eat its leftovers. A link to a skipped meal is
 * marked skipped, unless this meal has been dealt with since (it has a mark of its own, such as kept or made instead).
 */
function leftoverLinks(plan: MealPlan, meal: PlannedMeal, statuses: Record<string, MealStatus>): Pick<ViewMeal, 'leftover' | 'makes'> {
  const byId = new Map(plan.meals.map((m) => [m.id, m]));
  const isLeftover = Boolean(meal.usesLeftoversFrom) || meal.tags.some((t) => LEFTOVER_WORD.test(t.trim()));
  const from = meal.usesLeftoversFrom ? byId.get(meal.usesLeftoversFrom) : undefined;
  const fromRef = (m: PlannedMeal): MealRef => {
    const skipped = statuses[m.id]?.status === 'skipped' && statuses[meal.id] === undefined;
    return skipped ? { ...refOf(m), skipped: true } : refOf(m);
  };

  const eaters = new Set<string>();
  if (meal.makesLeftoversFor && byId.has(meal.makesLeftoversFor)) eaters.add(meal.makesLeftoversFor);
  for (const m of plan.meals) if (m.usesLeftoversFrom === meal.id) eaters.add(m.id);
  const makes = plan.meals.filter((m) => eaters.has(m.id)).map(refOf);

  return {
    ...(isLeftover ? { leftover: { from: from ? fromRef(from) : null } } : {}),
    ...(makes.length > 0 ? { makes } : {}),
  };
}

/** The week's cards. `statuses` holds the marks on the saved plan's meals, by meal id. */
export function planToWeek(plan: MealPlan, people: Map<string, string>, statuses: Record<string, MealStatus> = {}): ViewWeek {
  const prices = unitPrices(plan.list);
  const days: ViewDay[] = DAYS.map((key, i) => {
    const planned: { slot: Slot; meal: ViewMeal }[] = plan.meals
      .filter((m) => m.day === key)
      .map((m) => ({
        slot: m.slot,
        meal: {
          id: m.id,
          slot: m.slot,
          who: eatersLabel(m.eaters, people),
          name: m.name,
          detail: detailOf(m),
          cost: mealCost(m, prices),
          tags: tagsOf(m, plan.request.cravings),
          ...rateableOf(m, people),
          ...leftoverLinks(plan, m, statuses),
          ...(statuses[m.id] ? { status: statuses[m.id] } : {}),
        },
      }));
    const fixed: { slot: Slot; meal: ViewMeal }[] = plan.fixedMeals
      .filter((f) => f.day === key)
      .map((f) => ({
        slot: f.slot,
        meal: {
          slot: f.slot,
          who: eatersLabel(f.eaters, people),
          name: f.name,
          detail: 'Fixed meal',
          cost: null,
          fixed: true,
          tags: [],
        },
      }));
    const meals = [...fixed, ...planned]
      .sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot])
      .map((x) => x.meal);
    const dinner = meals.find((m) => m.slot === 'dinner' && !m.fixed);
    return {
      key,
      dayLabel: DAY_LONG[key],
      dateNum: Number(addDays(plan.weekOf, i).slice(8)),
      headline: dinner ? `${headlineName(dinner.name)}.` : 'nothing planned.',
      meals,
    };
  });

  return {
    weekOf: plan.weekOf,
    label: weekLabel(plan.weekOf),
    budget: plan.request.budget,
    spent: plan.totalCost,
    stores: plan.stores,
    days,
  };
}

const LIST_CATEGORY: Record<string, ListCategory> = {
  produce: 'produce',
  bakery: 'bakery',
  meat: 'meat & seafood',
  seafood: 'meat & seafood',
  deli: 'deli',
  dairy: 'dairy & eggs',
  frozen: 'frozen',
  pantry: 'pantry',
  household: 'household',
};

const PRICE_UNIT: Record<BaseUnit, string> = { kg: 'kg', l: 'L', each: 'each' };

function mealLabel(plan: MealPlan, id: string): string | null {
  const meal = plan.meals.find((m) => m.id === id);
  if (meal) return `${DAY_SHORT[meal.day]} ${meal.name}`;
  const fixed = plan.fixedMeals.find((f) => f.id === id);
  if (fixed) return `${DAY_SHORT[fixed.day]} ${fixed.name}`;
  return null;
}

function usedNote(plan: MealPlan, item: ListItem): string | undefined {
  const labels = item.usedIn.map((id) => mealLabel(plan, id)).filter((x): x is string => x !== null);
  if (labels.length === 0) return undefined;
  const shown = labels.slice(0, 3).join(', ');
  return labels.length > 3 ? `Used in ${shown}, and ${labels.length - 3} more` : `Used in ${shown}`;
}

/** "Oct 28", from a YYYY-MM-DD date. */
/**
 * The line under an estimated price: where a site price is the regular price, when a receipt price was last paid, or
 * that a typical price is an approximate shelf price. Undefined for a flyer price.
 */
export function estimateCaption(estimate: { basis: EstimateBasis; date?: string } | undefined, store: string): string | undefined {
  if (!estimate) return undefined;
  if (estimate.basis === 'site') return `regular price at ${store}`;
  if (estimate.basis === 'receipt') return estimate.date ? `last paid ${monthDay(estimate.date)}` : 'last paid';
  return 'typical price';
}

/** The price as shown: estimates from a receipt or a typical price carry a "~". */
export function priceLabel(price: number, estimate: { basis: EstimateBasis } | undefined): string {
  const approx = estimate?.basis === 'receipt' || estimate?.basis === 'typical' ? '~' : '';
  return `${approx}$${price.toFixed(2)}`;
}

export function monthDay(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}

export function planToList(plan: MealPlan): { weekOf: string; stores: string[]; items: ViewItem[] } {
  const items: ViewItem[] = plan.list.map((item) => {
    const catalog = INGREDIENT_BY_ID[item.ingredientId];
    const base = catalog?.baseUnit ?? 'each';
    // Unpriced and price-unknown items have no packs, so their quantity is what the plan needs.
    const qty =
      item.store === 'Unpriced' || item.priceUnknown
        ? item.needed
          ? neededQuantity(item.needed, base, catalog?.eachLabel)
          : ''
        : packLineQuantity({
            unit: base,
            packs: item.packs,
            packQty: item.packQty,
            packPrice: item.packPrice,
            eachLabel: catalog?.eachLabel,
          });
    const note = item.priceMatch
      ? {
          kind: 'match' as const,
          text: `Price-match ${item.priceMatch.fromStore}: $${item.priceMatch.pricePerUnit.toFixed(2)}/${PRICE_UNIT[base]}`,
        }
      : (() => {
          const text = usedNote(plan, item);
          return text ? { kind: 'used' as const, text } : undefined;
        })();
    const elsewhere = item.cheapestElsewhere
      ? `Cheapest at ${item.cheapestElsewhere.store}: $${item.cheapestElsewhere.price.toFixed(2)}`
      : undefined;
    return {
      id: item.ingredientId,
      store: item.store,
      category: LIST_CATEGORY[item.category] ?? 'pantry',
      name: item.name,
      qty,
      price: item.total,
      ...(note ? { note } : {}),
      ...(elsewhere ? { elsewhere } : {}),
      ...(item.estimate ? { estimate: { basis: item.estimate.basis, date: item.estimate.date } } : {}),
      ...(item.pinned ? { pinnedTo: item.store } : {}),
      ...(item.priceUnknown ? { priceUnknown: true } : {}),
    };
  });

  // Store columns are real stores only. Unpriced items are rendered in their own section.
  const stores = plan.stores.filter((s) => s !== 'Unpriced');
  return { weekOf: plan.weekOf, stores, items };
}
