import { z } from 'zod';
import { INGREDIENT_BY_ID, type BaseUnit } from './catalog';
import { matchIngredient, normalizeRawName } from './match';
import { parseSize, toBaseQty } from './parse';
import type { StoreMatchInput } from './flipp';
import { defaultExpiry, MAX_QTY, type PantryItem } from './pantry';
import { IsoDateSchema } from './plan';

// Grocery receipts (milestone 3B). Claude reads the photo into a ParsedReceipt; this module
// matches each line to an ingredient, works out what it really cost, and plans the rows a commit
// writes. Copied in part from the travel planner's receipt code and adapted for groceries.

export interface ParsedReceiptLine {
  name: string;
  original?: string;
  qty?: number;
  price: number;
  taxable?: boolean;
  size?: string; // weight or pack size printed on the line, e.g. "907 g" or "0.840 kg @ $6.58/kg"
  code?: string; // item code / PLU if printed
}

/** The `record_receipt` tool input, as the worker returns it. */
export interface ParsedReceipt {
  readable?: boolean;
  merchant?: string;
  address?: string;
  date?: string;
  time?: string;
  currency?: string;
  items: ParsedReceiptLine[];
  subtotal?: number;
  tax?: number;
  tax_included?: boolean;
  tip?: number;
  total?: number;
}

/** Matches below this confidence are shown to the person to check. */
export const LOW_CONFIDENCE = 0.75;

export interface MatchedReceiptLine {
  index: number;
  name: string;
  original?: string;
  price: number; // what the line really cost: discounts merged in, tax and tip spread over it
  taxable: boolean;
  ingredientId: string | null;
  confidence: number; // 0 when nothing matched
  qty: number; // in the ingredient's base unit
  unit: BaseUnit;
  pricePerUnit: number | null; // price per base unit, null when there is no ingredient
  include: boolean; // false for unmatched lines and non-food (household) items
}

export interface ReceiptMatch {
  store: string | null;
  lines: MatchedReceiptLine[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * What each line really costs once tax and tip are spread over it: tax added on top (Canada/US)
 * goes onto the taxable lines in proportion to their price; the tip (and any gap left between
 * the lines and the total, like a service fee) onto every line in proportion.
 */
export function lineCosts(
  r: { items: { price: number; taxable?: boolean }[]; tax?: number; tip?: number; tax_included?: boolean },
  total?: number,
): number[] {
  const prices = r.items.map((i) => i.price);
  const sum = prices.reduce((a, b) => a + b, 0);
  const taxable = r.items.map((i) => i.taxable !== false);
  const taxBase = prices.reduce((a, p, k) => a + (taxable[k] ? p : 0), 0);
  const tax = r.tax_included ? 0 : (r.tax ?? 0);
  const withTax = prices.map((p, k) => p + (tax && taxBase ? (taxable[k] ? (tax * p) / taxBase : 0) : 0));
  const extra = (total != null ? total - sum - tax : (r.tip ?? 0)) || 0;
  return withTax.map((p, k) => p + (sum ? (extra * prices[k]) / sum : 0));
}

const squash = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The enabled store a receipt belongs to: case-insensitive, ignoring spaces and punctuation, and
 * a substring match either way ("NO FRILLS #3411" → "No Frills"). A store's flippNames count as
 * names too. The longest matching name wins, and the store's own name is returned.
 */
export function detectStore(merchant: string | undefined, stores: StoreMatchInput[]): string | null {
  if (!merchant) return null;
  const m = squash(merchant);
  if (m.length < 2) return null;
  let best: string | null = null;
  let bestLen = 0;
  for (const store of stores) {
    const name = typeof store === 'string' ? store : store.name;
    const aliases = typeof store === 'string' ? [] : (store.flippNames ?? []);
    for (const candidate of [name, ...aliases]) {
      const n = squash(candidate);
      if (n.length < 2) continue;
      if ((m.includes(n) || n.includes(m)) && n.length > bestLen) {
        best = name;
        bestLen = n.length;
      }
    }
  }
  return best;
}

/** Best ingredient match for a line: the printed text or the readable name, whichever scores higher. */
function matchLine(line: ParsedReceiptLine): { ingredientId: string; confidence: number } | null {
  const byOriginal = line.original ? matchIngredient(line.original) : null;
  const byName = line.name ? matchIngredient(line.name) : null;
  if (byOriginal && byName) return byName.confidence > byOriginal.confidence ? byName : byOriginal;
  return byOriginal ?? byName;
}

export function isLowConfidence(line: Pick<MatchedReceiptLine, 'confidence'>): boolean {
  return line.confidence < LOW_CONFIDENCE;
}

/**
 * Match a parsed receipt to the enabled stores and the ingredient catalogue.
 * - Negative lines (discounts) reduce the line above them instead of becoming lines.
 * - Each line's cost includes its share of tax and tip (see lineCosts), so the included lines
 *   sum to the receipt total when every line is food.
 * - Quantity comes from the size printed on the line (or the name / original text). With no size
 *   it is 1 base unit, or the printed count for 'each' items.
 */
export function matchReceipt(parsed: ParsedReceipt, stores: StoreMatchInput[]): ReceiptMatch {
  const kept: { line: ParsedReceiptLine; price: number }[] = [];
  for (const item of parsed.items ?? []) {
    if (!item || typeof item.price !== 'number' || !Number.isFinite(item.price)) continue;
    if (item.price < 0) {
      const prev = kept[kept.length - 1];
      if (prev) prev.price = round2(prev.price + item.price);
      continue;
    }
    kept.push({ line: item, price: item.price });
  }

  const costs = lineCosts(
    {
      items: kept.map((k) => ({ price: k.price, taxable: k.line.taxable })),
      tax: parsed.tax,
      tip: parsed.tip,
      tax_included: parsed.tax_included,
    },
    parsed.total,
  );

  const lines: MatchedReceiptLine[] = kept.map(({ line, price }, index) => {
    const match = matchLine(line);
    const ing = match ? INGREDIENT_BY_ID[match.ingredientId] : undefined;
    const size = parseSize(line.size ?? '') ?? parseSize(line.original ?? '') ?? parseSize(line.name);

    let qty = ing?.baseUnit === 'each' && line.qty && line.qty > 0 ? line.qty : 1;
    if (size && ing) {
      const base = toBaseQty(size, ing.baseUnit);
      if (Number.isFinite(base) && base > 0) qty = base;
    }

    const cost = round2(costs[index] ?? price);
    return {
      index,
      name: line.name,
      ...(line.original ? { original: line.original } : {}),
      price: cost,
      taxable: line.taxable !== false,
      ingredientId: ing?.id ?? null,
      confidence: match?.confidence ?? 0,
      qty: round4(qty),
      unit: ing?.baseUnit ?? 'each',
      pricePerUnit: ing && cost > 0 && qty > 0 ? round4(cost / qty) : null,
      include: ing !== undefined && ing.category !== 'household',
    };
  });

  return { store: detectStore(parsed.merchant, stores), lines };
}

// ---- Commit ----

export const ReceiptCommitLineSchema = z.object({
  ingredientId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  original: z.string().trim().max(200).optional(),
  qty: z.number().positive('Quantity must be more than zero').max(MAX_QTY),
  unit: z.enum(['kg', 'l', 'each']), // informational: the catalogue's base unit is what is stored
  price: z.number().min(0).max(100000),
  pricePerUnit: z.number().min(0).nullable(),
  addToPantry: z.boolean(),
});

export const ReceiptCommitSchema = z.object({
  store: z.string().trim().min(1, 'Choose a store').max(40),
  date: IsoDateSchema.optional(),
  lines: z.array(ReceiptCommitLineSchema).min(1, 'No lines to save').max(100),
});
export type ReceiptCommit = z.infer<typeof ReceiptCommitSchema>;

export interface ReceiptCommitRows {
  prices: { ingredientId: string; store: string; date: string; pricePerUnit: number }[];
  matches: { rawKey: string; ingredientId: string; packQty: number }[];
  pantry: PantryItem[];
}

/**
 * The rows a confirmed receipt writes: a price per line (the receipt is a receipt, so on_sale is
 * false), a confirmed match for the printed text so the next receipt skips the picker, and a
 * pantry item for each line marked as stock. Throws on an unknown ingredient id.
 */
export function planReceiptCommit(input: ReceiptCommit, today: string, newId: () => string): ReceiptCommitRows {
  const date = input.date ?? today;
  const rows: ReceiptCommitRows = { prices: [], matches: [], pantry: [] };
  const matchByKey = new Map<string, ReceiptCommitRows['matches'][number]>();

  for (const line of input.lines) {
    const catalog = INGREDIENT_BY_ID[line.ingredientId];
    if (!catalog) throw new Error(`Unknown ingredient: ${line.ingredientId}`);

    if (line.pricePerUnit !== null && line.pricePerUnit > 0) {
      rows.prices.push({ ingredientId: line.ingredientId, store: input.store, date, pricePerUnit: line.pricePerUnit });
    }

    const rawKey = normalizeRawName(line.original ?? line.name);
    if (rawKey) matchByKey.set(rawKey, { rawKey, ingredientId: line.ingredientId, packQty: line.qty });

    if (line.addToPantry) {
      rows.pantry.push({
        id: newId(),
        ingredientId: line.ingredientId,
        qty: line.qty,
        unit: catalog.baseUnit,
        addedOn: date,
        expiresOn: defaultExpiry(line.ingredientId, date),
        source: 'receipt',
      });
    }
  }

  rows.matches = [...matchByKey.values()];
  return rows;
}
