import {
  ChecksSchema,
  HouseholdSchema,
  type GuestsInput,
  type MealStatus,
  type MealStatusInput,
  type FeedbackSummary,
  type IngredientFeedbackInput,
  type WeekFeedback,
  type AccessEntry,
  type AccessView,
  type MeView,
  type MembersView,
  type MyInvitesView,
  type UsageView,
  type CheckBulk,
  type CheckKind,
  type Checks,
  type IngestRunSummary,
  type IngestStatus,
  type StoreSyncMap,
  PantryItemSchema,
  RatingSchema,
  type Household,
  type MealPlan,
  type PantryCreate,
  type PantryItem,
  type ParsedReceipt,
  type PlanRequest,
  readStoredPlan,
  type Rating,
  type RatingInput,
  type ReceiptCommit,
} from '@provisions/shared';
import type { PlanProgressEvent } from './lib/planProgress';

const BASE = '/provisions/api';

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong';
}

/** Sends the browser to sign in, then back to the page it was on. Never returns. */
function redirectToLogin(): never {
  const here = window.location.pathname.replace(/^\/provisions/, '') + window.location.search;
  window.location.assign(`/provisions/login?next=${encodeURIComponent(here)}`);
  throw new Error('Sign in');
}

/** fetch for the API. Any 401 from a non-auth route sends the browser to the sign-in page. */
async function authFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401 && !input.startsWith(`${BASE}/auth/`)) redirectToLogin();
  return res;
}

// ---- Sign-in ----

/** The signed-in email, or null when there is no session. Does not redirect. */
export async function fetchSession(): Promise<{ email: string } | null> {
  const res = await fetch(`${BASE}/auth/me`);
  if (res.status === 401) return null;
  return (await ensureOk(res)).json() as Promise<{ email: string }>;
}

/** `alreadySent` means a code went out moments ago (maybe from another device); use that one. */
export async function requestLoginCode(email: string): Promise<{ alreadySent: boolean }> {
  const res = await authFetch(`${BASE}/auth/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  await ensureOk(res);
  const body = (await res.json().catch(() => ({}))) as { alreadySent?: unknown };
  return { alreadySent: body.alreadySent === true };
}

export async function verifyLoginCode(email: string, code: string): Promise<{ email: string }> {
  return (await ensureOk(
    await authFetch(`${BASE}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    }),
  )).json() as Promise<{ email: string }>;
}

export async function signOutRequest(): Promise<void> {
  await authFetch(`${BASE}/auth/logout`, { method: 'POST' });
}

async function ensureOk(res: Response): Promise<Response> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res;
}

export async function getHousehold(): Promise<Household> {
  const res = await ensureOk(await authFetch(`${BASE}/household`));
  return HouseholdSchema.parse(await res.json());
}

// Reads the week screen repeats when the reader switches weeks. A value is reused for CACHE_MS, or until this page
// saves it. The TTL bounds how stale a change by another member can be.
const CACHE_MS = 60_000;
interface Cached<T> {
  value: Promise<T>;
  at: number;
}
const householdCache: { entry: Cached<Household> | null } = { entry: null };
const ratingsCache: { entry: Cached<Rating[]> | null } = { entry: null };

function cachedRead<T>(cache: { entry: Cached<T> | null }, load: () => Promise<T>): Promise<T> {
  const current = cache.entry;
  if (current && Date.now() - current.at < CACHE_MS) return current.value;
  const entry: Cached<T> = { value: load(), at: Date.now() };
  cache.entry = entry;
  // A failed read is not kept, so the next call asks again.
  entry.value.catch(() => {
    if (cache.entry === entry) cache.entry = null;
  });
  return entry.value;
}

/** getHousehold, reused for a minute or until the household is saved from this page. */
export function getHouseholdCached(): Promise<Household> {
  return cachedRead(householdCache, getHousehold);
}

/** getRatings, reused for a minute or until a rating is saved from this page. */
export function getRatingsCached(): Promise<Rating[]> {
  return cachedRead(ratingsCache, getRatings);
}

export async function saveHousehold(household: Household): Promise<Household> {
  householdCache.entry = null;
  const res = await ensureOk(
    await authFetch(`${BASE}/household`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(household),
    }),
  );
  householdCache.entry = null;
  return HouseholdSchema.parse(await res.json());
}

/**
 * Reads a planner response that streams JSON lines (progress events, then one done or error line). Progress goes to
 * onProgress. Resolves with the done line; an error line throws its message. Returns null when the body is not a stream.
 */
export async function readPlanStream(
  res: Response,
  onProgress?: (e: PlanProgressEvent) => void,
): Promise<Record<string, unknown> | null> {
  if (!(res.headers.get('content-type') ?? '').includes('application/x-ndjson') || !res.body) return null;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const state: { done: Record<string, unknown> | null } = { done: null };
  const handle = (line: string) => {
    if (line.trim() === '') return;
    const event = JSON.parse(line) as { stage: string; message?: string };
    if (event.stage === 'done') state.done = event as Record<string, unknown>;
    else if (event.stage === 'error') throw new Error(event.message ?? 'Planner failed');
    else onProgress?.(event as PlanProgressEvent);
  };
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(handle);
  }
  handle(buffer);
  if (!state.done) throw new Error('The planner stopped before it finished.');
  return state.done;
}

/**
 * Plan a week. Takes up to a minute. Progress is streamed (see readPlanStream) and passed to onProgress. Errors carry
 * the server's message as-is.
 */
export async function generatePlan(req: PlanRequest, onProgress?: (e: PlanProgressEvent) => void): Promise<MealPlan> {
  const res = await ensureOk(
    await authFetch(`${BASE}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify(req),
    }),
  );
  const streamed = await readPlanStream(res, onProgress);
  if (streamed) return readStoredPlan(streamed.plan as MealPlan) as MealPlan;
  return readStoredPlan((await res.json()) as MealPlan) as MealPlan;
}

/** Rebuilds only the batch prep of a saved plan, with one Haiku call. Returns the updated plan. */
export async function regeneratePrep(weekOf: string): Promise<MealPlan> {
  const res = await ensureOk(await authFetch(`${BASE}/plan/${weekOf}/prep`, { method: 'POST' }));
  return readStoredPlan((await res.json()) as MealPlan) as MealPlan;
}

/** A swap's result: the whole week after it, and which meals were replaced and which are new. */
export type SwapOutcome = MealPlan & { swapped: string[]; added: string[] };

/**
 * Swaps the chosen meals of a week, and the meals linked to them by leftovers. The server adds the linked meals and
 * keeps the rest of the week. Takes up to a minute. Progress is streamed and passed to onProgress. Errors carry the
 * server's message as-is (a 429 names the cap). Guests join the freed slots, with their allergies, when given.
 */
export async function swapMeals(
  weekOf: string,
  mealIds: string[],
  note?: string,
  onProgress?: (e: PlanProgressEvent) => void,
  guests?: GuestsInput,
): Promise<SwapOutcome> {
  const res = await ensureOk(
    await authFetch(`${BASE}/plan/${weekOf}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify({
        mealIds,
        ...(note && note.trim() ? { note: note.trim() } : {}),
        ...(guests ? { guests } : {}),
      }),
    }),
  );
  const streamed = await readPlanStream(res, onProgress);
  const body = (streamed ?? (await res.json())) as SwapOutcome & { plan?: MealPlan };
  // A streamed done line carries the plan under `plan`; a plain response is the plan itself.
  const plan = (body.plan ?? body) as MealPlan;
  return { ...(readStoredPlan(plan) as MealPlan), swapped: body.swapped, added: body.added };
}

/** Puts back the plan that the last swap or new plan replaced. Returns the restored week. */
export async function undoSwap(weekOf: string): Promise<MealPlan> {
  const res = await ensureOk(await authFetch(`${BASE}/plan/${weekOf}/undo`, { method: 'POST' }));
  return readStoredPlan((await res.json()) as MealPlan) as MealPlan;
}

/** The saved plan for a week, or null when there is none. */
export async function getPlan(weekOf: string): Promise<MealPlan | null> {
  const res = await authFetch(`${BASE}/plan/${weekOf}`);
  if (res.status === 404) return null;
  return readStoredPlan((await (await ensureOk(res)).json()) as MealPlan) as MealPlan;
}

/** The saved plan for a week with the statuses marked on its meals ("Didn't go to plan?"), or null when there is none. */
export async function getWeekPlan(weekOf: string): Promise<{ plan: MealPlan; statuses: Record<string, MealStatus> } | null> {
  const res = await authFetch(`${BASE}/plan/${weekOf}`);
  if (res.status === 404) return null;
  const { statuses, ...rest } = (await (await ensureOk(res)).json()) as MealPlan & { statuses?: Record<string, MealStatus> };
  return { plan: readStoredPlan(rest) as MealPlan, statuses: statuses ?? {} };
}

/** Marks a planned meal: skipped, made something else, or with guests. Replaces the meal's mark. Returns what was saved. */
export async function setMealStatus(weekOf: string, mealId: string, input: MealStatusInput): Promise<MealStatus> {
  return json(
    await authFetch(`${BASE}/plan/${weekOf}/meals/${encodeURIComponent(mealId)}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    (raw) => raw as MealStatus,
  );
}

/** Clears a meal's mark: it went to plan after all. */
export async function clearMealStatus(weekOf: string, mealId: string): Promise<void> {
  await ensureOk(await authFetch(`${BASE}/plan/${weekOf}/meals/${encodeURIComponent(mealId)}/status`, { method: 'DELETE' }));
}

/** Puts a planned meal's unused ingredient amounts (base units) into the pantry as plan leftovers. Returns the new items. */
export async function addPlanLeftovers(
  weekOf: string,
  mealId: string,
  items: { ingredientId: string; qty: number }[],
): Promise<PantryItem[]> {
  return json(
    await authFetch(`${BASE}/plan/${weekOf}/meals/${encodeURIComponent(mealId)}/to-pantry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    }),
    (raw) => (raw as { added: PantryItem[] }).added,
  );
}

// ---- Pantry (milestone 3A) ----

async function json<T>(res: Response, parse: (raw: unknown) => T): Promise<T> {
  return parse(await (await ensureOk(res)).json());
}

export async function getPantry(): Promise<PantryItem[]> {
  return json(await authFetch(`${BASE}/pantry`), (raw) => PantryItemSchema.array().parse(raw));
}

export async function addPantryItem(input: PantryCreate): Promise<PantryItem> {
  return json(
    await authFetch(`${BASE}/pantry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    (raw) => PantryItemSchema.parse(raw),
  );
}

export async function updatePantryItem(id: string, patch: { qty?: number; expiresOn?: string }): Promise<PantryItem> {
  return json(
    await authFetch(`${BASE}/pantry/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
    (raw) => PantryItemSchema.parse(raw),
  );
}

export async function removePantryItem(id: string): Promise<void> {
  await ensureOk(await authFetch(`${BASE}/pantry/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}

// ---- Meal ratings (milestone 3A) ----

export async function getRatings(): Promise<Rating[]> {
  const ratings = await json(await authFetch(`${BASE}/ratings`), (raw) => RatingSchema.array().parse(raw));
  ratingsCache.entry = { value: Promise.resolve(ratings), at: Date.now() };
  return ratings;
}

export async function saveRating(input: RatingInput): Promise<Rating> {
  ratingsCache.entry = null;
  return json(
    await authFetch(`${BASE}/ratings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    (raw) => RatingSchema.parse(raw),
  );
}

// ---- Receipts (milestone 3B) ----

/** Reads a receipt photo (base64 JPEG). Nothing is saved until commitReceipt. */
export async function parseReceipt(image: string): Promise<ParsedReceipt> {
  return json(
    await authFetch(`${BASE}/receipts/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
    }),
    (raw) => raw as ParsedReceipt,
  );
}

export interface ReceiptCommitResult {
  prices: number;
  matches: number;
  pantryItems: number;
}

export async function commitReceipt(input: ReceiptCommit): Promise<ReceiptCommitResult> {
  return json(
    await authFetch(`${BASE}/receipts/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    (raw) => raw as ReceiptCommitResult,
  );
}

// ---- Shopping and prep ticks (shared across the household) ----

/** Every tick saved for the week. */
export async function getChecks(weekOf: string): Promise<Checks> {
  return json(await authFetch(`${BASE}/checks/${weekOf}`), (raw) => ChecksSchema.parse(raw));
}

/** Sets one tick. Last write wins. */
export async function setCheck(weekOf: string, kind: CheckKind, itemId: string, checked: boolean): Promise<void> {
  await ensureOk(
    await authFetch(`${BASE}/checks/${weekOf}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, itemId, checked }),
    }),
  );
}

/** Moves ticks saved in this browser before they synced. Items the server already has are left alone. */
export async function bulkChecks(weekOf: string, body: CheckBulk): Promise<void> {
  await ensureOk(
    await authFetch(`${BASE}/checks/${weekOf}/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

// ---- Flyer import (milestone 4) ----

/** The latest flyer run and the prices valid today, per store. */
export async function getFlyerStatus(): Promise<IngestStatus> {
  return json(await authFetch(`${BASE}/flyers/status`), (raw) => raw as IngestStatus);
}

/** Searches Flipp now. Takes up to a minute. */
export async function refreshFlyers(): Promise<IngestRunSummary> {
  return json(await authFetch(`${BASE}/flyers/refresh`, { method: 'POST' }), (raw) => raw as IngestRunSummary);
}

// ---- Regular prices from the Loblaw-family sites (store locations and batch lookups) ----

export interface SiteLocationOption {
  storeId: string;
  label: string;
  postalCode: string | null;
  /** Kilometres from the household's postal code, when the server could place both. */
  distanceKm?: number;
}

/** A location found by the cross-banner search: the banner it is on, with the option's fields. */
export interface StoreBranchOption extends SiteLocationOption {
  banner: string;
}

/** One regular-price batch: what it looked up and matched, and whether the site asked for a sign-in. */
export interface SiteRunResult {
  ok: boolean;
  lookups: number;
  matched: number;
  errors: string[];
  authNeeded: boolean;
}

export interface SiteStatus {
  lastRun: (SiteRunResult & { id: string; startedAt: string; finishedAt: string; sample?: unknown[] }) | null;
  prices: number; // ingredient and store pairs with a site price in the last two weeks, at the household's locations
}

/** The query string of a site search: the text, and the household postal code when there is one. */
function siteQuery(q: string, near: string): string {
  return `q=${encodeURIComponent(q)}${near ? `&near=${encodeURIComponent(near)}` : ''}`;
}

/** Store locations of a banner that match the search text, or the nearest to a postal code when it is empty. */
export async function searchSiteLocations(banner: string, q: string, near = ''): Promise<SiteLocationOption[]> {
  const body = await json(
    await authFetch(`${BASE}/site-stores/${encodeURIComponent(banner)}/locations?${siteQuery(q, near)}`),
    (raw) => raw as { locations: SiteLocationOption[] },
  );
  return body.locations;
}

/** The locations of every banner that match the address or postal code, or the nearest to the household's when empty. */
export interface StoreBranchReply {
  locations: StoreBranchOption[];
  /** Chains whose list could not be read right now. */
  unavailable?: string[];
  approx?: boolean;
}

export async function searchStoreBranches(q: string, near: string): Promise<StoreBranchReply> {
  return json(await authFetch(`${BASE}/site-stores/search?${siteQuery(q, near)}`), (raw) => raw as StoreBranchReply);
}

/** When each price source last read each of the household's stores (flyers, regular prices, T&T), keyed by store id. */
export async function getStoreSync(): Promise<StoreSyncMap> {
  const body = await json(await authFetch(`${BASE}/stores/sync`), (raw) => raw as { stores: StoreSyncMap });
  return body.stores;
}

export async function getSitePriceStatus(): Promise<SiteStatus> {
  return json(await authFetch(`${BASE}/site-prices/status`), (raw) => raw as SiteStatus);
}

/** Reads the regular prices of the household's stores now. Takes up to a minute. */
export async function refreshSitePrices(): Promise<SiteRunResult> {
  return json(await authFetch(`${BASE}/site-prices/refresh`, { method: 'POST' }), (raw) => raw as SiteRunResult);
}

// ---- Households: members, invites, leaving, usage ----

export async function getMembers(): Promise<MembersView> {
  return json(await authFetch(`${BASE}/members`), (raw) => raw as MembersView);
}

export async function renameHousehold(name: string): Promise<{ name: string }> {
  return json(
    await authFetch(`${BASE}/household-name`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
    (raw) => raw as { name: string },
  );
}

/** Invites an address. `emailed` says whether the sign-in email went out. */
export async function inviteMember(email: string): Promise<{ invite: { email: string; createdAt: string }; emailed: boolean }> {
  return json(
    await authFetch(`${BASE}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }),
    (raw) => raw as { invite: { email: string; createdAt: string }; emailed: boolean },
  );
}

export async function cancelInvite(email: string): Promise<void> {
  await ensureOk(await authFetch(`${BASE}/invites/${encodeURIComponent(email)}`, { method: 'DELETE' }));
}

export async function removeMember(email: string): Promise<void> {
  await ensureOk(await authFetch(`${BASE}/members/${encodeURIComponent(email)}`, { method: 'DELETE' }));
}

/** Leaves the household. `deleted` says the household went with it (its owner was the last member). */
export async function leaveHousehold(): Promise<{ deleted: boolean }> {
  return json(await authFetch(`${BASE}/leave`, { method: 'POST' }), (raw) => raw as { deleted: boolean });
}

export async function getMyInvites(): Promise<MyInvitesView> {
  return json(await authFetch(`${BASE}/my-invites`), (raw) => raw as MyInvitesView);
}

export async function acceptInvite(householdId: string): Promise<{ householdId: string; name: string; deleted: boolean }> {
  return json(
    await authFetch(`${BASE}/invites/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ householdId }),
    }),
    (raw) => raw as { householdId: string; name: string; deleted: boolean },
  );
}

export async function getUsage(): Promise<UsageView> {
  return json(await authFetch(`${BASE}/usage`), (raw) => raw as UsageView);
}

// ---- App access (admins only; see Household > App access) ----

export async function getMe(): Promise<MeView> {
  return json(await authFetch(`${BASE}/me`), (raw) => raw as MeView);
}

/** Every approved address and where its access comes from. Admins only. */
export async function getAccess(): Promise<AccessView> {
  return json(await authFetch(`${BASE}/access`), (raw) => raw as AccessView);
}

/** Gives an address access. `emailed` says whether the sign-in email went out (it is only sent when asked). */
export async function giveAccess(email: string, sendEmail: boolean): Promise<{ entry: AccessEntry; emailed: boolean }> {
  return json(
    await authFetch(`${BASE}/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, sendEmail }),
    }),
    (raw) => raw as { entry: AccessEntry; emailed: boolean },
  );
}

/** Removes an address's app access and signs it out. With deleteHousehold, its own household goes too. */
export async function revokeAccess(email: string, deleteHousehold: boolean): Promise<{ householdDeleted: boolean }> {
  const query = deleteHousehold ? '?deleteHousehold=1' : '';
  return json(
    await authFetch(`${BASE}/access/${encodeURIComponent(email)}${query}`, { method: 'DELETE' }),
    (raw) => raw as { householdDeleted: boolean },
  );
}

// ---- Ingredient changes: skipped or replaced in a planned meal, and what the planner has learned ----

/** The changes saved for one week, by meal id and ingredient id. */
export async function getWeekFeedback(weekOf: string): Promise<WeekFeedback> {
  return json(await authFetch(`${BASE}/plan/${weekOf}/ingredient-feedback`), (raw) => raw as WeekFeedback);
}

/** Marks one ingredient in one planned meal as skipped or replaced. */
export async function saveIngredientFeedback(
  weekOf: string,
  mealId: string,
  ingredientId: string,
  input: IngredientFeedbackInput,
): Promise<void> {
  await ensureOk(
    await authFetch(`${BASE}/plan/${weekOf}/meals/${encodeURIComponent(mealId)}/ingredients/${ingredientId}/feedback`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

/** Clears one ingredient's change in one planned meal: used as planned. */
export async function clearIngredientFeedback(weekOf: string, mealId: string, ingredientId: string): Promise<void> {
  await ensureOk(
    await authFetch(`${BASE}/plan/${weekOf}/meals/${encodeURIComponent(mealId)}/ingredients/${ingredientId}/feedback`, {
      method: 'DELETE',
    }),
  );
}

/** What the planner has learned from the last 90 days: each ingredient's skips and replacements. */
export async function getIngredientFeedback(): Promise<FeedbackSummary> {
  return json(await authFetch(`${BASE}/ingredient-feedback`), (raw) => raw as FeedbackSummary);
}

/** Forgets an ingredient's changes in every week. */
export async function forgetIngredientFeedback(ingredientId: string): Promise<void> {
  await ensureOk(await authFetch(`${BASE}/ingredient-feedback/${ingredientId}`, { method: 'DELETE' }));
}

// ---- T&T prices from the signed-in browser (the extension or the bookmark) ----

/** The last browser sync of the household's T&T prices. */
export interface TntSyncStatus {
  enabled: boolean;
  lastRun: { finishedAt: string; ok: boolean; lookups: number; matched: number } | null;
  /** Ingredients with a T&T price in the last fourteen days. */
  prices: number;
}

export async function getTntSyncStatus(): Promise<TntSyncStatus> {
  return json(await authFetch(`${BASE}/tnt-sync/status`), (raw) => raw as TntSyncStatus);
}

/** One of the household's sync keys: a browser, a device, or a bookmark. Never the key itself. */
export interface SyncKeyRow {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function listSyncKeys(): Promise<SyncKeyRow[]> {
  return json(await authFetch(`${BASE}/sync-keys`), (raw) => raw as SyncKeyRow[]);
}

/** Makes a sync key with this label. The key is returned once. Other keys are not changed. */
export async function createSyncKey(label: string): Promise<{ id: string; label: string; key: string }> {
  const res = await authFetch(`${BASE}/sync-keys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  return json(await ensureOk(res), (raw) => raw as { id: string; label: string; key: string });
}

/** Revokes one sync key. The browser or bookmark holding it stops working; the others are not affected. */
export async function revokeSyncKey(id: string): Promise<void> {
  await ensureOk(await authFetch(`${BASE}/sync-keys/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}
