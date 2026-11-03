import { HouseholdSchema, type Household, type MealPlan, type PlanRequest } from '@provisions/shared';

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
