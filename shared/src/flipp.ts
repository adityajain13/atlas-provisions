// Flyer import helpers shared by the Worker and the web app. Pure: no network, no D1.
import { INGREDIENTS, type Ingredient } from './catalog';
import { parsePrice } from './parse';

/** Generic words that would pull in too many unrelated flyer items as search terms. */
const GENERIC_TERMS = new Set(['egg', 'eggs', 'can', 'canned', 'fresh', 'frozen', 'dry', 'mix', 'mini', 'large', 'organic', 'bulk']);

export const MAX_SEARCH_TERMS = 150;

/**
 * One search term per catalogue ingredient: its shortest alias of at least 3 characters that is not
 * generic. Unique, in catalogue order, capped at MAX_SEARCH_TERMS.
 */
export function buildSearchTerms(ingredients: Pick<Ingredient, 'aliases'>[] = INGREDIENTS): string[] {
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
    if (out.length >= MAX_SEARCH_TERMS) break;
  }
  return out;
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

/**
 * The household store a Flipp merchant name belongs to, or null. A match is either key containing the
 * other. Keys shorter than 5 characters never match, so a merchant "Food" does not claim "Food Basics".
 */
export function matchStoreName(merchant: string, stores: string[]): string | null {
  const m = storeKey(merchant);
  if (m.length < 5) return null;
  for (const store of stores) {
    const s = storeKey(store);
    if (s.length < 5) continue;
    if (m === s || m.includes(s) || s.includes(m)) return store;
  }
  return null;
}

/** The YYYY-MM-DD part of an ISO datetime, or null. */
export function isoDatePart(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : null;
}

const POST_UNITS = /^(?:\/)?\s*(?:ea|each|lbs?|kg|100\s*g)\b/i;

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

  if (current !== null) {
    const postText = post && !post.startsWith('/') && POST_UNITS.test(post) ? `/${post}` : post;
    const text = `${pre}$${current}${postText}`;
    return parsePrice(text) ? text : null;
  }
  const story = typeof item.sale_story === 'string' ? item.sale_story.trim() : '';
  for (const candidate of [pre, post, story]) {
    if (candidate && /\d/.test(candidate) && parsePrice(candidate)) return candidate;
  }
  return null;
}

// ---- Shapes shared with the web app ----

export interface IngestRunSummary {
  ok: boolean;
  terms: number;
  items: number;
  stored: number;
  matched: number;
  unmatchedSample: string[];
  errors: string[];
}

export interface IngestStatus {
  lastRun: {
    id: string;
    startedAt: string;
    finishedAt: string;
    ok: boolean;
    terms: number;
    items: number;
    stored: number;
    matched: number;
    errors: string[];
  } | null;
  currentItems: { store: string; count: number }[];
}
