// Flipp flyer import. The flyer list and each flyer's items are read first; the search endpoint is the
// fallback. All three are Flipp's public web endpoints: unofficial, and they may change.
// Every field is treated as optional, and a failed request is recorded as an issue instead of thrown.
import {
  collapseIssues,
  isoDatePart,
  matchStoreName,
  parsePrice,
  parseSize,
  priceTextFrom,
  priceTextFromParts,
  type FlyerItem,
  type IngestIssue,
  type StoreMatchInput,
} from '@provisions/shared';

export const FLIPP_BASE_URL = 'https://backflipp.wishabi.com/flipp';
export const FLIPP_SEARCH_URL = `${FLIPP_BASE_URL}/items/search`;
export const FLIPP_FLYERS_URL = `${FLIPP_BASE_URL}/flyers`;

/** Cloudflare's free plan allows 50 subrequests per invocation. Leave headroom for the rest of the run. */
export const SUBREQUEST_BUDGET = 45;
export const BUDGET_STOP_MESSAGE = "Stopped early to stay under Cloudflare's 50-request limit per run.";

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export type FlippRawItem = Record<string, unknown>;

/** Counts every request, including retries. A refused request is never sent. */
export interface RequestBudget {
  take(): boolean;
  readonly used: number;
  readonly exhausted: boolean;
}

export function createBudget(limit: number = SUBREQUEST_BUDGET): RequestBudget {
  let used = 0;
  let exhausted = false;
  return {
    take() {
      if (used >= limit) {
        exhausted = true;
        return false;
      }
      used++;
      return true;
    },
    get used() {
      return used;
    },
    get exhausted() {
      return exhausted;
    },
  };
}

export interface FlippOptions {
  /** Household stores to keep, by name and Flipp names. Items from other merchants are skipped. */
  stores: StoreMatchInput[];
  concurrency?: number; // default 4
  spacingMs?: number; // default 250, between request starts
  timeoutMs?: number; // default 10 000
  retryDelayMs?: number; // default 1 000, before the one retry on 429 or 5xx
  sleep?: (ms: number) => Promise<void>;
  budget?: RequestBudget; // shared across a run; default a fresh SUBREQUEST_BUDGET
}

export interface FlippResult {
  /** Unique raw items across all terms, before the store filter. */
  found: number;
  /** Mapped flyer items for the household's stores, deduplicated by id. */
  items: FlyerItem[];
  /** The raw items, for the debugging sample. */
  raw: FlippRawItem[];
  /** One message per failed term, e.g. "chicken: HTTP 503". */
  errors: string[];
  /** The same failures, with the term as the label, for collapsing. */
  issues: IngestIssue[];
}

/** A flyer from the flyer list, with the fields the import uses. */
export interface FlyerInfo {
  id: string;
  merchant: string;
  name: string;
  validFrom: string | null;
  validTo: string | null;
  categories: string[];
}

export const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** Maps a Flipp item from the search endpoint to a FlyerItem, or null when it cannot be used. */
export function toFlyerItem(raw: FlippRawItem, stores: StoreMatchInput[]): FlyerItem | null {
  const key = raw.flyer_item_id ?? raw.id;
  const keyText = typeof key === 'string' || typeof key === 'number' ? String(key) : null;
  const merchant = str(raw.merchant_name);
  const name = str(raw.name);
  if (!keyText || !merchant || !name) return null;

  const store = matchStoreName(merchant, stores);
  if (!store) return null;

  const priceText = priceTextFrom(raw);
  if (!priceText) return null;

  const validFrom = isoDatePart(raw.valid_from);
  const validTo = isoDatePart(raw.valid_to);
  if (!validFrom || !validTo) return null;

  return { id: `flipp:${keyText}`, store, rawName: name, priceText, validFrom, validTo, source: 'flipp' };
}

/**
 * The price text of a flyer item. Uses current_price when it is a number. Otherwise the `price` field
 * ("4.99", or "2/$5" as printed), with its pre and post text. Otherwise the sale text.
 */
export function flyerItemPriceText(raw: FlippRawItem): string | null {
  if (typeof raw.current_price === 'number' && Number.isFinite(raw.current_price)) return priceTextFrom(raw);
  const price = typeof raw.price === 'number' ? String(raw.price) : str(raw.price);
  if (price) {
    const core = /[$/]|\bfor\b/i.test(price) ? price : `$${price}`;
    const text = priceTextFromParts(str(raw.pre_price_text) ?? '', core, str(raw.post_price_text) ?? '');
    if (text) return text;
  }
  return priceTextFrom(raw);
}

/**
 * A flyer item as a FlyerItem for the household store its flyer belongs to. Dates come from the item,
 * else from the flyer. Null when the item has no name, price or dates.
 */
export function toFlyerItemFromFlyer(
  raw: FlippRawItem,
  store: string,
  flyer: { validFrom: string | null; validTo: string | null },
): FlyerItem | null {
  const key = raw.flyer_item_id ?? raw.id;
  const keyText = typeof key === 'string' || typeof key === 'number' ? String(key) : null;
  const name = str(raw.name);
  if (!keyText || !name) return null;

  const priceText = flyerItemPriceText(raw);
  if (!priceText) return null;

  // The brand is often a separate field ("Nestle" + "Drumstick"); the name is read with it when the name lacks it.
  const brand = str(raw.brand);
  const rawName = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${name}` : name;

  const validFrom = isoDatePart(raw.valid_from) ?? flyer.validFrom;
  const validTo = isoDatePart(raw.valid_to) ?? flyer.validTo;
  if (!validFrom || !validTo) return null;

  const description = str(raw.description);
  const item: FlyerItem = { id: `flipp:${keyText}`, store, rawName, priceText, validFrom, validTo, source: 'flipp' };
  if (description && parseSize(description) && parsePrice(priceText)) item.sizeText = description;
  return item;
}

/** A flyer from the flyer list as a FlyerInfo, or null when it has no id. */
export function toFlyerInfo(raw: unknown): FlyerInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as FlippRawItem;
  const id = typeof r.id === 'string' || typeof r.id === 'number' ? String(r.id) : null;
  if (!id) return null;
  const merchantField = r.merchant ?? r.merchant_name;
  const merchant =
    str(merchantField) ??
    (typeof merchantField === 'object' && merchantField !== null ? str((merchantField as FlippRawItem).name) : null) ??
    '';
  const cats = Array.isArray(r.categories) ? r.categories : typeof r.categories === 'string' ? [r.categories] : [];
  return {
    id,
    merchant,
    name: str(r.name) ?? '',
    validFrom: isoDatePart(r.valid_from),
    validTo: isoDatePart(r.valid_to),
    categories: cats.filter((c): c is string => typeof c === 'string').map((c) => c.trim().toLowerCase()),
  };
}

/**
 * The flyers to import: those whose merchant is one of the household's stores and that are still valid
 * today or later (valid_to on or after today). Per store, grocery flyers come first, then at most
 * `perStore` flyers.
 */
export function selectFlyers(
  flyers: FlyerInfo[],
  stores: StoreMatchInput[],
  today: string,
  perStore = 3,
): { flyer: FlyerInfo; store: string }[] {
  const byStore = new Map<string, FlyerInfo[]>();
  for (const f of flyers) {
    if (!f.validTo || f.validTo < today) continue;
    const store = matchStoreName(f.merchant, stores);
    if (!store) continue;
    const list = byStore.get(store) ?? [];
    list.push(f);
    byStore.set(store, list);
  }
  const isGrocery = (f: FlyerInfo) => f.categories.some((c) => c.toLowerCase() === 'groceries');
  const out: { flyer: FlyerInfo; store: string }[] = [];
  for (const [store, list] of byStore) {
    const ordered = [...list].sort((a, b) => Number(isGrocery(b)) - Number(isGrocery(a)));
    for (const flyer of ordered.slice(0, perStore)) out.push({ flyer, store });
  }
  return out;
}

/** The items array of a flyer-items response: a root array, or `items` or `flyer_items`. Null when neither. */
function itemsFrom(body: unknown): FlippRawItem[] | null {
  const list = Array.isArray(body)
    ? body
    : typeof body === 'object' && body !== null
      ? (body as { items?: unknown; flyer_items?: unknown }).items ?? (body as { flyer_items?: unknown }).flyer_items
      : null;
  if (!Array.isArray(list)) return null;
  return list.filter((row): row is FlippRawItem => typeof row === 'object' && row !== null);
}

/** Sends requests with a shared start gate and the run's budget. Retries a 429 or 5xx once. */
export interface FlippClient {
  get(url: string): Promise<GetResult>;
  /** Responses that were JSON, across the run. */
  readonly successes: number;
  readonly budget: RequestBudget;
}

export type GetResult =
  | { ok: true; body: unknown }
  | { ok: false; message: string; budget?: true };

export function createFlippClient(fetchImpl: typeof fetch, opts: Partial<FlippOptions> = {}): FlippClient {
  const spacingMs = opts.spacingMs ?? 250;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retryDelayMs = opts.retryDelayMs ?? 1_000;
  const sleep = opts.sleep ?? defaultSleep;
  const budget = opts.budget ?? createBudget();
  let successes = 0;

  // Shared start gate: each request waits until `nextStart`, then pushes it `spacingMs` on.
  let nextStart = 0;
  async function gate(): Promise<void> {
    const now = Date.now();
    const startAt = Math.max(now, nextStart);
    nextStart = startAt + spacingMs;
    const wait = startAt - now;
    if (wait > 0) await sleep(wait);
  }

  return {
    get budget() {
      return budget;
    },
    get successes() {
      return successes;
    },
    async get(url: string): Promise<GetResult> {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!budget.take()) return { ok: false, message: BUDGET_STOP_MESSAGE, budget: true };
        await gate();
        let res: Response;
        try {
          res = await fetchImpl(url, {
            headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : 'request failed' };
        }
        if ((res.status === 429 || res.status >= 500) && attempt === 0) {
          await sleep(retryDelayMs);
          continue;
        }
        if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
        try {
          const body = await res.json();
          successes++;
          return { ok: true, body };
        } catch {
          return { ok: false, message: 'response was not JSON' };
        }
      }
      return { ok: false, message: 'request failed' };
    },
  };
}

/** Runs `fn` over `items` with at most `concurrency` in flight. Results keep the input order. */
export async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/** The flyers for a postal code (uppercase, no space), or the reason the list could not be read. */
export async function fetchFlyerList(
  postal: string,
  client: FlippClient,
): Promise<{ ok: true; flyers: FlyerInfo[] } | { ok: false; message: string; budget?: true }> {
  const r = await client.get(`${FLIPP_FLYERS_URL}?locale=en-ca&postal_code=${encodeURIComponent(postal)}`);
  if (!r.ok) return r.budget ? { ok: false, message: r.message, budget: true } : { ok: false, message: `flyer list ${r.message}` };
  const list = Array.isArray(r.body)
    ? r.body
    : (r.body as { flyers?: unknown } | null)?.flyers;
  if (!Array.isArray(list)) return { ok: false, message: 'flyer list had no flyers array' };
  return { ok: true, flyers: list.map(toFlyerInfo).filter((f): f is FlyerInfo => f !== null) };
}

/**
 * One flyer's items. Tries `flyers/<id>/flyer_items`, then `flyers/<id>`, until one returns a
 * non-empty array. `budget` is set when the run's request budget ran out.
 */
export async function fetchFlyerItems(
  flyerId: string,
  client: FlippClient,
): Promise<{ items: FlippRawItem[]; issues: string[]; budget?: true }> {
  const base = `${FLIPP_FLYERS_URL}/${encodeURIComponent(flyerId)}`;
  const urls = [`${base}/flyer_items?locale=en-ca`, `${base}?locale=en-ca`];
  const issues: string[] = [];
  for (const url of urls) {
    const r = await client.get(url);
    if (!r.ok) {
      if (r.budget) return { items: [], issues, budget: true };
      issues.push(r.message);
      continue;
    }
    const items = itemsFrom(r.body);
    if (items === null) {
      issues.push('response had no items array');
      continue;
    }
    if (items.length > 0) return { items, issues };
  }
  return { items: [], issues };
}

/** Searches Flipp for each term near `postal`, through `client`. Failed terms are recorded, not thrown. */
export async function searchFlippTerms(
  postal: string,
  terms: string[],
  client: FlippClient,
  stores: StoreMatchInput[],
  concurrency = 4,
): Promise<FlippResult> {
  const issues: IngestIssue[] = [];
  const rawByKey = new Map<string, FlippRawItem>();

  async function searchTerm(term: string): Promise<void> {
    const url = `${FLIPP_SEARCH_URL}?locale=en-ca&postal_code=${encodeURIComponent(postal)}&q=${encodeURIComponent(term)}`;
    const r = await client.get(url);
    if (!r.ok) {
      if (!r.budget) issues.push({ label: term, message: r.message });
      return;
    }
    const items = (r.body as { items?: unknown } | null)?.items;
    if (!Array.isArray(items)) {
      issues.push({ label: term, message: 'response had no items array' });
      return;
    }
    for (const row of items) {
      if (typeof row !== 'object' || row === null) continue;
      const raw = row as FlippRawItem;
      const key = raw.flyer_item_id ?? raw.id;
      if (key === undefined || key === null) continue;
      const k = String(key);
      if (!rawByKey.has(k)) rawByKey.set(k, raw);
    }
  }

  await mapPool(terms, concurrency, searchTerm);

  const items = new Map<string, FlyerItem>();
  for (const raw of rawByKey.values()) {
    const item = toFlyerItem(raw, stores);
    if (item && !items.has(item.id)) items.set(item.id, item);
  }

  return {
    found: rawByKey.size,
    items: [...items.values()],
    raw: [...rawByKey.values()],
    errors: collapseIssues(issues, 'searches'),
    issues,
  };
}

/**
 * Searches Flipp for each term near `postal`. At most `concurrency` requests run at once, and request
 * starts are `spacingMs` apart. A 429 or 5xx is retried once after `retryDelayMs`.
 */
export async function fetchFlippItems(
  postal: string,
  terms: string[],
  fetchImpl: typeof fetch,
  opts: FlippOptions,
): Promise<FlippResult> {
  const client = createFlippClient(fetchImpl, opts);
  return searchFlippTerms(postal, terms, client, opts.stores, opts.concurrency ?? 4);
}
