// "Didn't go to plan?": the wording and the rules the Week and meal screens share. Pure: no DOM, no requests.
import {
  DAYS,
  INGREDIENT_BY_ID,
  SKIP_REASON_LABEL,
  SWAP_NOTE_MAX,
  formatCookAmount,
  isMealUpcoming,
  normalizeAllergies,
  type GuestsInput,
  type MealPlan,
  type MealStatus,
  type MealStatusInput,
  type PlannedMeal,
} from '@provisions/shared';
import { DAY_SHORT, SLOT_LABEL } from './labels';

/**
 * The mark a patch leaves on a meal. Skipped and "made something else" replace the mark. Guests and notes added to a
 * meal already made instead keep the name made, and the other way round, so the two forms never undo each other.
 */
export function mergeStatus(current: MealStatus | undefined, patch: MealStatusInput): MealStatusInput {
  if (patch.status === 'skipped' || current?.status !== 'replaced') return patch;
  return { ...current, ...patch, status: 'replaced' };
}

/** "Tue lunch": the short label a meal goes by in the week, as the leftover links show it. */
export const mealLabel = (m: Pick<PlannedMeal, 'day' | 'slot'>) => `${DAY_SHORT[m.day]} ${SLOT_LABEL[m.slot].toLowerCase()}`;

/** "+1 guest · tree nut", or "+3 guests · peanut, dairy". Null when no guest joined. */
export function guestsLine(status: MealStatus | undefined): string | null {
  if (!status?.guests) return null;
  const n = status.guests;
  const allergies = normalizeAllergies(status.guestAllergies ?? []);
  return `+${n} ${n === 1 ? 'guest' : 'guests'}${allergies.length > 0 ? ` · ${allergies.join(', ')}` : ''}`;
}

/** The label above a meal's name: "Skipped · Ate out", "Made: Pasta instead". Null when the meal has no such mark. */
export function markLabel(status: MealStatus | undefined): string | null {
  if (!status) return null;
  if (status.status === 'skipped') return status.reason ? `Skipped · ${SKIP_REASON_LABEL[status.reason]}` : 'Skipped';
  return status.madeName ? `Made: ${status.madeName} instead` : null;
}

/** The note a guest swap is sent with: who is joining and what they cannot eat, then anything the household typed. */
export function guestSwapNote(guests: GuestsInput, note: string): string {
  const allergies = normalizeAllergies(guests.allergies);
  const who = `${guests.count} ${guests.count === 1 ? 'guest' : 'guests'} joining`;
  const base = allergies.length > 0 ? `${who}, allergic to ${allergies.join(', ')}. Keep those out of this meal.` : `${who}.`;
  return [base, note.trim()].filter(Boolean).join(' ').slice(0, SWAP_NOTE_MAX);
}

/** The note for a swap that uses up the ingredients a skipped meal left: "Use up: spinach, chicken thighs". */
export function useUpNote(names: string[]): string {
  return `Use up: ${names.slice(0, 4).join(', ')}`.slice(0, SWAP_NOTE_MAX);
}

/** "Added 4 items to your pantry", or "Added 1 item to your pantry". */
export const pantryAddedMessage = (count: number) => `Added ${count} ${count === 1 ? 'item' : 'items'} to your pantry`;

/** The question for a skipped meal whose leftovers other meals were to eat: "Tue lunch was going to be leftovers from this." */
export function leftoversQuestion(labels: string[]): string {
  if (labels.length === 1) return `${labels[0]} was going to be leftovers from this.`;
  const last = labels[labels.length - 1];
  return `${labels.slice(0, -1).join(', ')} and ${last} were going to be leftovers from this.`;
}

/**
 * The next dinner a leftover-using swap should go to: a dinner later in the week than `from`, still to come, that is not
 * marked skipped. The earliest one. Undefined when there is none.
 */
export function nextDinnerAfter(
  plan: Pick<MealPlan, 'weekOf' | 'meals'>,
  from: Pick<PlannedMeal, 'id' | 'day'>,
  statuses: Record<string, MealStatus>,
  now: Date,
): PlannedMeal | undefined {
  const fromIndex = DAYS.indexOf(from.day);
  return plan.meals
    .filter(
      (m) =>
        m.id !== from.id &&
        m.slot === 'dinner' &&
        DAYS.indexOf(m.day) > fromIndex &&
        statuses[m.id]?.status !== 'skipped' &&
        isMealUpcoming(plan.weekOf, m.day, m.slot, now),
    )
    .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day))[0];
}

/** One ingredient of a planned meal, as the pantry checklist shows it. Ticked by default: the meal did not use it. */
export interface PantryChoice {
  ingredientId: string;
  name: string;
  qty: number; // base units, as planned
  amount: string; // "250 g", as the cook amount reads
  ticked: boolean;
}

/** The checklist for a skipped or made-instead meal: each ingredient it planned, all ticked. */
export function pantryChoices(meal: Pick<PlannedMeal, 'ingredients'>): PantryChoice[] {
  return meal.ingredients.map((ing) => ({
    ingredientId: ing.ingredientId,
    name: INGREDIENT_BY_ID[ing.ingredientId]?.name ?? ing.ingredientId,
    qty: ing.qty,
    amount: formatCookAmount(ing.ingredientId, ing.qty),
    ticked: true,
  }));
}
