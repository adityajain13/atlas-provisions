// How a meal's ingredient reads to a cook: "1 cup Jasmine rice", "⅓ head Green cabbage", "½ onion", "4 cloves".
// The planner's quantities stay in base units (kg, l, each). This layer only changes the words shown.
import { COOK_AMOUNTS, INGREDIENT_BY_ID, type CookAmount, type CookUnit, type Ingredient } from './catalog';

/**
 * Fractions a count may land on, after the whole part. A count snaps to the nearest one, so:
 * - cups and tablespoons: quarters and thirds ("1 cup", "1½ cups", "⅓ cup"), never eighths.
 * - teaspoons: eighths as well ("⅛ tsp", "½ tsp").
 * - heads: quarters and thirds, so 0.3 of a head reads "⅓ head".
 * - pieces, slices, fillets, bunches: halves. 100 g of onion (150 g each) reads "½ onion".
 * - cloves and cans: whole numbers only ("4 cloves").
 */
const STEPS: Record<CookUnit | 'default', number[]> = {
  cup: [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4],
  tbsp: [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4],
  tsp: [0, 1 / 8, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4],
  head: [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4],
  clove: [0],
  can: [0],
  piece: [0, 1 / 2],
  slice: [0, 1 / 2],
  fillet: [0, 1 / 2],
  bunch: [0, 1 / 2],
  g: [0],
  ml: [0],
  default: [0, 1 / 2],
};

/** Units that never read as plurals: "2 tbsp", "3 tsp", "250 g". */
const INVARIANT = new Set<string>(['tbsp', 'tsp', 'g', 'ml']);

const GLYPHS: Record<number, string> = { 125: '⅛', 250: '¼', 333: '⅓', 500: '½', 667: '⅔', 750: '¾' };

/** A count as a cook writes it: "2", "½", "1½", "⅓". Fractions come only from the glyph table. */
export function mixedNumber(value: number): string {
  const whole = Math.floor(value + 1e-9);
  const frac = Math.round((value - whole) * 1000);
  const glyph = frac === 0 ? '' : (GLYPHS[frac] ?? '');
  if (whole === 0) return glyph || '0';
  return `${whole}${glyph}`;
}

/** The count rounded to the unit's steps, never below its smallest non-zero step. Returns a value in units. */
export function snapCount(value: number, unit: CookUnit | undefined): number {
  const steps = STEPS[unit ?? 'default'];
  const whole = Math.floor(value + 1e-9);
  // Candidates: each step inside this whole, and the next whole (step 1).
  let best = whole + steps[0]!;
  for (const s of [...steps.slice(1), 1]) {
    const candidate = whole + s;
    if (Math.abs(candidate - value) < Math.abs(best - value) - 1e-9) best = candidate;
  }
  if (best > 0) return best;
  const smallest = steps.find((s) => s > 0) ?? 1;
  return smallest;
}

/** The noun for a count of a cook unit: the catalogue's singular and plural, or the unit's own name. */
function nounFor(cook: CookAmount, n: number): string {
  const singular = cook.singular ?? cook.unit;
  if (n <= 1) return singular;
  if (cook.plural) return cook.plural;
  if (INVARIANT.has(cook.unit)) return singular;
  if (/(s|x|ch|sh)$/.test(singular)) return `${singular}es`;
  if (/[^aeiou]y$/.test(singular)) return `${singular.slice(0, -1)}ies`;
  return `${singular}s`;
}

/** Grams (or millilitres) of an ingredient in a quantity in its base unit, or undefined when that cannot be known. */
function amountInMass(ing: Ingredient, qty: number): number | undefined {
  if (ing.baseUnit === 'kg' || ing.baseUnit === 'l') return qty * 1000;
  if (ing.eachWeightKg !== undefined) return qty * ing.eachWeightKg * 1000;
  return undefined;
}

/** Plain weight or volume, for ingredients with no cook measure: g under a kilogram, ml under a litre. */
function plainAmount(ing: Ingredient, qty: number): string {
  if (ing.baseUnit === 'kg' || ing.baseUnit === 'l' || ing.eachWeightKg !== undefined) {
    const grams = amountInMass(ing, qty) ?? 0;
    const isLiquid = ing.baseUnit === 'l';
    if (grams >= 1000) {
      const big = Number((grams / 1000).toFixed(2));
      return isLiquid ? `${big} L` : `${big} kg`;
    }
    return `${Math.max(1, Math.round(grams))} ${isLiquid ? 'ml' : 'g'}`;
  }
  const count = snapCount(qty, 'piece');
  return `${mixedNumber(count)} each`;
}

/**
 * The amount of an ingredient a cook reads, from its quantity in base units (kg, l or each):
 * "1 cup" for 0.2 kg of jasmine rice, "⅓ head" for 0.3 each of green cabbage, "½ onion" for 0.1 kg of onion,
 * "4 cloves" for 0.02 kg of garlic. Ingredients with no cook measure read as grams or millilitres.
 * Never returns a zero amount: a tiny quantity shows the smallest step, or "a pinch" for a spoon.
 */
export function formatCookAmount(ingredientId: string, qty: number): string {
  const ing = INGREDIENT_BY_ID[ingredientId];
  if (!ing) return `${Number(qty.toFixed(2))} each`;
  if (!(qty > 0)) return 'a pinch';
  const cook = ing.cook ?? COOK_AMOUNTS[ingredientId];
  const total = amountInMass(ing, qty);
  if (!cook || total === undefined || cook.unit === 'g' || cook.unit === 'ml') return plainAmount(ing, qty);

  const perUnit = cook.gramsPer ?? 1;
  const raw = total / perUnit;
  if (cook.unit === 'tsp' || cook.unit === 'tbsp') {
    // A spoon measure below an eighth of a teaspoon is a pinch, not "0 tsp".
    if (raw < 1 / 8 - 1e-9) return 'a pinch';
  }
  const count = snapCount(raw, cook.unit);
  const number = mixedNumber(count);
  return `${number} ${nounFor(cook, count)}`;
}
