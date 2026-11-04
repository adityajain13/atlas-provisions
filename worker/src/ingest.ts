// Flyer import: search Flipp for the catalogue, store the items, and record the matched prices.
import {
  buildSearchTerms,
  matchFlyerItem,
  newId,
  torontoDate,
  type IngestRunSummary,
  type MatchedItem,
} from '@provisions/shared';
import { insertFlyerItems, insertIngestRun, loadHousehold, recordPrices } from './db';
import { fetchFlippItems, type FlippOptions } from './flipp';

export type IngestEnv = { DB: D1Database };

const UNMATCHED_SAMPLE = 15;
const MAX_ERRORS = 20;

const notRun = (message: string): IngestRunSummary => ({
  ok: false,
  terms: 0,
  items: 0,
  stored: 0,
  matched: 0,
  unmatchedSample: [],
  errors: [message],
});

/**
 * One import run. Does nothing (and writes no run row) without a postal code or an enabled store.
 * Otherwise it writes the flyer items, records prices for the ones that match an ingredient, and
 * writes an ingest_runs row. ok is true when at least one term searched successfully.
 */
export async function runIngest(
  env: IngestEnv,
  fetchImpl: typeof fetch = fetch,
  opts: Partial<FlippOptions> = {},
): Promise<IngestRunSummary> {
  const household = await loadHousehold(env.DB);
  if (!household.postalCode) return notRun('Add a postal code in Household first.');
  const stores = household.stores
    .filter((s) => s.enabled)
    .map((s) => ({ name: s.name, flippNames: s.flippNames }));
  if (stores.length === 0) return notRun('Turn on at least one store in Household first.');

  const startedAt = new Date().toISOString();
  const terms = buildSearchTerms();
  const found = await fetchFlippItems(household.postalCode, terms, fetchImpl, { ...opts, stores });

  await insertFlyerItems(env.DB, found.items);

  const matched: MatchedItem[] = [];
  const unmatched: string[] = [];
  for (const item of found.items) {
    const m = matchFlyerItem(item);
    if (m) matched.push(m);
    else unmatched.push(item.rawName);
  }
  await recordPrices(env.DB, matched, torontoDate());

  const finishedAt = new Date().toISOString();
  const errors = found.errors.slice(0, MAX_ERRORS);
  const ok = terms.length > 0 && found.errors.length < terms.length;
  await insertIngestRun(env.DB, {
    id: newId(),
    startedAt,
    finishedAt,
    ok,
    terms: terms.length,
    items: found.found,
    stored: found.items.length,
    matched: matched.length,
    errors,
    sample: found.raw,
  });

  return {
    ok,
    terms: terms.length,
    items: found.found,
    stored: found.items.length,
    matched: matched.length,
    unmatchedSample: [...new Set(unmatched)].slice(0, UNMATCHED_SAMPLE),
    errors,
  };
}
