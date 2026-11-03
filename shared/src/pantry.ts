import { z } from 'zod';
import { INGREDIENT_BY_ID } from './catalog';
import { IsoDateSchema, addDaysIso } from './plan';

export const PANTRY_SOURCES = ['manual', 'receipt', 'plan-leftover'] as const;
export const EXPIRY_WINDOW_DAYS = 3;
const DEFAULT_SHELF_DAYS = 7; // for ingredients the catalogue does not know
const MAX_QTY = 10000;

export const PantryItemSchema = z.object({
  id: z.string().min(1),
  ingredientId: z.string().min(1),
  qty: z.number().positive('Quantity must be more than zero'),
  unit: z.enum(['kg', 'l', 'each']),
  addedOn: IsoDateSchema,
  expiresOn: IsoDateSchema,
  source: z.enum(PANTRY_SOURCES),
});
export type PantryItem = z.infer<typeof PantryItemSchema>;

/** Body for POST /pantry. The unit comes from the catalogue, and the expiry defaults from shelf life. */
export const PantryCreateSchema = z.object({
  ingredientId: z.string().min(1),
  qty: z.number().positive('Quantity must be more than zero').max(MAX_QTY),
  addedOn: IsoDateSchema.optional(),
  expiresOn: IsoDateSchema.optional(),
});
export type PantryCreate = z.infer<typeof PantryCreateSchema>;

/** Body for PATCH /pantry/:id. At least one field is required. */
export const PantryPatchSchema = z
  .object({
    qty: z.number().positive('Quantity must be more than zero').max(MAX_QTY).optional(),
    expiresOn: IsoDateSchema.optional(),
  })
  .refine((o) => o.qty !== undefined || o.expiresOn !== undefined, 'Nothing to change');
export type PantryPatch = z.infer<typeof PantryPatchSchema>;

/** Use-by date for a new item: the day it was added plus the ingredient's shelf life. */
export function defaultExpiry(ingredientId: string, addedOn: string): string {
  const shelf = INGREDIENT_BY_ID[ingredientId]?.shelfLifeDays ?? DEFAULT_SHELF_DAYS;
  return addDaysIso(addedOn, shelf);
}

/**
 * Items whose use-by date falls within `days` of `today`, soonest first. Items already past their
 * date are included, so they show up to be thrown out or used.
 */
export function expiringSoon(items: PantryItem[], today: string, days = EXPIRY_WINDOW_DAYS): PantryItem[] {
  const limit = addDaysIso(today, days);
  return items
    .filter((i) => i.expiresOn <= limit)
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.id.localeCompare(b.id));
}

/** Items still usable on `today`: not past their use-by date. The planner only sees these. */
export function usableItems(items: PantryItem[], today: string): PantryItem[] {
  return items.filter((i) => i.expiresOn >= today);
}

export interface PantryNeed {
  ingredientId: string;
  qty: number; // base units
}

export interface PantryUse {
  pantryItemId: string;
  ingredientId: string;
  qty: number;
}

const EPSILON = 1e-9;
const clean = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Take pantry stock off the needs. Each ingredient's stock is used first-in, first-out by use-by
 * date, so the soonest-expiring items go first. Returns the needs that are still short (in input
 * order, zero-quantity needs dropped) and the pantry items used.
 */
export function subtractPantry(
  needs: PantryNeed[],
  pantry: PantryItem[],
): { remaining: PantryNeed[]; used: PantryUse[] } {
  const left = new Map<string, number>(pantry.map((p) => [p.id, p.qty]));
  const byIngredient = new Map<string, PantryItem[]>();
  const fifo = [...pantry].sort(
    (a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.addedOn.localeCompare(b.addedOn) || a.id.localeCompare(b.id),
  );
  for (const item of fifo) {
    const list = byIngredient.get(item.ingredientId) ?? [];
    list.push(item);
    byIngredient.set(item.ingredientId, list);
  }

  const remaining: PantryNeed[] = [];
  const used: PantryUse[] = [];
  for (const need of needs) {
    let short = need.qty;
    for (const item of byIngredient.get(need.ingredientId) ?? []) {
      if (short <= EPSILON) break;
      const have = left.get(item.id) ?? 0;
      if (have <= EPSILON) continue;
      const take = Math.min(have, short);
      left.set(item.id, clean(have - take));
      short = clean(short - take);
      used.push({ pantryItemId: item.id, ingredientId: need.ingredientId, qty: clean(take) });
    }
    if (short > EPSILON) remaining.push({ ingredientId: need.ingredientId, qty: clean(short) });
  }
  return { remaining, used };
}

/** Today's date on the Toronto calendar, YYYY-MM-DD. */
export function torontoDate(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** A use-by date for people, such as "Nov 14". */
export function formatUseBy(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}
