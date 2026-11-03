import {
  HouseholdSchema,
  PantryItemSchema,
  RatingSchema,
  type Household,
  type MealPlan,
  type PantryCreate,
  type PantryItem,
  type ParsedReceipt,
  type PlanRequest,
  type Rating,
  type RatingInput,
  type ReceiptCommit,
} from '@provisions/shared';

const BASE = '/provisions/api';

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong';
}

async function ensureOk(res: Response): Promise<Response> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res;
}

export async function getHousehold(): Promise<Household> {
  const res = await ensureOk(await fetch(`${BASE}/household`));
  return HouseholdSchema.parse(await res.json());
}

export async function saveHousehold(household: Household): Promise<Household> {
  const res = await ensureOk(
    await fetch(`${BASE}/household`, {
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
    await fetch(`${BASE}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }),
  );
  return (await res.json()) as MealPlan;
}

/** The saved plan for a week, or null when there is none. */
export async function getPlan(weekOf: string): Promise<MealPlan | null> {
  const res = await fetch(`${BASE}/plan/${weekOf}`);
  if (res.status === 404) return null;
  return (await ensureOk(res)).json() as Promise<MealPlan>;
}

// ---- Pantry (milestone 3A) ----

async function json<T>(res: Response, parse: (raw: unknown) => T): Promise<T> {
  return parse(await (await ensureOk(res)).json());
}

export async function getPantry(): Promise<PantryItem[]> {
  return json(await fetch(`${BASE}/pantry`), (raw) => PantryItemSchema.array().parse(raw));
}

export async function addPantryItem(input: PantryCreate): Promise<PantryItem> {
  return json(
    await fetch(`${BASE}/pantry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    (raw) => PantryItemSchema.parse(raw),
  );
}

export async function updatePantryItem(id: string, patch: { qty?: number; expiresOn?: string }): Promise<PantryItem> {
  return json(
    await fetch(`${BASE}/pantry/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
    (raw) => PantryItemSchema.parse(raw),
  );
}

export async function removePantryItem(id: string): Promise<void> {
  await ensureOk(await fetch(`${BASE}/pantry/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}

// ---- Meal ratings (milestone 3A) ----

export async function getRatings(): Promise<Rating[]> {
  return json(await fetch(`${BASE}/ratings`), (raw) => RatingSchema.array().parse(raw));
}

export async function saveRating(input: RatingInput): Promise<Rating> {
  return json(
    await fetch(`${BASE}/ratings`, {
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
    await fetch(`${BASE}/receipts/parse`, {
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
    await fetch(`${BASE}/receipts/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    (raw) => raw as ReceiptCommitResult,
  );
}
