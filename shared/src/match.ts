import { INGREDIENTS, INGREDIENT_BY_ID, type Category } from './catalog';
import { parsePrice, parseSize, pricePerBaseUnit, toBaseQty } from './parse';

export interface FlyerItem {
  id: string;
  store: string;
  rawName: string;
  priceText: string;
  sizeText?: string;
  validFrom: string;
  validTo: string;
  source: 'flyer' | 'site' | 'receipt' | 'fixture';
}

export interface MatchedItem extends FlyerItem {
  ingredientId: string;
  confidence: number;
  packQty: number; // in base units
  pricePerUnit: number;
  packPrice: number;
}

// Brand prefixes that appear at the start of flyer names.
const BRAND_PREFIX =
  /^(?:pc|no name|compliments|great value|selection|president'?s choice|kirkland|sobeys|irresistibles|lactantia|dempster'?s|nature'?s touch)\s+/;

// Words that hint at a category. Used for a small confidence bonus.
const CATEGORY_HINTS: Partial<Record<Category, string[]>> = {
  meat: ['chicken', 'beef', 'pork', 'turkey', 'sausage', 'mince', 'chkn', 'bnls', 'drumstick'],
  seafood: ['fish', 'salmon', 'tilapia', 'cod', 'shrimp', 'tuna'],
  dairy: ['milk', 'cheese', 'yogurt', 'yoghurt', 'cream', 'butter', 'eggs', 'egg'],
  bakery: ['bread', 'bagel', 'bagels', 'tortilla', 'tortillas', 'naan', 'pita', 'wrap'],
  deli: ['deli', 'sliced', 'shaved', 'hummus'],
  frozen: ['frozen'],
  pantry: ['canned', 'can', 'dry', 'dried', 'sauce', 'oil', 'rice', 'pasta'],
  produce: ['fresh', 'bunch', 'bulb', 'head', 'hearts', 'lb'],
  household: [],
};

/** Lowercase, drop brands, sizes and prices, and collapse punctuation. Keeps unicode letters. */
export function normalizeRawName(s: string): string {
  let t = s.toLowerCase().trim();
  // Strip prefixes repeatedly ("PC No Name ...").
  let prev: string;
  do {
    prev = t;
    t = t.replace(BRAND_PREFIX, '');
  } while (t !== prev);

  t = t
    // multipacks: "12 x 355 ml", "2 x 1 l"
    .replace(/\d+(?:\.\d+)?\s*(?:x|×)\s*\d+(?:\.\d+)?\s*(?:kg|g|ml|l|lbs?|oz)\b/g, ' ')
    // sizes: "1.5 kg", "907g", "2 lbs", "18 ct", "6 pk", "750 mL"
    .replace(/\d+(?:\.\d+)?\s*(?:kg|g|ml|l|lbs?|oz|ct|pk|pack)\b/g, ' ')
    // prices: "2/$5" first, so its leading count is not left behind, then "$3.99", "3 for $10", "$1.99/lb", "99¢"
    .replace(/\d+\s*\/\s*\$\s*\d+(?:\.\d+)?/g, ' ')
    .replace(/\$\s*\d+(?:\.\d+)?(?:\s*\/\s*(?:lbs?|kg|ea|each|100\s*g))?/g, ' ')
    .replace(/\d+\s*for\s*\$?\s*\d+(?:\.\d+)?/g, ' ')
    .replace(/\d+(?:\.\d+)?\s*¢/g, ' ')
    .replace(/\d+(?:\.\d+)?\s*\/\s*(?:lbs?|kg|ea|each)\b/g, ' ')
    // punctuation (keep letters, digits, hyphen, whitespace)
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return t;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `phrase` appears in `text` as whole words. */
function containsPhrase(text: string, phrase: string): boolean {
  return new RegExp(`(?:^|\\s)${escapeRegex(phrase)}(?=\\s|$)`).test(text);
}

/**
 * Score each ingredient by its longest alias phrase found in the name.
 * Multi-word aliases score 0.9 and single words 0.7, plus 0.05 when the name
 * also has a category hint. Ties go to the longer alias, so "sweet potatoes"
 * beats "potatoes" and "greek yogurt" beats "yogurt".
 * Returns the best match above 0.6, or null.
 */
export function matchIngredient(rawName: string): { ingredientId: string; confidence: number } | null {
  const norm = normalizeRawName(rawName);
  if (!norm) return null;

  let best: { ingredientId: string; confidence: number; aliasLen: number } | null = null;

  for (const ing of INGREDIENTS) {
    let aliasHit: string | null = null;
    for (const alias of ing.aliases) {
      if (containsPhrase(norm, alias) && (aliasHit === null || alias.length > aliasHit.length)) {
        aliasHit = alias;
      }
    }
    if (aliasHit === null) continue;

    let confidence = aliasHit.includes(' ') ? 0.9 : 0.7;
    const hints = CATEGORY_HINTS[ing.category] ?? [];
    if (hints.some((h) => containsPhrase(norm, h))) confidence += 0.05;
    confidence = Math.min(1, Math.round(confidence * 100) / 100);

    const candidate = { ingredientId: ing.id, confidence, aliasLen: aliasHit.length };
    if (
      best === null ||
      candidate.confidence > best.confidence ||
      (candidate.confidence === best.confidence && candidate.aliasLen > best.aliasLen)
    ) {
      best = candidate;
    }
  }

  if (!best || best.confidence <= 0.6) return null;
  return { ingredientId: best.ingredientId, confidence: best.confidence };
}

/** Combine parse and match. Size falls back to a size found inside rawName. */
export function matchFlyerItem(item: FlyerItem): MatchedItem | null {
  const m = matchIngredient(item.rawName);
  if (!m) return null;
  const ing = INGREDIENT_BY_ID[m.ingredientId];
  if (!ing) return null;

  const price = parsePrice(item.priceText);
  if (!price) return null;

  const size = parseSize(item.sizeText ?? '') ?? parseSize(item.rawName);

  const pricePerUnit = pricePerBaseUnit(price, size, ing);
  if (pricePerUnit === null) return null;

  const isWeightPrice = price.per === 'lb' || price.per === 'kg' || price.per === '100g';
  let packQty: number;
  if (size) {
    packQty = toBaseQty(size, ing.baseUnit);
  } else {
    // No size: a per-weight price is for 1 base unit, an item price is for 1 each.
    packQty = ing.baseUnit === 'each' ? 1 : isWeightPrice ? 1 : NaN;
  }
  if (!Number.isFinite(packQty) || packQty <= 0) return null;

  const packPrice = isWeightPrice ? pricePerUnit * packQty : price.amount;

  return {
    ...item,
    ingredientId: m.ingredientId,
    confidence: m.confidence,
    packQty,
    pricePerUnit,
    packPrice,
  };
}

/**
 * LLM fallback for names the alias matcher cannot place.
 * TODO(milestone 3): implement with Claude Haiku. Do not add network calls here yet.
 */
export interface Normalizer {
  normalize(raw: string[]): Promise<Record<string, { ingredientId: string | null; packQty?: number }>>;
}
