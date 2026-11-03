import {
  DAYS,
  DAY_LONG,
  INGREDIENT_BY_ID,
  type BaseUnit,
  type ListItem,
  type MealPlan,
  type PlannedMeal,
  type Slot,
} from '@provisions/shared';
import type { MockDay, MockItem, MockMeal, MockTag, MockWeek, Category, Rateable } from '../mocks/week';
import { DAY_SHORT } from './labels';

// Turn a saved MealPlan into the shapes the Week and List screens already draw.

const SLOT_ORDER: Record<Slot, number> = { breakfast: 0, lunch: 1, dinner: 2 };

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

function tagsOf(meal: PlannedMeal, cravings: string[]): MockTag[] {
  const tags: MockTag[] = [];
  if (meal.tags.includes('craving')) {
    const c = craving(meal, cravings);
    tags.push({ kind: 'craving', text: c ? `Craving: ${c.toLowerCase()}` : 'Craving' });
  }
  if (meal.usesLeftoversFrom) tags.push({ kind: 'leftover', text: 'Leftovers' });
  for (const t of meal.tags) {
    if (t === 'craving') continue;
    tags.push({ kind: 'deal', text: t.charAt(0).toUpperCase() + t.slice(1) });
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

export function planToWeek(plan: MealPlan, people: Map<string, string>): MockWeek {
  const prices = unitPrices(plan.list);
  const days: MockDay[] = DAYS.map((key, i) => {
    const planned: { slot: Slot; meal: MockMeal }[] = plan.meals
      .filter((m) => m.day === key)
      .map((m) => ({
        slot: m.slot,
        meal: {
          slot: m.slot,
          who: eatersLabel(m.eaters, people),
          name: m.name,
          detail: detailOf(m),
          cost: mealCost(m, prices),
          tags: tagsOf(m, plan.request.cravings),
          ...rateableOf(m, people),
        },
      }));
    const fixed: { slot: Slot; meal: MockMeal }[] = plan.fixedMeals
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
      headline: dinner ? `${dinner.name.toLowerCase()}.` : 'nothing planned.',
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

const LIST_CATEGORY: Record<string, Category> = {
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

function formatSize(qty: number, unit: BaseUnit): string {
  if (unit === 'kg') return qty < 1 ? `${Math.round(qty * 1000)} g` : `${Number(qty.toFixed(2))} kg`;
  if (unit === 'l') return qty < 1 ? `${Math.round(qty * 1000)} mL` : `${Number(qty.toFixed(2))} L`;
  return qty === 1 ? '1 each' : `${Number(qty.toFixed(2))} ct`;
}

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

export function planToList(plan: MealPlan): { weekOf: string; stores: string[]; items: MockItem[] } {
  const items: MockItem[] = plan.list.map((item) => {
    const base = INGREDIENT_BY_ID[item.ingredientId]?.baseUnit ?? 'each';
    const size = formatSize(item.packQty, base);
    const qty = item.packs > 1 ? `${item.packs} × ${size}` : size;
    const note = item.priceMatch
      ? {
          kind: 'match' as const,
          text: `Price-match ${item.priceMatch.fromStore}: $${item.priceMatch.pricePerUnit.toFixed(2)}/${PRICE_UNIT[base]}`,
        }
      : (() => {
          const text = usedNote(plan, item);
          return text ? { kind: 'used' as const, text } : undefined;
        })();
    return {
      id: item.ingredientId,
      store: item.store,
      category: LIST_CATEGORY[item.category] ?? 'pantry',
      name: item.name,
      qty: item.store === 'Unpriced' ? '' : qty,
      price: item.total,
      ...(note ? { note } : {}),
    };
  });

  const stores = [...plan.stores];
  if (items.some((i) => i.store === 'Unpriced')) stores.push('Unpriced');
  return { weekOf: plan.weekOf, stores, items };
}
