// Flyer import helpers shared by the Worker and the web app. Pure: no network, no D1.
import { INGREDIENTS, type Ingredient } from './catalog';
import { parsePrice } from './parse';

/** Generic words that would pull in too many unrelated flyer items as search terms. */
const GENERIC_TERMS = new Set(['egg', 'eggs', 'can', 'canned', 'fresh', 'frozen', 'dry', 'mix', 'mini', 'large', 'organic', 'bulk']);

export const MAX_SEARCH_TERMS = 150;

/** How many search terms the fallback search uses. Keeps a search run well under the Worker's request limit. */
export const FALLBACK_SEARCH_TERMS = 30;

/** Common produce, most useful first. Proteins come before all of these in the fallback list. */
const COMMON_PRODUCE_IDS = [
  'broccoli', 'carrots', 'yellow-onion', 'potatoes', 'roma-tomatoes', 'spinach', 'red-bell-pepper',
  'bananas', 'gala-apples', 'white-mushrooms', 'english-cucumber', 'romaine-lettuce', 'garlic',
  'zucchini', 'sweet-potatoes', 'green-bell-pepper', 'navel-oranges', 'avocado', 'lemons', 'cauliflower',
];

/**
 * One search term per catalogue ingredient: its shortest alias of at least 3 characters that is not
 * generic. Unique, in list order, capped at `limit` (MAX_SEARCH_TERMS by default).
 */
export function buildSearchTerms(
  ingredients: Pick<Ingredient, 'aliases'>[] = INGREDIENTS,
  limit: number = MAX_SEARCH_TERMS,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ing of ingredients) {
    const candidates = ing.aliases
      .map((a) => a.trim().toLowerCase())
      .filter((a) => a.length >= 3 && !GENERIC_TERMS.has(a))
      .sort((a, b) => a.length - b.length || a.localeCompare(b));
    const term = candidates[0];
    if (!term || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Search terms for the fallback search, at most FALLBACK_SEARCH_TERMS: meat, seafood, eggs and tofu
 * first, then common produce, then everything else in catalogue order.
 */
export function fallbackSearchTerms(limit: number = FALLBACK_SEARCH_TERMS): string[] {
  const rank = (i: Ingredient): number => {
    if (i.category === 'meat' || i.category === 'seafood' || i.protein === 'egg' || i.protein === 'tofu') return 0;
    if (i.category === 'produce') return 1;
    return 2;
  };
  const produceOrder = (i: Ingredient): number => {
    const k = COMMON_PRODUCE_IDS.indexOf(i.id);
    return k < 0 ? COMMON_PRODUCE_IDS.length : k;
  };
  const sorted = [...INGREDIENTS].sort((a, b) => rank(a) - rank(b) || produceOrder(a) - produceOrder(b));
  return buildSearchTerms(sorted, limit);
}

/** Canadian postal code in the stored form: uppercase, no space. Null when it is not one. */
export function normalizePostalCode(input: string): string | null {
  const s = input.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(s) ? s : null;
}

/** Lowercase letters and digits only, for comparing store names. */
export function storeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** A household store for matching: its name, or the store with the Flipp names it is also sold under. */
export type StoreMatchInput = string | { name: string; flippNames?: string[] };

/**
 * The household store a merchant name belongs to, or null. Each store's name and its flippNames are
 * candidates. A candidate matches when its key equals the merchant key, or one key contains the other.
 * Keys shorter than 5 characters only match exactly, so a merchant "Food" does not claim "Food Basics",
 * while a merchant "RCSS" still matches an alias "RCSS". An exact match beats a substring match, and a
 * longer key beats a shorter one. Returns the store's name, never the alias.
 */
export function matchStoreName(merchant: string, stores: StoreMatchInput[]): string | null {
  const m = storeKey(merchant);
  if (m.length === 0) return null;
  let best: { name: string; exact: boolean; length: number } | null = null;
  for (const store of stores) {
    const name = typeof store === 'string' ? store : store.name;
    const aliases = typeof store === 'string' ? [] : (store.flippNames ?? []);
    for (const candidate of [name, ...aliases]) {
      const key = storeKey(candidate);
      if (key.length === 0) continue;
      const exact = m === key;
      if (!exact && (m.length < 5 || key.length < 5)) continue;
      if (!exact && !(m.includes(key) || key.includes(m))) continue;
      const better =
        best === null ||
        (exact && !best.exact) ||
        (exact === best.exact && key.length > best.length);
      if (better) best = { name, exact, length: key.length };
    }
  }
  return best?.name ?? null;
}

/** The YYYY-MM-DD part of an ISO datetime, or null. */
export function isoDatePart(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : null;
}

const POST_UNITS = /^(?:\/)?\s*(?:ea|each|lbs?|kg|100\s*g)\b/i;

/**
 * A price string built from its parts: pre text ("2 for"), the amount ("$4.39" or "2/$5") and post text
 * ("/kg", or a bare unit such as "lb"). Null when parsePrice cannot read the result.
 */
export function priceTextFromParts(pre: string, amount: string, post: string): string | null {
  const postText = post && !post.startsWith('/') && POST_UNITS.test(post) ? `/${post}` : post;
  const text = `${pre}${amount}${postText}`;
  return parsePrice(text) ? text : null;
}

/**
 * A price string parsePrice can read, built from a Flipp item. Uses current_price with its pre and post
 * text when there is a number. Otherwise the first of pre, post or sale text that parsePrice reads.
 */
export function priceTextFrom(item: {
  current_price?: unknown;
  pre_price_text?: unknown;
  post_price_text?: unknown;
  sale_story?: unknown;
}): string | null {
  const pre = typeof item.pre_price_text === 'string' ? item.pre_price_text.trim() : '';
  const post = typeof item.post_price_text === 'string' ? item.post_price_text.trim() : '';
  const current = typeof item.current_price === 'number' && Number.isFinite(item.current_price) ? item.current_price : null;

  if (current !== null) return priceTextFromParts(pre, `$${current}`, post);
  const story = typeof item.sale_story === 'string' ? item.sale_story.trim() : '';
  for (const candidate of [pre, post, story]) {
    if (candidate && /\d/.test(candidate) && parsePrice(candidate)) return candidate;
  }
  return null;
}

// ---- Shapes shared with the web app ----

/** Which path an import took: flyer pages from the flyer list, or a search by name. */
export type IngestMode = 'flyers' | 'search';

/** A flyer used by an import run, for the status debug view. */
export interface FlyerUsed {
  id: string;
  merchant: string;
  name: string;
  store: string;
  items: number;
}

export interface StoreCount {
  store: string;
  count: number;
}

export interface IngestRunSummary {
  ok: boolean;
  mode: IngestMode;
  terms: number; // search terms tried, in search mode
  flyerCount: number; // flyers used, in flyers mode
  items: number; // unique raw items found
  kept: number; // items for the household's stores
  stored: number; // rows written, after splitting multi-product lines
  matched: number;
  storeCounts: StoreCount[]; // raw items per store, in flyers mode
  unmatchedSample: string[];
  errors: string[];
}

export interface IngestStatus {
  lastRun: {
    id: string;
    startedAt: string;
    finishedAt: string;
    ok: boolean;
    mode: IngestMode;
    terms: number;
    flyerCount: number;
    items: number;
    kept: number;
    stored: number;
    matched: number;
    errors: string[];
    /** Debug only (?debug=1): the first raw items, and the flyers used. */
    sample?: unknown[];
    flyers?: FlyerUsed[];
  } | null;
  currentItems: { store: string; count: number }[];
}

/** One problem from an import. The label says where it happened, when it is useful. */
export interface IngestIssue {
  label?: string;
  message: string;
}

/**
 * Identical messages become one line with a count, in the order they first appeared.
 * `noun` names what was counted, e.g. "searches" or "requests".
 */
export function collapseIssues(issues: IngestIssue[], noun: string): string[] {
  const groups = new Map<string, { n: number; label?: string }>();
  for (const issue of issues) {
    const g = groups.get(issue.message);
    if (g) g.n++;
    else groups.set(issue.message, { n: 1, label: issue.label });
  }
  return [...groups].map(([message, g]) => {
    if (g.n === 1) return g.label ? `${g.label}: ${message}` : message;
    return `${message} (${g.n} ${noun})`;
  });
}
