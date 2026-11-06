// "Didn't go to plan?": what happened to a planned meal (skipped, or made something else), who joined it as a guest,
// and the rules the Worker and the web app share for it. Pure: no database, no requests.
import { z } from 'zod';
import { DAYS, type Day, type Slot } from './calendar';

export const MEAL_STATUSES = ['skipped', 'replaced'] as const;
export type MealStatusKind = (typeof MEAL_STATUSES)[number];

export const SKIP_REASONS = ['ate-out', 'not-eating'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  'ate-out': 'Ate out',
  'not-eating': "Didn't eat",
};

export const GUEST_MAX = 10;
export const GUEST_ALLERGY_MAX = 12;
export const GUEST_ALLERGY_LENGTH = 40;
export const MADE_NAME_MAX = 80;
export const STATUS_NOTE_MAX = 200;

/**
 * Hour (Toronto time, 24-hour) a slot starts. A meal of today counts as still to come until its slot starts.
 * These are the cut-offs for "swap for a meal that works", not a schedule the household keeps.
 */
export const SLOT_START_HOUR: Record<Slot, number> = { breakfast: 7, lunch: 11, dinner: 17 };

/** Guests joining a meal, and what they cannot eat. Shared by every guest in one swap. */
export const GuestsSchema = z.object({
  count: z.number().int().min(1, 'Add at least one guest').max(GUEST_MAX, `At most ${GUEST_MAX} guests`),
  allergies: z
    .array(z.string().trim().min(1).max(GUEST_ALLERGY_LENGTH))
    .max(GUEST_ALLERGY_MAX, `At most ${GUEST_ALLERGY_MAX} allergies`),
});
export type GuestsInput = z.infer<typeof GuestsSchema>;

/** Body for PUT /plan/:weekOf/meals/:mealId/status. Replaces the meal's row. */
export const MealStatusInputSchema = z
  .object({
    status: z.enum(MEAL_STATUSES),
    reason: z.enum(SKIP_REASONS).optional(),
    madeName: z.string().trim().min(1, 'Say what you made').max(MADE_NAME_MAX, `At most ${MADE_NAME_MAX} characters`).optional(),
    guests: z.number().int().min(1).max(GUEST_MAX).optional(),
    guestAllergies: z
      .array(z.string().trim().min(1).max(GUEST_ALLERGY_LENGTH))
      .max(GUEST_ALLERGY_MAX)
      .optional(),
    note: z.string().trim().max(STATUS_NOTE_MAX, `The note is at most ${STATUS_NOTE_MAX} characters`).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.reason !== undefined && v.status !== 'skipped') {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Only a skipped meal has a reason' });
    }
    if (v.madeName !== undefined && v.status !== 'replaced') {
      ctx.addIssue({ code: 'custom', path: ['madeName'], message: 'Only a meal made instead has a name' });
    }
    if (v.status === 'skipped' && (v.guests !== undefined || v.guestAllergies !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['guests'], message: 'A skipped meal has no guests' });
    }
    if (v.guestAllergies !== undefined && v.guests === undefined) {
      ctx.addIssue({ code: 'custom', path: ['guestAllergies'], message: 'Allergies need a guest count' });
    }
  });
export type MealStatusInput = z.infer<typeof MealStatusInputSchema>;

/** A stored row, as the Worker returns it and the week view reads it. */
export type MealStatus = MealStatusInput;

/** The statuses of a household's meals, by week (Sunday YYYY-MM-DD), then by meal id. */
export type WeekStatuses = Record<string, Record<string, MealStatus>>;

/** The short "Skipped · Ate out" line for a meal's status, or null when it has none to show. */
export function statusKindLabel(status: MealStatus): string | null {
  if (status.status === 'skipped') return status.reason ? `Skipped · ${SKIP_REASON_LABEL[status.reason]}` : 'Skipped';
  return status.madeName ? `Made: ${status.madeName} instead` : null;
}

/** True when the meal is still to come on the Toronto calendar: a later day, or today before its slot starts. */
export function isMealUpcoming(weekOf: string, day: Day, slot: Slot, now: Date, hourOf = torontoHour): boolean {
  const date = addDays(weekOf, DAYS.indexOf(day));
  const today = torontoDay(now);
  if (date > today) return true;
  if (date < today) return false;
  return hourOf(now) < SLOT_START_HOUR[slot];
}

/** The next guest ids for a plan: `guest-1`, `guest-2` ... skipping every id already eating or in the guest list. */
export function nextGuestIds(plan: { meals: { eaters: string[] }[]; guests?: Record<string, unknown> }, count: number): string[] {
  const used = new Set<string>(Object.keys(plan.guests ?? {}));
  for (const m of plan.meals) for (const id of m.eaters) used.add(id);
  const out: string[] = [];
  for (let n = 1; out.length < count; n++) {
    const id = `guest-${n}`;
    if (!used.has(id)) out.push(id);
  }
  return out;
}

/** Allergies as typed, trimmed, lower-cased and de-duplicated, in the order given. */
export function normalizeAllergies(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const a = raw.trim().toLowerCase();
    if (a && !seen.has(a)) {
      seen.add(a);
      out.push(a);
    }
  }
  return out;
}

/** The Toronto calendar date of an instant, YYYY-MM-DD. */
function torontoDay(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The hour of an instant on the Toronto clock, 0 to 23. */
export function torontoHour(date: Date): number {
  const hour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', hour: '2-digit', hourCycle: 'h23' }).format(date);
  return Number(hour) % 24;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
