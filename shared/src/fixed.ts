import { INGREDIENT_BY_ID, type Category } from './catalog';
import type { FixedPlacement } from './grid';
import type { Household } from './index';
import type { ListItem, ValidationIssue } from './plan';
import { matchIngredient, type MatchedItem } from './match';
import { collectOffers, cheapest, packsFor } from './offers';
import type { Deal } from './scoring';
import { nutrientTotals, round2, toBaseUnitQty, type InputUnit } from './units';

/** What fixed meals need from the shop, in base units, shared with the planned meals. */
export interface FixedNeed {
  ingredientId: string;
  qty: number;
  usedIn: string[]; // placement ids
}

/** A fixed-meal ingredient that is not in the catalogue, as typed, summed over the week. */
export interface CustomNeed {
  name: string;
  qty: number;
  unit: InputUnit;
  usedIn: string[]; // placement ids
}

export interface FixedCost {
  cost: number; // the fixed meals bought on their own, at the cheapest enabled store
  listItems: ListItem[];
  macrosByPerson: Record<string, { protein: number; kcal: number }>; // week totals
  leftovers: { ingredientId: string; qty: number }[]; // pack remainders
  needs: FixedNeed[];
  // Not in the catalogue: listed without a price. Optional, so older FixedCost values still type-check.
  customNeeds?: CustomNeed[];
  issues: ValidationIssue[];
}

/**
 * Cost the fixed meals. Each placement counts once per person eating it, so an ingredient's
 * quantity is qty x eaters x placements. Ingredients that do not match the catalogue are returned
 * as customNeeds, summed by lowercase name and unit, so the list can show them without a price.
 * Ingredients whose units do not convert get a warning and cost nothing. Unpriced catalogue
 * ingredients keep their need, so the joint list can show them.
 */
export function costFixedMeals(
  fixed: FixedPlacement[],
  household: Household,
  deals: Deal[],
  matchedItems: MatchedItem[],
): FixedCost {
  const mealById = new Map(household.fixedMeals.map((m) => [m.id, m]));
  const enabled = new Set(household.stores.filter((s) => s.enabled).map((s) => s.name));
  const storeOk = (store: string) => enabled.size === 0 || enabled.has(store);
  const offers = collectOffers(deals, matchedItems, storeOk);

  const needs = new Map<string, { qty: number; usedIn: string[] }>();
  const customs = new Map<string, CustomNeed>();
  const macrosByPerson: Record<string, { protein: number; kcal: number }> = {};
  const issues: ValidationIssue[] = [];
  const warned = new Set<string>();
  const warn = (key: string, message: string) => {
    if (warned.has(key)) return;
    warned.add(key);
    issues.push({ check: 'unknown-ingredient', severity: 'warning', message });
  };

  for (const placement of fixed) {
    const meal = mealById.get(placement.fixedMealId);
    if (!meal) continue;
    for (const ing of meal.ingredients) {
      const match = matchIngredient(ing.name);
      const catalog = match ? INGREDIENT_BY_ID[match.ingredientId] : undefined;
      if (!catalog) {
        const name = ing.name.trim();
        warn(`${meal.id}|${ing.name}`, `"${name}" isn't in the catalogue, so it's on the list without a price.`);
        const key = `${name.toLowerCase()}|${ing.unit}`;
        const custom = customs.get(key) ?? { name, qty: 0, unit: ing.unit, usedIn: [] };
        custom.qty += ing.qty * placement.eaters.length;
        if (!custom.usedIn.includes(placement.id)) custom.usedIn.push(placement.id);
        customs.set(key, custom);
        continue;
      }
      const perPerson = toBaseUnitQty(ing.qty, ing.unit, catalog.baseUnit);
      if (!Number.isFinite(perPerson)) {
        warn(`${meal.id}|${ing.name}|unit`, `Fixed meal "${meal.name}" measures "${ing.name}" in ${ing.unit}, which cannot be converted to ${catalog.baseUnit}. Change the unit.`);
        continue;
      }

      const n = nutrientTotals(catalog, perPerson);
      for (const eater of placement.eaters) {
        const m = (macrosByPerson[eater] ??= { protein: 0, kcal: 0 });
        m.protein += n.protein;
        m.kcal += n.kcal;
      }

      const need = needs.get(catalog.id) ?? { qty: 0, usedIn: [] };
      need.qty += perPerson * placement.eaters.length;
      need.usedIn.push(placement.id);
      needs.set(catalog.id, need);
    }
  }

  // Standalone cost: each ingredient at its cheapest enabled offer.
  let cost = 0;
  const listItems: ListItem[] = [];
  const leftovers: { ingredientId: string; qty: number }[] = [];
  for (const [ingredientId, need] of needs) {
    const catalog = INGREDIENT_BY_ID[ingredientId];
    if (!catalog) continue;
    const offer = cheapest(offers.get(ingredientId) ?? []);
    if (!offer) {
      warn(`unpriced|${ingredientId}`, `No enabled store sells ${catalog.name.toLowerCase()}, which the fixed meals need. Add it to a store's flyer or remove it from the fixed meal.`);
      continue;
    }
    const packs = packsFor(need.qty, offer.packQty);
    const total = round2(packs * offer.packPrice);
    cost += total;
    listItems.push({
      ingredientId,
      name: catalog.name,
      category: catalog.category as Category,
      store: offer.store,
      packs,
      packQty: offer.packQty,
      packPrice: offer.packPrice,
      total,
      usedIn: need.usedIn,
    });
    const remainder = packs * offer.packQty - need.qty;
    if (remainder > 1e-9) leftovers.push({ ingredientId, qty: remainder });
  }

  return {
    cost: round2(cost),
    listItems,
    macrosByPerson,
    leftovers,
    needs: [...needs].map(([ingredientId, n]) => ({ ingredientId, qty: n.qty, usedIn: n.usedIn })),
    customNeeds: [...customs.values()].filter((c) => c.qty > 0),
    issues,
  };
}
