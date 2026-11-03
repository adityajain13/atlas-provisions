import type { BaseUnit, Ingredient } from './catalog';

export type SizeUnit = 'g' | 'kg' | 'ml' | 'l' | 'lb' | 'oz' | 'each';

/**
 * A parsed pack size. `qty` is the size of ONE unit (one can, one bag);
 * `count` is the number of such units in a multipack ("12 x 355 mL" -> qty 355, count 12).
 * Use toBaseQty to get the total in kg / l / each.
 */
export interface ParsedSize {
  qty: number;
  unit: SizeUnit;
  count?: number;
}

export interface ParsedPrice {
  amount: number;
  per?: 'each' | 'lb' | 'kg' | '100g';
}

export const LB_KG = 0.4536;
const OZ_KG = 0.02835;

function unitOf(raw: string): SizeUnit {
  if (raw.startsWith('lb')) return 'lb';
  return raw as SizeUnit;
}

export function parseSize(text: string): ParsedSize | null {
  const t = text
    .toLowerCase()
    .replace(/,/g, '.')
    .trim();
  if (!t) return null;

  // Multipack: "12 x 355 mL", "12x355ml"
  let m = t.match(/(\d+)\s*(?:x|×)\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l|lbs?|oz)\b/);
  if (m) return { qty: Number(m[2]), unit: unitOf(m[3]!), count: Number(m[1]) };

  // Single weight or volume. First match wins, so "454 g / 1 lb" is 454 g.
  m = t.match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l|lbs?|oz)\b/);
  if (m) return { qty: Number(m[1]), unit: unitOf(m[2]!) };

  if (/\bdozen\b/.test(t)) return { qty: 12, unit: 'each' };

  m = t.match(/(\d+)\s*(?:pk|pack|ct)\b/);
  if (m) return { qty: Number(m[1]), unit: 'each' };

  if (/\b(ea|each)\b/.test(t)) return { qty: 1, unit: 'each' };
  if (/\bbunch\b/.test(t)) return { qty: 1, unit: 'each' };

  // "per lb" / "/lb" with no pack size: the price is for one pound.
  if (/\/\s*lb\b|\bper\s*lb\b/.test(t)) return { qty: 1, unit: 'lb' };

  return null;
}

export function parsePrice(text: string): ParsedPrice | null {
  const t = text.toLowerCase().trim();
  if (!t) return null;

  // "2/$5" -> 2.50 each
  let m = t.match(/(?:^|\s)(\d+)\s*\/\s*\$\s*(\d+(?:\.\d+)?)/);
  if (m) return { amount: Number(m[2]) / Number(m[1]), per: 'each' };

  // "3 for $10" -> 3.33 each
  m = t.match(/(\d+)\s*for\s*\$?\s*(\d+(?:\.\d+)?)/);
  if (m) return { amount: Number(m[2]) / Number(m[1]), per: 'each' };

  // "99¢"
  m = t.match(/(\d+(?:\.\d+)?)\s*¢/);
  if (m) return { amount: Number(m[1]) / 100 };

  // "$0.99/100 g"
  m = t.match(/\$?\s*(\d+(?:\.\d+)?)\s*\/\s*100\s*g\b/);
  if (m) return { amount: Number(m[1]), per: '100g' };

  // "$1.99/lb", "4.39/kg", "$0.99/ea"
  m = t.match(/\$?\s*(\d+(?:\.\d+)?)\s*\/\s*(lbs?|kg|each|ea)\b/);
  if (m) {
    const unit = m[2]!;
    const per = unit.startsWith('lb') ? 'lb' : unit === 'kg' ? 'kg' : 'each';
    return { amount: Number(m[1]), per };
  }

  // "1.99 lb" (per-pound price without a slash)
  m = t.match(/\$?\s*(\d+(?:\.\d+)?)\s*(lbs?|kg)\b/);
  if (m) {
    const per = m[2]!.startsWith('lb') ? 'lb' : 'kg';
    return { amount: Number(m[1]), per };
  }

  // "$3.99", "3.99"
  m = t.match(/\$?\s*(\d+(?:\.\d+)?)/);
  if (m) return { amount: Number(m[1]) };

  return null;
}

/**
 * Total quantity of a pack in the ingredient's base unit.
 * - kg / l targets: weights and volumes are converted, multiplied by count.
 * - each target: a count-style size ("6 pk", "dozen", "ea") gives its qty;
 *   a weight or volume size gives the count (or 1).
 * - Mismatched units (e.g. ml into kg) return NaN.
 */
export function toBaseQty(size: ParsedSize, baseUnit: BaseUnit): number {
  const count = size.count ?? 1;

  if (baseUnit === 'each') {
    return size.unit === 'each' ? size.qty : count;
  }

  if (baseUnit === 'kg') {
    let kg: number;
    switch (size.unit) {
      case 'kg':
        kg = size.qty;
        break;
      case 'g':
        kg = size.qty / 1000;
        break;
      case 'lb':
        kg = size.qty * LB_KG;
        break;
      case 'oz':
        kg = size.qty * OZ_KG;
        break;
      default:
        return NaN;
    }
    return kg * count;
  }

  // baseUnit === 'l'
  switch (size.unit) {
    case 'l':
      return size.qty * count;
    case 'ml':
      return (size.qty / 1000) * count;
    default:
      return NaN;
  }
}

/**
 * Unit price in the ingredient's base unit ($/kg, $/l or $/each).
 * Per-lb and per-kg prices are used directly when the base unit is kg.
 * Otherwise the pack price is divided by the pack quantity.
 * Returns null when it cannot be computed.
 */
export function pricePerBaseUnit(
  price: ParsedPrice,
  size: ParsedSize | null,
  ingredient: Pick<Ingredient, 'baseUnit'>,
): number | null {
  if (price.per === 'lb' || price.per === 'kg' || price.per === '100g') {
    if (ingredient.baseUnit !== 'kg') return null;
    const perKg =
      price.per === 'lb' ? price.amount / LB_KG : price.per === 'kg' ? price.amount : price.amount * 10;
    return Number.isFinite(perKg) && perKg > 0 ? perKg : null;
  }

  if (!size) {
    return ingredient.baseUnit === 'each' && price.amount > 0 ? price.amount : null;
  }

  const qty = toBaseQty(size, ingredient.baseUnit);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const perUnit = price.amount / qty;
  return Number.isFinite(perUnit) && perUnit > 0 ? perUnit : null;
}
