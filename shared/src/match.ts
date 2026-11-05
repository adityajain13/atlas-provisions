import { INGREDIENTS, INGREDIENT_BY_ID, type Category, type Ingredient } from './catalog';
import { parsePrice, parseSize, pricePerBaseUnit, toBaseQty } from './parse';

export interface FlyerItem {
  id: string;
  store: string;
  rawName: string;
  priceText: string;
  sizeText?: string;
  validFrom: string;
  validTo: string;
  source: 'flyer' | 'site' | 'receipt' | 'fixture' | 'flipp';
}

export interface MatchedItem extends FlyerItem {
  ingredientId: string;
  confidence: number;
  packQty: number; // in base units
  pricePerUnit: number;
  packPrice: number;
}

// Brand prefixes at the start of flyer names. Apostrophes are already removed when this runs,
// so "President's Choice" is "presidents choice".
const BRAND_PREFIX =
  /^(?:pc|no name|compliments|great value|selection|presidents? choice|kirkland|sobeys|irresistibles|lactantia|dempsters|natures touch|farmers market|our finest)\s+/;

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

// Lines that share a word with an ingredient but are not one. Nestle Drumstick is ice cream, not chicken.
const NON_INGREDIENT_PHRASES = ['nestle drumstick', 'haagen dazs'];

/** Lowercase, accents removed, trademark signs and apostrophes dropped, whitespace collapsed. */
function foldText(s: string): string {
  return s
    .replace(/[™®©]/g, ' ') // before NFKD, which would turn ™ into the letters "TM"
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lowercase, drop brands, sizes and prices, and collapse punctuation. Accents are removed, so
 * "Jalapeño" becomes "jalapeno". Keeps letters, digits, hyphen and whitespace.
 */
export function normalizeRawName(s: string): string {
  let t = foldText(s);
  // Strip prefixes repeatedly ("PC No Name ...", "Farmers Market PC ...").
  let prev: string;
  do {
    prev = t;
    t = t.replace(BRAND_PREFIX, '');
  } while (t !== prev);

  t = t
    // multipacks: "12 x 355 ml", "2 x 1 l"
    .replace(/\d+(?:\.\d+)?\s*(?:x|×)\s*\d+(?:\.\d+)?\s*(?:kg|g|ml|l|lbs?|oz)\b/g, ' ')
    // ranges: "400-450 ml"
    .replace(/\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*(?:kg|g|ml|l|lbs?|oz)\b/g, ' ')
    // sizes: "1.5 kg", "907g", "2 lbs", "18 ct", "6 pk", "750 ml"
    .replace(/\d+(?:\.\d+)?\s*(?:kg|g|ml|l|lbs?|oz|ct|pk|pack)\b/g, ' ')
    // piece counts: "4's" (now "4s"), "3/4's" (now "3/4s")
    .replace(/\b\d+(?:\/\d+)?s\b/g, ' ')
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

/**
 * Singular form of one word, used on both sides of a comparison: tomatoes to tomato, berries to
 * berry, leaves to leaf, chops to chop, cucumbers to cucumber. Short words and "ss" endings are left.
 */
export function foldToken(t: string): string {
  const n = t.length;
  if (n > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (n > 4 && /(?:ches|shes|sses|xes|oes)$/.test(t)) return t.slice(0, -2);
  if (n > 4 && /(?:leaves|loaves|halves)$/.test(t)) return `${t.slice(0, -3)}f`;
  if (n > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

/** The folded words of a name or alias. Hyphens separate words ("bone-in" is "bone in"). */
export function tokensOf(s: string): string[] {
  return foldText(s)
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(foldToken);
}

/** True when `seq` appears in `tokens` as consecutive words. */
export function containsSeq(tokens: string[], seq: string[]): boolean {
  if (seq.length === 0 || seq.length > tokens.length) return false;
  for (let i = 0; i <= tokens.length - seq.length; i++) {
    if (seq.every((t, j) => tokens[i + j] === t)) return true;
  }
  return false;
}

interface AliasTokens {
  tokens: string[];
  length: number; // length of the alias as written, for tie-breaks
}

const ALIAS_INDEX: { ingredient: Ingredient; aliases: AliasTokens[] }[] = INGREDIENTS.map((ingredient) => ({
  ingredient,
  aliases: ingredient.aliases
    .map((a) => ({ tokens: tokensOf(a), length: a.length }))
    .filter((a) => a.tokens.length > 0),
}));

const NON_INGREDIENT_TOKENS = NON_INGREDIENT_PHRASES.map(tokensOf);

const HINT_TOKENS: Partial<Record<Category, string[][]>> = Object.fromEntries(
  (Object.entries(CATEGORY_HINTS) as [Category, string[]][]).map(([cat, hints]) => [cat, hints.map(tokensOf)]),
);

/**
 * Score each ingredient by its best alias. An alias matches when all its words appear in the name,
 * in any order. Its score is the number of words, plus half a point when the words are next to each
 * other, so "sweet potatoes" beats "potatoes" and "greek yogurt" beats "yogurt". Ties go to the longer
 * alias. Confidence is 0.9 for a multi-word alias and 0.7 for one word, plus 0.05 with a category hint.
 * Returns the best match above 0.6, or null.
 */
export function matchIngredient(rawName: string): { ingredientId: string; confidence: number } | null {
  const tokens = tokensOf(normalizeRawName(rawName));
  if (tokens.length === 0) return null;
  if (NON_INGREDIENT_TOKENS.some((seq) => containsSeq(tokens, seq))) return null;
  const present = new Set(tokens);

  let best: { ingredientId: string; score: number; aliasLen: number; confidence: number } | null = null;

  for (const entry of ALIAS_INDEX) {
    let hit: { size: number; contiguous: boolean; length: number; score: number } | null = null;
    for (const alias of entry.aliases) {
      if (!alias.tokens.every((t) => present.has(t))) continue;
      const contiguous = containsSeq(tokens, alias.tokens);
      const size = alias.tokens.length;
      const score = size + (contiguous ? 0.5 : 0);
      if (!hit || score > hit.score || (score === hit.score && alias.length > hit.length)) {
        hit = { size, contiguous, length: alias.length, score };
      }
    }
    if (!hit) continue;

    let confidence = hit.size >= 2 ? 0.9 : 0.7;
    if ((HINT_TOKENS[entry.ingredient.category] ?? []).some((h) => containsSeq(tokens, h))) confidence += 0.05;
    confidence = Math.min(1, Math.round(confidence * 100) / 100);

    if (best === null || hit.score > best.score || (hit.score === best.score && hit.length > best.aliasLen)) {
      best = { ingredientId: entry.ingredient.id, score: hit.score, aliasLen: hit.length, confidence };
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

  // A size that cannot convert to the ingredient's unit is ignored: "bunch" reads as one each, which means
  // nothing for a per-kilogram spinach.
  let size = parseSize(item.sizeText ?? '') ?? parseSize(item.rawName);
  if (size && !Number.isFinite(toBaseQty(size, ing.baseUnit))) size = null;

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

/** True when the text has a word of at least 3 letters. "Pork" yes; "3/4's" and "mL" no. */
function looksLikeProduct(text: string): boolean {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\s]+/gu, ' ')
    .split(/\s+/)
    .some((w) => w.length >= 3);
}

/** A comma list is split only when every part is a product that matches an ingredient. */
function splitList(piece: string): string[] {
  const segments = piece.split(',').map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return [piece];
  const clearlyList = segments.every((s) => looksLikeProduct(s) && matchIngredient(s) !== null);
  return clearlyList ? segments : [piece];
}

/**
 * The products on one flyer line. "A or B", "A / B" and "A & B" split when both sides look like
 * products. A comma list splits when every part matches an ingredient. Otherwise the line is one product.
 */
export function splitProductName(rawName: string): string[] {
  const name = rawName.replace(/\s+/g, ' ').trim();
  const orParts = name.split(/\s+(?:or|\/|&)\s+/i).map((s) => s.trim()).filter(Boolean);
  const pieces = orParts.length > 1 && orParts.every(looksLikeProduct) ? orParts : [name];
  return pieces.flatMap(splitList);
}

/**
 * One flyer line as the products it lists, each with the same price, size and dates. A line with one
 * product comes back unchanged. Split parts get ids `<id>#1`, `<id>#2`, and so on.
 */
export function expandFlyerItem(item: FlyerItem): FlyerItem[] {
  const parts = splitProductName(item.rawName);
  if (parts.length < 2) return [item];
  return parts.map((rawName, i) => ({ ...item, id: `${item.id}#${i + 1}`, rawName }));
}

/**
 * LLM fallback for names the alias matcher cannot place.
 * TODO(milestone 3): implement with Claude Haiku. Do not add network calls here yet.
 */
export interface Normalizer {
  normalize(raw: string[]): Promise<Record<string, { ingredientId: string | null; packQty?: number }>>;
}
