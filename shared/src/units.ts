import type { BaseUnit, Ingredient as CatalogIngredient } from './catalog';
import { toBaseQty, type SizeUnit } from './parse';

/** Units a household enters in fixed meals. */
export type InputUnit = 'g' | 'kg' | 'ml' | 'l' | 'each';

/**
 * Convert a quantity into an ingredient's base unit (kg, l or each).
 * Returns NaN when the units cannot be converted, such as ml into kg or g into each.
 */
export function toBaseUnitQty(qty: number, unit: InputUnit, baseUnit: BaseUnit): number {
  if (baseUnit === 'each') return unit === 'each' ? qty : NaN;
  if (unit === 'each') return NaN;
  return toBaseQty({ qty, unit: unit as SizeUnit }, baseUnit);
}

/**
 * Approximate mass in kg. Litres count as kg (water density). Each items use eachWeightKg,
 * or 0.1 kg when that is unknown.
 */
export function kgEquivalent(qty: number, ing: Pick<CatalogIngredient, 'baseUnit' | 'eachWeightKg'>): number {
  if (ing.baseUnit === 'each') return qty * (ing.eachWeightKg ?? 0.1);
  return qty;
}

/** Protein and energy in a quantity of an ingredient (qty in base units). */
export function nutrientTotals(
  ing: Pick<CatalogIngredient, 'baseUnit' | 'eachWeightKg' | 'nutritionPer100g'>,
  qty: number,
): { protein: number; kcal: number } {
  const grams = kgEquivalent(qty, ing) * 1000;
  return {
    protein: (grams * ing.nutritionPer100g.protein) / 100,
    kcal: (grams * ing.nutritionPer100g.kcal) / 100,
  };
}

/** The unit a household most likely measures an ingredient in when it is picked: grams for kg, ml for l, each for each. */
export function defaultInputUnit(baseUnit: BaseUnit): InputUnit {
  if (baseUnit === 'kg') return 'g';
  if (baseUnit === 'l') return 'ml';
  return 'each';
}

export function unitLabel(baseUnit: BaseUnit): string {
  return baseUnit === 'l' ? 'L' : baseUnit;
}

/** Round to cents. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
