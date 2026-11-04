// Flipp flyer search. Flipp's public web app uses this JSON endpoint; it is unofficial and may change.
// Every field is treated as optional, and a failed term is recorded in `errors` instead of thrown.
import {
  isoDatePart,
  matchStoreName,
  priceTextFrom,
  type FlyerItem,
  type StoreMatchInput,
} from '@provisions/shared';

export const FLIPP_SEARCH_URL = 'https://backflipp.wishabi.com/flipp/items/search';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export interface FlippOptions {
  /** Household stores to keep, by name and Flipp names. Items from other merchants are skipped. */
  stores: StoreMatchInput[];
  concurrency?: number; // default 4
  spacingMs?: number; // default 250, between request starts
  timeoutMs?: number; // default 10 000
  retryDelayMs?: number; // default 1 000, before the one retry on 429 or 5xx
  sleep?: (ms: number) => Promise<void>;
}

export type FlippRawItem = Record<string, unknown>;

export interface FlippResult {
  /** Unique raw items across all terms, before the store filter. */
  found: number;
  /** Mapped flyer items for the household's stores, deduplicated by id. */
  items: FlyerItem[];
  /** The raw items, for the debugging sample. */
  raw: FlippRawItem[];
  /** One message per failed term. */
  errors: string[];
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** A Flipp item as a FlyerItem, or null when it cannot be used (no store, name, price or dates). */
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
 * Searches Flipp for each term near `postal` (uppercase, no space). At most `concurrency` requests run at once,
 * and request starts are `spacingMs` apart. A 429 or 5xx is retried once after `retryDelayMs`.
 */
export async function fetchFlippItems(
  postal: string,
  terms: string[],
  fetchImpl: typeof fetch,
  opts: FlippOptions,
): Promise<FlippResult> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const spacingMs = opts.spacingMs ?? 250;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retryDelayMs = opts.retryDelayMs ?? 1_000;
  const sleep = opts.sleep ?? defaultSleep;

  const errors: string[] = [];
  const rawByKey = new Map<string, FlippRawItem>();

  // Shared start gate: each request waits until `nextStart`, then pushes it `spacingMs` on.
  let nextStart = 0;
  async function gate(): Promise<void> {
    const now = Date.now();
    const startAt = Math.max(now, nextStart);
    nextStart = startAt + spacingMs;
    const wait = startAt - now;
    if (wait > 0) await sleep(wait);
  }

  async function searchTerm(term: string): Promise<void> {
    const url =
      `${FLIPP_SEARCH_URL}?locale=en-ca&postal_code=${encodeURIComponent(postal)}&q=${encodeURIComponent(term)}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      await gate();
      let res: Response;
      try {
        res = await fetchImpl(url, {
          headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        errors.push(`${term}: ${e instanceof Error ? e.message : 'request failed'}`);
        return;
      }
      if ((res.status === 429 || res.status >= 500) && attempt === 0) {
        await sleep(retryDelayMs);
        continue;
      }
      if (!res.ok) {
        errors.push(`${term}: HTTP ${res.status}`);
        return;
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        errors.push(`${term}: response was not JSON`);
        return;
      }
      const items = (body as { items?: unknown } | null)?.items;
      if (!Array.isArray(items)) {
        errors.push(`${term}: response had no items array`);
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
      return;
    }
  }

  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, terms.length) }, async () => {
    while (next < terms.length) {
      const term = terms[next++]!;
      await searchTerm(term);
    }
  });
  await Promise.all(workers);

  const items = new Map<string, FlyerItem>();
  for (const raw of rawByKey.values()) {
    const item = toFlyerItem(raw, opts.stores);
    if (item && !items.has(item.id)) items.set(item.id, item);
  }

  return {
    found: rawByKey.size,
    items: [...items.values()],
    raw: [...rawByKey.values()],
    errors,
  };
}
