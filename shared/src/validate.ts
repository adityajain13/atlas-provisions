import { CATEGORY_ORDER, INGREDIENT_BY_ID, type Category } from './catalog';
import { CUISINES, cuisineKey, cuisineLevel } from './cuisines';
import { DAY_LONG, DAYS, isWeeknight, type Day, type Slot } from './calendar';
import type { FixedCost } from './fixed';
import type { Household, ItemRule } from './index';
import type { ListItem, MealPlan, PlannedMeal, RawMeal, SlotCell, ValidationIssue } from './plan';
import type { MatchedItem } from './match';
import { cheapest, collectOffers, packsFor, type Offer } from './offers';
import { formatUseBy, subtractPantry, type PantryItem } from './pantry';
import type { Deal } from './scoring';
import { alwaysBuyId, nameHasWord } from './itemRules';
import type { StorePreference } from './stores';
import { avoidedDish } from './dishes';
import { allowedForms, FORM_GROUP_LABEL, FORM_LABEL, formGroupOf } from './forms';
import { nutrientTotals, round2, unitLabel } from './units';
import { MAX_MEALS_PER_INGREDIENT, repeatedMeals } from './repeats';

const MACRO_DAYS = 7;
const MACRO_FLOOR = 0.85;
const WASTE_LIMIT = 0.3;
const SHORT_SHELF_DAYS = 7;
const WEEKNIGHT_MINUTES = 40;
const PRICE_MATCH_GAP = 0.1; // a store must be at least 10% cheaper to count
const VEG_TARGET = 5;
const FRUIT_HINTS = ['grape', 'banana', 'apple', 'berr', 'lemon', 'lime', 'orange', 'mango', 'pineapple', 'pear'];

const ingName = (id: string) => INGREDIENT_BY_ID[id]?.name ?? id;
const cellLabel = (day: Day, slot: Slot) => `${DAY_LONG[day]} ${slot}`;
const dayIndex = (day: Day) => DAYS.indexOf(day);

export function isVegetable(id: string): boolean {
  const ing = INGREDIENT_BY_ID[id];
  if (!ing || ing.category !== 'produce') return false;
  return !FRUIT_HINTS.some((h) => id.includes(h));
}

// ---------- raw output -> planned meals ----------

/**
 * Map Claude's meals onto the cells. Each slotId must match a cell, or the meal is dropped with an
 * error. Ingredient units come from the catalogue. Non-positive or non-finite quantities are dropped.
 */
export function toPlannedMeals(
  raw: RawMeal[],
  cells: SlotCell[],
): { meals: PlannedMeal[]; issues: ValidationIssue[] } {
  const meals: PlannedMeal[] = [];
  const issues: ValidationIssue[] = [];
  for (const r of raw) {
    const cell = cells.find((c) => `${c.day}-${c.slot}` === r.slotId);
    if (!cell) {
      issues.push({
        check: 'slot-coverage',
        severity: 'error',
        message: `"${r.name}" is planned for ${r.slotId}, which has nobody eating. Remove it, or plan it for a slot that is eaten.`,
      });
      continue;
    }
    meals.push({
      id: r.id,
      day: cell.day,
      slot: cell.slot,
      name: r.name,
      eaters: [...cell.eaters],
      ingredients: r.ingredients
        .filter((i) => Number.isFinite(i.qty) && i.qty > 0)
        .map((i) => ({ ingredientId: i.id, qty: i.qty, unit: INGREDIENT_BY_ID[i.id]?.baseUnit ?? 'each' })),
      activeMinutes: Number.isFinite(r.activeMinutes) ? Math.max(0, r.activeMinutes) : 0,
      ...(r.usesLeftoversFrom ? { usesLeftoversFrom: r.usesLeftoversFrom } : {}),
      ...(r.makesLeftoversFor ? { makesLeftoversFor: r.makesLeftoversFor } : {}),
      steps: r.steps.slice(0, 6),
      tags: [...r.tags],
      ...(cuisineKey(r.cuisine) ? { cuisine: cuisineKey(r.cuisine) } : {}),
    });
  }
  return { meals, issues };
}

// ---------- shopping list ----------

/** All subsets of `items` with 1..maxSize members, in input order. */
function subsetsUpTo<T>(items: T[], maxSize: number): T[][] {
  const out: T[][] = [];
  const walk = (start: number, cur: T[]) => {
    if (cur.length > 0) out.push([...cur]);
    if (cur.length === maxSize) return;
    for (let i = start; i < items.length; i++) {
      cur.push(items[i]!);
      walk(i + 1, cur);
      cur.pop();
    }
  };
  walk(0, []);
  return out;
}

/** An item rule that buys one ingredient at one store whenever it is on the list. It does not put the item on the list. */
export interface Pin {
  ingredientId: string;
  store: string;
}

/**
 * The pins in the household's item rules: an always-buy rule with a store, or a 'pin' rule. The first rule for an
 * ingredient wins. A rule with no catalogue ingredient to name is left out.
 */
export function pinsOf(rules: ItemRule[]): Pin[] {
  const out: Pin[] = [];
  const seen = new Set<string>();
  for (const r of rules) {
    if (!r.store || (r.rule !== 'always' && r.rule !== 'pin')) continue;
    const ingredientId = r.ingredientId ?? alwaysBuyId(r.name);
    if (!ingredientId || seen.has(ingredientId)) continue;
    seen.add(ingredientId);
    out.push({ ingredientId, store: r.store });
  }
  return out;
}

/** The store-choice settings and extra prices buildList takes. Each one is optional, so a call without them is the old behaviour. */
export interface BuildListOptions {
  preference?: StorePreference; // default: cheapest
  pins?: Pin[];
  estimates?: Offer[]; // site, receipt or typical prices for store and ingredient pairs no flyer covers
  onHand?: string[]; // ingredient ids the household keeps: free, and never on the list
}

const CHEAPEST: StorePreference = { mode: 'cheapest', minSaving: 0 };
const CENTS = 1e-9;

/** What an offer costs for a quantity: the packs needed, at the pack price. */
const costOf = (offer: Offer, qty: number) => packsFor(qty, offer.packQty) * offer.packPrice;

/**
 * The offer one item takes from the stores in a subset.
 * - cheapest: the lowest unit price (the old rule).
 * - prefer: the store ranked highest (earliest in `stores`) takes the item, unless the cheapest offer for this item
 *   saves at least minSaving dollars against it. The saving is measured on the item's packs, not per unit.
 */
function pickOffer(options: Offer[], qty: number, stores: string[], pref: StorePreference): Offer | undefined {
  if (options.length === 0) return undefined;
  if (pref.mode === 'cheapest') return cheapest(options);
  const rank = (o: Offer) => stores.indexOf(o.store);
  const top = options.reduce((best, o) => (rank(o) < rank(best) ? o : best));
  const low = options.reduce((best, o) => {
    const c = costOf(o, qty);
    const b = costOf(best, qty);
    return c < b - CENTS || (Math.abs(c - b) <= CENTS && rank(o) < rank(best)) ? o : best;
  });
  if (low.store !== top.store && costOf(low, qty) <= costOf(top, qty) - pref.minSaving + CENTS) return low;
  return top;
}

interface StoreCandidate {
  uncovered: number;
  total: number;
  size: number;
  rankSum: number;
  picks: Map<string, Offer>;
}

/**
 * Pick one store per ingredient, minimising stores used and cost.
 *
 * Every subset of the enabled stores up to maxStores is tried, and every subset must include the `required` stores
 * (the stores pins name). Each ingredient takes its offer from the subset by pickOffer. An ingredient no store in
 * the subset sells is left out (uncovered), never bought from a store outside the subset, so the list never uses
 * more than maxStores stores. Required stores over the limit become the only subset.
 *
 * cheapest: fewest uncovered, then lowest total, then fewest stores.
 * prefer: fewest uncovered, then the subsets whose total is within minSaving of the cheapest (the cheapest itself
 * always counts). Among those, the lowest rank sum wins, where a store's rank is its place in `stores`. Then lowest
 * total, then fewest stores. A lower-ranked set of stores therefore wins only when it saves at least minSaving.
 */
function assignStores(
  ids: string[],
  qty: Map<string, number>,
  offers: Map<string, Offer[]>,
  stores: string[],
  maxStores: number,
  pref: StorePreference,
  required: string[],
): Map<string, Offer> {
  const cap = Math.max(1, maxStores);
  const subsets =
    required.length > cap
      ? [required]
      : subsetsUpTo(stores, cap).filter((sub) => required.every((r) => sub.includes(r)));

  const cands: StoreCandidate[] = subsets.map((subset) => {
    const picks = new Map<string, Offer>();
    let uncovered = 0;
    let total = 0;
    for (const id of ids) {
      const q = qty.get(id) ?? 0;
      const pick = pickOffer((offers.get(id) ?? []).filter((o) => subset.includes(o.store)), q, stores, pref);
      if (!pick) {
        uncovered++;
        continue;
      }
      picks.set(id, pick);
      total += costOf(pick, q);
    }
    return {
      uncovered,
      total,
      size: subset.length,
      rankSum: subset.reduce((n, s) => n + stores.indexOf(s), 0),
      picks,
    };
  });
  if (cands.length === 0) return new Map();

  const fewest = Math.min(...cands.map((c) => c.uncovered));
  const pool = cands.filter((c) => c.uncovered === fewest);
  const byTotalThenSize = (a: StoreCandidate, b: StoreCandidate) =>
    Math.abs(a.total - b.total) > CENTS ? a.total - b.total : a.size - b.size;

  let best: StoreCandidate;
  if (pref.mode === 'cheapest') {
    best = pool.reduce((a, b) => (byTotalThenSize(b, a) < 0 ? b : a));
  } else {
    const floor = Math.min(...pool.map((c) => c.total));
    const acceptable = pool.filter((c) => c.total - floor <= CENTS || c.total - floor < pref.minSaving - CENTS);
    best = acceptable.reduce((a, b) => {
      if (b.rankSum !== a.rankSum) return b.rankSum < a.rankSum ? b : a;
      return byTotalThenSize(b, a) < 0 ? b : a;
    });
  }
  return best.picks;
}

/**
 * The shopping list for planned meals plus fixed meals. Quantities are summed per ingredient,
 * packs are rounded up, and stores are chosen by assignStores. Items with no enabled store
 * get store 'Unpriced' and a zero total.
 *
 * Price-match hint: when an item's store is in priceMatchStores and a store outside the chosen
 * set sells it at least 10% cheaper per unit, the item carries that store as priceMatch.
 *
 * Pantry: stock on hand is taken off each ingredient's quantity before packs are counted, so
 * ingredients the pantry covers fully are not bought at all.
 *
 * Store cap: never more than maxStores stores. An item outside the chosen stores is Unpriced, and
 * carries cheapestElsewhere when an enabled store sells it.
 *
 * Pins: a pinned ingredient on the list is bought at its store, which counts toward maxStores. With no known price
 * there, it is listed under that store with priceUnknown. A pin to a store that is turned off is ignored here, and
 * validate reports it.
 *
 * Estimates: receipt prices (options.estimates) take part like flyer prices, but a flyer price for the same store
 * always wins.
 *
 * Sort: store (highest subtotal first, Unpriced last), then CATEGORY_ORDER, then name.
 */
export function buildList(
  meals: PlannedMeal[],
  fixed: FixedCost,
  deals: Deal[],
  matched: MatchedItem[],
  stores: string[],
  maxStores: number,
  priceMatchStores: string[] = [],
  pantry: PantryItem[] = [],
  options: BuildListOptions = {},
): ListItem[] {
  const storeSet = new Set(stores);
  const offers = collectOffers(deals, matched, (s) => storeSet.has(s), options.estimates ?? []);
  const pref = options.preference ?? CHEAPEST;

  const qty = new Map<string, number>();
  const usedIn = new Map<string, Set<string>>();
  const add = (id: string, amount: number, uses: string[]) => {
    qty.set(id, (qty.get(id) ?? 0) + amount);
    const set = usedIn.get(id) ?? new Set<string>();
    uses.forEach((u) => set.add(u));
    usedIn.set(id, set);
  };
  for (const m of meals) for (const ing of m.ingredients) add(ing.ingredientId, ing.qty, [m.id]);
  for (const n of fixed.needs) add(n.ingredientId, n.qty, n.usedIn);
  // Kept staples are free and never bought: they come off the quantities before any pack is counted.
  for (const id of options.onHand ?? []) qty.delete(id);

  if (pantry.length > 0) {
    const { remaining } = subtractPantry(
      [...qty].map(([ingredientId, q]) => ({ ingredientId, qty: q })),
      pantry,
    );
    qty.clear();
    for (const r of remaining) qty.set(r.ingredientId, r.qty);
  }

  const needed = [...qty.keys()].filter((id) => (qty.get(id) ?? 0) > 0);
  const pinStore = new Map<string, string>();
  for (const p of options.pins ?? []) {
    if (storeSet.has(p.store) && !pinStore.has(p.ingredientId)) pinStore.set(p.ingredientId, p.store);
  }
  const pinned = needed.filter((id) => pinStore.has(id));
  const pinnedStores = [...new Set(pinned.map((id) => pinStore.get(id)!))];
  const priced = needed.filter((id) => !pinStore.has(id) && (offers.get(id)?.length ?? 0) > 0);
  const picks = assignStores(priced, qty, offers, stores, maxStores, pref, pinnedStores);
  const chosen = new Set([...picks.values()].map((o) => o.store).concat(pinnedStores));

  const items: ListItem[] = [];
  for (const id of pinned) {
    const store = pinStore.get(id)!;
    const catalog = INGREDIENT_BY_ID[id];
    const base = {
      ingredientId: id,
      name: catalog?.name ?? id,
      category: (catalog?.category ?? 'pantry') as Category,
      usedIn: [...(usedIn.get(id) ?? [])],
      pinned: true,
    };
    const q = qty.get(id) ?? 0;
    const offer = (offers.get(id) ?? []).find((o) => o.store === store);
    if (!offer) {
      items.push({ ...base, store, packs: 0, packQty: 0, packPrice: 0, total: 0, needed: Number(q.toFixed(3)), priceUnknown: true });
      continue;
    }
    const packs = packsFor(q, offer.packQty);
    items.push({
      ...base,
      store,
      packs,
      packQty: offer.packQty,
      packPrice: offer.packPrice,
      total: round2(packs * offer.packPrice),
      ...(offer.estimate ? { estimate: offer.estimate } : {}),
    });
  }

  const unpriced: string[] = needed.filter((id) => !pinStore.has(id) && !picks.has(id));
  for (const id of priced) {
    const pick = picks.get(id);
    if (!pick) continue;
    const catalog = INGREDIENT_BY_ID[id];
    const packs = packsFor(qty.get(id) ?? 0, pick.packQty);
    const item: ListItem = {
      ingredientId: id,
      name: catalog?.name ?? id,
      category: (catalog?.category ?? 'pantry') as Category,
      store: pick.store,
      packs,
      packQty: pick.packQty,
      packPrice: pick.packPrice,
      total: round2(packs * pick.packPrice),
      usedIn: [...(usedIn.get(id) ?? [])],
      ...(pick.estimate ? { estimate: pick.estimate } : {}),
    };
    if (priceMatchStores.includes(pick.store)) {
      const other = cheapest((offers.get(id) ?? []).filter((o) => !chosen.has(o.store)));
      if (other && other.pricePerUnit <= pick.pricePerUnit * (1 - PRICE_MATCH_GAP)) {
        item.priceMatch = { fromStore: other.store, pricePerUnit: other.pricePerUnit };
      }
    }
    items.push(item);
  }
  for (const id of unpriced) {
    const catalog = INGREDIENT_BY_ID[id];
    // Offers are already limited to enabled stores, and none of them is a chosen store.
    const elsewhere = cheapest(offers.get(id) ?? []);
    items.push({
      ingredientId: id,
      name: catalog?.name ?? id,
      category: (catalog?.category ?? 'pantry') as Category,
      store: 'Unpriced',
      packs: 0,
      packQty: 0,
      packPrice: 0,
      total: 0,
      usedIn: [...(usedIn.get(id) ?? [])],
      needed: Number((qty.get(id) ?? 0).toFixed(3)),
      ...(elsewhere ? { cheapestElsewhere: { store: elsewhere.store, price: elsewhere.packPrice } } : {}),
    });
  }

  // Custom fixed-meal items have no catalogue entry, so no store sells them: they go in the unpriced group as typed.
  for (const c of fixed.customNeeds ?? []) {
    items.push({
      ingredientId: `custom:${c.name.toLowerCase()}|${c.unit}`,
      name: c.name,
      label: c.name,
      category: 'pantry',
      store: 'Unpriced',
      packs: 0,
      packQty: 0,
      packPrice: 0,
      total: 0,
      usedIn: [...new Set(c.usedIn)],
      needed: Number(c.qty.toFixed(3)),
      qtyText: `${Number(c.qty.toFixed(2))} ${c.unit}`,
      custom: true,
    });
  }

  const storeTotal = new Map<string, number>();
  for (const it of items) storeTotal.set(it.store, (storeTotal.get(it.store) ?? 0) + it.total);
  return items.sort((a, b) => {
    if (a.store !== b.store) {
      if (a.store === 'Unpriced') return 1;
      if (b.store === 'Unpriced') return -1;
      const diff = (storeTotal.get(b.store) ?? 0) - (storeTotal.get(a.store) ?? 0);
      if (diff !== 0) return diff;
      return a.store.localeCompare(b.store);
    }
    const cat = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    return cat !== 0 ? cat : a.name.localeCompare(b.name);
  });
}

// ---------- validation ----------

export interface ValidateContext {
  household: Household;
  cells: SlotCell[];
  fixed: FixedCost;
  available: ReadonlySet<string>; // ingredient ids the planner was offered
  neverBuy: ReadonlySet<string>;
  neverWords?: string[]; // never-buy names as typed, e.g. "beef": no meal name may contain them
  recentDinnerNames: string[];
  useFirst?: { ingredientId: string; expiresOn: string }[]; // pantry stock due soon, when use-it-up is on
  neverMeals?: string[]; // meal names rated 'never'
  formBlocked?: ReadonlySet<string>; // ingredient ids whose form the household does not keep
  avoidDishes?: string[]; // dish words the household does not want, as typed
}

function proteinOf(meal: PlannedMeal): string | undefined {
  for (const ing of meal.ingredients) {
    const p = INGREDIENT_BY_ID[ing.ingredientId]?.protein;
    if (p) return p;
  }
  return undefined;
}

function checkIngredients(plan: MealPlan, ctx: ValidateContext): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const meal of plan.meals) {
    for (const ing of meal.ingredients) {
      // A form the household does not keep is reported by checkForms, not as an unknown ingredient.
      if (ctx.formBlocked?.has(ing.ingredientId)) continue;
      if (!ctx.available.has(ing.ingredientId)) {
        out.push({
          check: 'unknown-ingredient',
          severity: 'error',
          message: `"${meal.name}" uses ${ingName(ing.ingredientId)} (${ing.ingredientId}), which is not in the available list. Use only ids from available.`,
        });
      }
      if (ctx.neverBuy.has(ing.ingredientId)) {
        out.push({
          check: 'never-buy',
          severity: 'error',
          message: `${ingName(ing.ingredientId)} is on the never-buy list, but "${meal.name}" uses it. Replace it with another ingredient.`,
        });
      }
    }
  }
  return out;
}

/** "fresh", "fresh or frozen", "fresh, frozen or canned". */
const orList = (words: string[]) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`);

/** A planned ingredient in a form the household does not keep ("canned tuna" when canned fish is off). */
function checkForms(plan: MealPlan, ctx: ValidateContext): ValidationIssue[] {
  const blocked = ctx.formBlocked;
  if (!blocked || blocked.size === 0) return [];
  const out: ValidationIssue[] = [];
  for (const meal of plan.meals) {
    for (const ing of meal.ingredients) {
      if (!blocked.has(ing.ingredientId)) continue;
      const info = INGREDIENT_BY_ID[ing.ingredientId];
      const group = formGroupOf(ing.ingredientId);
      if (!info?.form || !group) continue;
      const kept = allowedForms(ctx.household.forms, group).map((f) => FORM_LABEL[f].toLowerCase());
      const hint = kept.length > 0 ? ` Use ${orList(kept)} instead.` : '';
      out.push({
        check: 'form',
        severity: 'error',
        message: `"${meal.name}" uses ${info.name}, which is ${FORM_LABEL[info.form].toLowerCase()}, and you don't keep that form of ${FORM_GROUP_LABEL[group].toLowerCase()}.${hint}`,
      });
    }
  }
  return out;
}

/** A meal whose name is a dish the household does not want ("Coleslaw" when "slaw" is avoided). */
function checkAvoidDishes(plan: MealPlan, ctx: ValidateContext): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const meal of plan.meals) {
    const word = avoidedDish(meal.name, ctx.avoidDishes);
    if (word === undefined) continue;
    out.push({
      check: 'avoid-dish',
      severity: 'error',
      message: `Replace ${meal.name}: it's a ${word} dish, which you don't want.`,
    });
  }
  return out;
}

/** A meal named after a never-buy word ("Beef stir-fry" for "beef") is planned around it, listed ingredients or not. */
function checkNeverNames(plan: MealPlan, ctx: ValidateContext): ValidationIssue[] {
  const words = ctx.neverWords ?? [];
  if (words.length === 0) return [];
  const out: ValidationIssue[] = [];
  for (const meal of plan.meals) {
    const word = words.find((w) => nameHasWord(meal.name, w));
    if (word === undefined) continue;
    out.push({
      check: 'never-buy',
      severity: 'error',
      message: `"${meal.name}" is built around ${word.toLowerCase()}, which is on the never-buy list. Plan a meal without it.`,
    });
  }
  return out;
}

/** A guest's name in messages: "guest-2" reads "Guest 2". */
const guestName = (id: string) => `Guest ${id.replace(/^guest-/, '')}`;

/**
 * Allergies are checked for every eater of a meal: household members from the household, and guests who joined a swapped
 * meal from the plan's guest list. A guest's allergy is held to the same rule as a person's.
 */
function checkAllergens(plan: MealPlan, ctx: ValidateContext): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const meal of plan.meals) {
    for (const eaterId of meal.eaters) {
      const person = ctx.household.people.find((p) => p.id === eaterId);
      const guest = person ? undefined : plan.guests?.[eaterId];
      const allergies = person ? person.allergies : (guest?.allergies ?? []);
      const label = person ? person.name : guestName(eaterId);
      if (!person && !guest) continue;
      if (allergies.length === 0) continue;
      const hits = meal.ingredients
        .map((ing) => ({ name: ingName(ing.ingredientId), clash: (INGREDIENT_BY_ID[ing.ingredientId]?.allergens ?? []).filter((a) => allergies.includes(a)) }))
        .filter((h) => h.clash.length > 0);
      if (hits.length === 0) continue;
      const allergens = [...new Set(hits.flatMap((h) => h.clash))].join(', ');
      const names = hits.map((h) => h.name).join(', ');
      out.push({
        check: 'allergen',
        severity: 'error',
        message: `${label} is allergic to ${allergens}, and "${meal.name}" uses ${names}, which ${label} eats. Replace ${names} in that meal.`,
      });
    }
  }
  return out;
}

function checkCoverage(plan: MealPlan, ctx: ValidateContext): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const counts = new Map<string, number>();
  for (const m of plan.meals) {
    const key = `${m.day}-${m.slot}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const cell of ctx.cells) {
    const n = counts.get(`${cell.day}-${cell.slot}`) ?? 0;
    const label = cellLabel(cell.day, cell.slot);
    if (n === 0) {
      out.push({
        check: 'slot-coverage',
        severity: 'error',
        message: `No meal for ${label}. Add a ${cell.slot} for ${cell.eaters.length} ${cell.eaters.length === 1 ? 'person' : 'people'} on ${DAY_LONG[cell.day]}.`,
      });
    } else if (n > 1) {
      out.push({ check: 'slot-coverage', severity: 'error', message: `${n} meals for ${label}. Keep one.` });
    }
  }
  const cellKeys = new Set(ctx.cells.map((c) => `${c.day}-${c.slot}`));
  for (const m of plan.meals) {
    if (!cellKeys.has(`${m.day}-${m.slot}`)) {
      out.push({
        check: 'slot-coverage',
        severity: 'error',
        message: `"${m.name}" is for ${cellLabel(m.day, m.slot)}, which has nobody eating. Remove it.`,
      });
    }
  }
  return out;
}

function checkBudget(plan: MealPlan): ValidationIssue[] {
  const budget = plan.request.budget;
  if (plan.totalCost <= budget + 1e-9) return [];
  const over = round2(plan.totalCost - budget);
  // totalCost already includes the fixed meals, so only the list is compared with the budget.
  const top = plan.list
    .filter((i) => i.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 2);
  const topText = top.map((i) => `${i.name} ($${i.total.toFixed(2)})`).join(', ');
  const swap = top[0] ? ` Swap one meal that uses ${top[0].name.toLowerCase()} for a cheaper protein.` : '';
  return [
    {
      check: 'budget',
      severity: 'error',
      message: `Over budget by $${over.toFixed(2)}.${top.length ? ` Most expensive: ${topText}.` : ''}${swap}`,
    },
  ];
}

function checkMacros(plan: MealPlan, ctx: ValidateContext): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const person of ctx.household.people) {
    if (person.proteinTargetG === undefined) continue;
    let protein = ctx.fixed.macrosByPerson[person.id]?.protein ?? 0;
    for (const meal of plan.meals) {
      if (!meal.eaters.includes(person.id)) continue;
      for (const ing of meal.ingredients) {
        const info = INGREDIENT_BY_ID[ing.ingredientId];
        if (!info) continue;
        protein += nutrientTotals(info, ing.qty).protein / meal.eaters.length;
      }
    }
    const avg = protein / MACRO_DAYS;
    if (avg < person.proteinTargetG * MACRO_FLOOR) {
      out.push({
        check: 'macros',
        severity: 'warning',
        message: `${person.name} averages ${Math.round(avg)} g of protein a day against a ${person.proteinTargetG} g target. Add a protein-rich lunch or make one dinner a higher-protein main.`,
      });
    }
  }
  return out;
}

function checkWaste(plan: MealPlan, ctx: ValidateContext): ValidationIssue[] {
  const used = new Map<string, number>();
  const addUsed = (id: string, q: number) => used.set(id, (used.get(id) ?? 0) + q);
  for (const m of plan.meals) for (const ing of m.ingredients) addUsed(ing.ingredientId, ing.qty);
  for (const n of ctx.fixed.needs) addUsed(n.ingredientId, n.qty);

  const out: ValidationIssue[] = [];
  for (const item of plan.list) {
    const info = INGREDIENT_BY_ID[item.ingredientId];
    if (!info || info.shelfLifeDays >= SHORT_SHELF_DAYS || item.packs === 0) continue;
    const bought = item.packs * item.packQty;
    const usedQty = used.get(item.ingredientId) ?? 0;
    if ((bought - usedQty) / bought > WASTE_LIMIT) {
      const unit = unitLabel(info.baseUnit);
      out.push({
        check: 'waste',
        severity: 'warning',
        message: `${item.name}: ${round2(bought)} ${unit} bought but only ${round2(usedQty)} ${unit} used, and it spoils within a week. Plan another meal with it, or buy a smaller pack.`,
      });
    }
  }
  return out;
}

function checkBusy(plan: MealPlan, ctx: ValidateContext): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const meal of plan.meals) {
    const cell = ctx.cells.find((c) => c.day === meal.day && c.slot === meal.slot);
    if (cell?.maxMinutes !== undefined) {
      if (meal.activeMinutes > cell.maxMinutes) {
        out.push({
          check: 'busy',
          severity: 'error',
          message: `"${meal.name}" takes ${meal.activeMinutes} active minutes, but ${cellLabel(meal.day, meal.slot)} allows ${cell.maxMinutes}. Choose a quicker recipe.`,
        });
      }
    } else if (meal.slot === 'dinner' && isWeeknight(meal.day) && meal.activeMinutes > WEEKNIGHT_MINUTES) {
      out.push({
        check: 'busy',
        severity: 'warning',
        message: `"${meal.name}" takes ${meal.activeMinutes} active minutes. Weeknight dinners should take ${WEEKNIGHT_MINUTES} or fewer. Simplify it.`,
      });
    }
  }
  return out;
}

/** With use-it-up on, every pantry item due soon should appear in a meal. */
function checkUseItUp(plan: MealPlan, ctx: ValidateContext): ValidationIssue[] {
  if (!plan.request.useItUp || !ctx.useFirst || ctx.useFirst.length === 0) return [];
  const used = new Set<string>();
  for (const m of plan.meals) for (const ing of m.ingredients) used.add(ing.ingredientId);
  for (const n of ctx.fixed.needs) used.add(n.ingredientId);
  const out: ValidationIssue[] = [];
  const reported = new Set<string>();
  for (const item of ctx.useFirst) {
    if (used.has(item.ingredientId) || reported.has(item.ingredientId)) continue;
    reported.add(item.ingredientId);
    out.push({
      check: 'use-it-up',
      severity: 'warning',
      message: `Use ${ingName(item.ingredientId)} before ${formatUseBy(item.expiresOn)}: add it to a meal.`,
    });
  }
  return out;
}

/** A meal rated 'never' must not come back, whatever name the planner gives it. */
function checkNeverAgain(plan: MealPlan, ctx: ValidateContext): ValidationIssue[] {
  if (!ctx.neverMeals || ctx.neverMeals.length === 0) return [];
  const never = new Set(ctx.neverMeals.map((n) => n.trim().toLowerCase()));
  return plan.meals
    .filter((m) => never.has(m.name.trim().toLowerCase()))
    .map((m) => ({
      check: 'never-again' as const,
      severity: 'error' as const,
      message: `"${m.name}" was marked never again by the household. Replace it with a different meal.`,
    }));
}

const words = (s: string) => s.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 4);

function nameMatches(mealName: string, craving: string): boolean {
  const name = mealName.toLowerCase();
  const c = craving.toLowerCase().trim();
  if (c && name.includes(c)) return true;
  const mealWords = new Set(words(mealName));
  return words(craving).some((w) => mealWords.has(w));
}

/**
 * Each craving needs a meal whose name matches it (whole-word overlap of 4+ letters, or a
 * substring). A craving with no name match can take a meal tagged 'craving' that no other
 * craving has claimed.
 */
function checkCravings(plan: MealPlan): ValidationIssue[] {
  const claimed = new Set<string>();
  const unmatched: string[] = [];
  for (const craving of plan.request.cravings) {
    const hit = plan.meals.find((m) => !claimed.has(m.id) && nameMatches(m.name, craving));
    if (hit) claimed.add(hit.id);
    else unmatched.push(craving);
  }
  const out: ValidationIssue[] = [];
  for (const craving of unmatched) {
    const tagged = plan.meals.find((m) => !claimed.has(m.id) && m.tags.includes('craving'));
    if (tagged) {
      claimed.add(tagged.id);
      continue;
    }
    out.push({
      check: 'cravings',
      severity: 'warning',
      message: `No meal in the plan is "${craving}". Add a dinner with that name, or tag one meal with the craving tag.`,
    });
  }
  return out;
}

function checkVariety(plan: MealPlan, ctx: ValidateContext): ValidationIssue[] {
  const rules = ctx.household.varietyRules;
  const out: ValidationIssue[] = [];
  const dinners = plan.meals.filter((m) => m.slot === 'dinner');

  if (rules.noRepeatProteinConsecutive) {
    const byDay = dinners
      .map((m) => ({ meal: m, idx: dayIndex(m.day), protein: proteinOf(m) }))
      .filter((d): d is { meal: PlannedMeal; idx: number; protein: string } => d.protein !== undefined)
      .sort((a, b) => a.idx - b.idx);
    for (let i = 1; i < byDay.length; i++) {
      const prev = byDay[i - 1]!;
      const cur = byDay[i]!;
      if (cur.idx === prev.idx + 1 && cur.protein === prev.protein) {
        out.push({
          check: 'variety',
          severity: 'error',
          message: `${DAY_LONG[prev.meal.day]} and ${DAY_LONG[cur.meal.day]} dinners both use ${cur.protein}. Make one of them a different protein.`,
        });
      }
    }
  }

  if (rules.noRepeatDinner14) {
    const recent = new Set(ctx.recentDinnerNames.map((n) => n.trim().toLowerCase()));
    const reported = new Set<string>();
    for (const m of dinners) {
      const key = m.name.trim().toLowerCase();
      if (recent.has(key) && !reported.has(key)) {
        reported.add(key);
        out.push({
          check: 'variety',
          severity: 'error',
          message: `"${m.name}" was served in the last 14 days. Choose a different dinner.`,
        });
      }
    }
  }

  if (rules.minVeg5) {
    const used = new Set<string>();
    for (const m of plan.meals) for (const ing of m.ingredients) used.add(ing.ingredientId);
    for (const n of ctx.fixed.needs) used.add(n.ingredientId);
    const vegs = [...used].filter(isVegetable);
    if (vegs.length < VEG_TARGET) {
      const extras = [...ctx.available].filter((id) => isVegetable(id) && !used.has(id)).slice(0, 3).map(ingName);
      const hint = extras.length ? ` Add ${extras.join(', ')} to a meal.` : ' Add more vegetables to a meal.';
      out.push({
        check: 'variety',
        severity: 'error',
        message: `Only ${vegs.length} vegetables this week, and the rule needs ${VEG_TARGET}.${hint}`,
      });
    }
  }

  if (rules.oneVegDinner) {
    const hasVegDinner = dinners.some(
      (m) => m.ingredients.length > 0 && m.ingredients.every((ing) => INGREDIENT_BY_ID[ing.ingredientId]?.vegetarian === true),
    );
    if (!hasVegDinner) {
      out.push({
        check: 'variety',
        severity: 'error',
        message: 'No dinner is vegetarian this week. Make one dinner from beans, lentils, tofu or vegetables only.',
      });
    }
  }
  return out;
}

function checkUnpriced(plan: MealPlan): ValidationIssue[] {
  return plan.list
    // A custom fixed-meal item is not in the catalogue, so its missing price is already warned about with the fixed meal.
    .filter((i) => i.store === 'Unpriced' && !i.cheapestElsewhere && !i.custom)
    .map((i) => ({
      check: 'unknown-ingredient' as const,
      severity: 'warning' as const,
      message: `No enabled store sells ${i.name.toLowerCase()}, so it is not priced. Check the shelf price, or remove it from the meal.`,
    }));
}

/** Items left out of the list because the chosen stores do not sell them. Warned, never retried. */
function checkStoreCap(plan: MealPlan, ctx: ValidateContext): ValidationIssue[] {
  const n = plan.list.filter((i) => i.store === 'Unpriced' && i.cheapestElsewhere).length;
  if (n === 0) return [];
  const m = ctx.household.maxStores;
  const subject = n === 1 ? "1 item isn't" : `${n} items aren't`;
  const object = n === 1 ? 'it' : 'them';
  return [
    {
      check: 'store-cap',
      severity: 'warning',
      message: `${subject} in your top ${m} ${m === 1 ? "store's" : "stores'"} flyers; buy ${object} anywhere or allow more stores.`,
    },
  ];
}

/**
 * Pins the list cannot follow: a pinned store that is turned off, and more pinned stores than the household allows.
 * A pinned item still on the list is named; the others are not in this week's plan.
 */
function checkPins(plan: MealPlan, ctx: ValidateContext): ValidationIssue[] {
  const pins = pinsOf(ctx.household.itemRules);
  if (pins.length === 0) return [];
  const enabled = new Set(ctx.household.stores.filter((s) => s.enabled).map((s) => s.name));
  const listed = new Map(plan.list.map((i) => [i.ingredientId, i]));
  const out: ValidationIssue[] = [];
  const pinnedStores = new Set<string>();
  for (const pin of pins) {
    const item = listed.get(pin.ingredientId);
    if (!item) continue;
    if (!enabled.has(pin.store)) {
      // "Eggs are pinned to Costco", "Canned tuna is pinned to Costco": the verb follows the name's plural.
      const verb = /s$/i.test(item.name) ? 'are' : 'is';
      out.push({
        check: 'pin',
        severity: 'warning',
        message: `${item.name} ${verb} pinned to ${pin.store}, which is turned off. Turn ${pin.store} on, or remove the pin.`,
      });
      continue;
    }
    pinnedStores.add(pin.store);
  }
  const m = ctx.household.maxStores;
  if (pinnedStores.size > m) {
    out.push({
      check: 'pin',
      severity: 'warning',
      message: `Pins use ${pinnedStores.size} stores, more than your limit of ${m}. Remove a pin, or raise the limit.`,
    });
  }
  return out;
}

/**
 * A non-staple ingredient in more than MAX_MEALS_PER_INGREDIENT meals of the week. Each meal past the limit is an error,
 * so the repair rewrites those meals and the first ones keep the ingredient.
 */
function checkRepetition(plan: MealPlan): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const [id, meals] of repeatedMeals(plan.meals)) {
    for (const meal of meals) {
      out.push({
        check: 'repetition',
        severity: 'error',
        message: `"${meal.name}" is one of more than ${MAX_MEALS_PER_INGREDIENT} meals this week using ${ingName(id)}. Use a different ingredient here, or let the rest of the pack go to waste.`,
      });
    }
  }
  return out;
}

/** Most dinners one cuisine may take in a week. More is a warning: the plan is still shown. */
export const MAX_DINNERS_PER_CUISINE = 3;

/**
 * A dinner from a cuisine the household never eats, or one cuisine more than MAX_DINNERS_PER_CUISINE dinners in the week.
 * Warnings, never retried: the planner is told the rule in its prompt.
 */
function checkCuisine(plan: MealPlan, ctx: ValidateContext): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const label = (key: string) => CUISINES.find((c) => c.key === key)?.label ?? key;
  for (const m of plan.meals) {
    if (!m.cuisine || cuisineLevel(ctx.household.cuisines, m.cuisine) !== 'never') continue;
    out.push({
      check: 'cuisine',
      severity: 'warning',
      message: `"${m.name}" is ${label(m.cuisine)}, a cuisine the household never eats. Plan a dinner from a cuisine it eats.`,
    });
  }
  const dinners = new Map<string, number>();
  for (const m of plan.meals) if (m.slot === 'dinner' && m.cuisine) dinners.set(m.cuisine, (dinners.get(m.cuisine) ?? 0) + 1);
  for (const [key, n] of dinners) {
    if (n <= MAX_DINNERS_PER_CUISINE) continue;
    out.push({
      check: 'cuisine',
      severity: 'warning',
      message: `${n} dinners are ${label(key)} this week, more than ${MAX_DINNERS_PER_CUISINE}. Mix in another cuisine.`,
    });
  }
  return out;
}

/** Every check on a plan. Errors make the planner retry. Warnings are shown to the user. */
export function validate(plan: MealPlan, ctx: ValidateContext): ValidationIssue[] {
  return [
    ...checkIngredients(plan, ctx),
    ...checkNeverNames(plan, ctx),
    ...checkForms(plan, ctx),
    ...checkAvoidDishes(plan, ctx),
    ...checkAllergens(plan, ctx),
    ...checkCoverage(plan, ctx),
    ...checkBudget(plan),
    ...checkMacros(plan, ctx),
    ...checkWaste(plan, ctx),
    ...checkBusy(plan, ctx),
    ...checkCravings(plan),
    ...checkVariety(plan, ctx),
    ...checkUnpriced(plan),
    ...checkStoreCap(plan, ctx),
    ...checkPins(plan, ctx),
    ...checkUseItUp(plan, ctx),
    ...checkNeverAgain(plan, ctx),
    ...checkRepetition(plan),
    ...checkCuisine(plan, ctx),
  ];
}
