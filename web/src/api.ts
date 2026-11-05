import {
  ChecksSchema,
  HouseholdSchema,
  type MembersView,
  type MyInvitesView,
  type UsageView,
  type CheckBulk,
  type CheckKind,
  type Checks,
  type IngestRunSummary,
  type IngestStatus,
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

export async function requestLoginCode(email: string): Promise<void> {
  await ensureOk(
    await authFetch(`${BASE}/auth/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }),
  );
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

export async function saveHousehold(household: Household): Promise<Household> {
  const res = await ensureOk(
    await authFetch(`${BASE}/household`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(household),
    }),
  );
  return HouseholdSchema.parse(await res.json());
}

/** Plan a week. Takes up to a minute. Errors carry the server's message as-is. */
export async function generatePlan(req: PlanRequest): Promise<MealPlan> {
  const res = await ensureOk(
    await authFetch(`${BASE}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }),
  );
  return readStoredPlan((await res.json()) as MealPlan) as MealPlan;
}

/** Rebuilds only the batch prep of a saved plan, with one Haiku call. Returns the updated plan. */
export async function regeneratePrep(weekOf: string): Promise<MealPlan> {
  const res = await ensureOk(await authFetch(`${BASE}/plan/${weekOf}/prep`, { method: 'POST' }));
  return readStoredPlan((await res.json()) as MealPlan) as MealPlan;
}

/** The saved plan for a week, or null when there is none. */
export async function getPlan(weekOf: string): Promise<MealPlan | null> {
  const res = await authFetch(`${BASE}/plan/${weekOf}`);
  if (res.status === 404) return null;
  return readStoredPlan((await (await ensureOk(res)).json()) as MealPlan) as MealPlan;
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
  return json(await authFetch(`${BASE}/ratings`), (raw) => RatingSchema.array().parse(raw));
}

export async function saveRating(input: RatingInput): Promise<Rating> {
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
