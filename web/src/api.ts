import { HouseholdSchema, type Household } from '@provisions/shared';

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
