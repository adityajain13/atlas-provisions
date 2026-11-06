// How a shopping-list line says how much to buy. "2 cans · $1.50 each" for items sold each, "2 × 700 g · $5.49 each"
// for weight and volume packs, "700 g" for one pack. The line total is shown separately, so the price here is per pack.
import type { BaseUnit } from '@provisions/shared';

/** A size in base units as a person reads it: "700 g", "1.5 kg", "250 mL", "2 L", "3 each". */
export function formatSize(qty: number, unit: BaseUnit): string {
  if (unit === 'kg') return qty < 1 ? `${Math.round(qty * 1000)} g` : `${Number(qty.toFixed(2))} kg`;
  if (unit === 'l') return qty < 1 ? `${Math.round(qty * 1000)} mL` : `${Number(qty.toFixed(2))} L`;
  return qty === 1 ? '1 each' : `${Number(qty.toFixed(2))} ct`;
}

/**
 * The noun for one 'each' item, from its catalogue label: "one can" is "can", "one dozen carton" is "carton",
 * "one pack of tortillas" is "pack". Undefined when the item has no label.
 */
export function eachNoun(eachLabel: string | undefined): string | undefined {
  if (!eachLabel) return undefined;
  const head = eachLabel.trim().toLowerCase().replace(/^one\s+/, '').split(/\s+of\s+/)[0] ?? '';
  const words = head.split(/\s+/).filter(Boolean);
  return words.at(-1);
}

/** The plural of a noun for a count: "can" and "cans", "loaf" and "loaves", "bunch" and "bunches". */
export function pluralize(noun: string, n: number): string {
  if (n === 1) return noun;
  if (/(s|x|ch|sh)$/.test(noun)) return `${noun}es`;
  if (noun.endsWith('f')) return `${noun.slice(0, -1)}ves`;
  if (/[^aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

/**
 * The quantity text for a line bought by need, with no pack price: "2 cartons" for 'each' items with a label, else the
 * size of the amount ("700 g"). Unpriced lines and lines with no price known use this.
 */
export function neededQuantity(needed: number, unit: BaseUnit, eachLabel?: string): string {
  const noun = unit === 'each' ? eachNoun(eachLabel) : undefined;
  if (noun) {
    const n = Number(needed.toFixed(2));
    return `${n} ${pluralize(noun, n)}`;
  }
  return formatSize(needed, unit);
}

export interface PackLine {
  unit: BaseUnit;
  packs: number; // packs bought
  packQty: number; // base units in one pack
  packPrice: number; // what one pack costs
  eachLabel?: string; // catalogue label for 'each' items, e.g. "one can"
}

/**
 * The quantity text for a priced line.
 * - each: the count of items and their noun, then the price of one item. One item is just "1 can".
 *   Without a label, "2 × $1.50 each" (or "1 each").
 * - kg and l: one pack is its size ("700 g"). More packs are "2 × 700 g · $5.49 each".
 */
export function packLineQuantity(line: PackLine): string {
  if (line.unit === 'each') {
    const count = line.packs * (line.packQty > 0 ? line.packQty : 1);
    const n = Number(count.toFixed(2));
    const noun = eachNoun(line.eachLabel);
    if (n === 1) return noun ? `1 ${noun}` : '1 each';
    const each = line.packQty > 0 ? line.packPrice / line.packQty : line.packPrice;
    if (!noun) return `${n} × $${each.toFixed(2)} each`;
    return `${n} ${pluralize(noun, n)} · $${each.toFixed(2)} each`;
  }
  const size = formatSize(line.packQty, line.unit);
  if (line.packs > 1) return `${line.packs} × ${size} · $${line.packPrice.toFixed(2)} each`;
  return size;
}
