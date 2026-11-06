// Wording and selection for meal swapping. Pure: no DOM, no requests.
import { SWAP_NOTE_MAX, swapClosure, type Day, type MealPlan, type Slot } from '@provisions/shared';
import { DAY_SHORT } from './labels';

/** The note chips. Each adds its phrase to the note. */
export const NOTE_CHIPS = ['Quicker', 'Cheaper', 'Vegetarian', 'Different protein'] as const;

export interface SwapEntry {
  id: string;
  label: string; // "Mon dinner"
  name: string;
  // For a linked meal: what links it to the swap, e.g. "leftovers of Mon dinner".
  reason?: string;
}

export interface SwapPreview {
  closure: string[]; // every meal the swap replaces, in plan order
  chosen: SwapEntry[]; // the meals picked, in plan order
  linked: SwapEntry[]; // the meals the leftover links bring in, in plan order
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Swap 3 meals?" or "Swap 1 meal?". */
export const swapTitle = (count: number) => `Swap ${plural(count, 'meal', 'meals')}?`;

/** The toast after a swap: "Swapped 3 meals". */
export const swappedMessage = (count: number) => `Swapped ${plural(count, 'meal', 'meals')}`;

/** "1 selected", "3 selected". */
export const selectedMessage = (count: number) => `${count} selected`;

const labelOf = (m: { day: Day; slot: Slot }) => `${DAY_SHORT[m.day]} ${m.slot}`;

/**
 * What a selection replaces: the chosen meals, and the meals the leftover links bring in with them. A linked meal says
 * what links it: the meal whose leftovers it eats, or the meal that eats its leftovers.
 */
export function swapPreview(plan: Pick<MealPlan, 'meals'>, selectedIds: readonly string[]): SwapPreview {
  const closure = swapClosure(plan.meals, selectedIds);
  const inClosure = new Set(closure);
  const chosenIds = new Set(selectedIds);
  const byId = new Map(plan.meals.map((m) => [m.id, m]));

  const entry = (id: string, reason?: string): SwapEntry => {
    const m = byId.get(id)!;
    return { id, label: labelOf(m), name: m.name, ...(reason ? { reason } : {}) };
  };
  const reasonFor = (id: string): string | undefined => {
    const m = byId.get(id)!;
    if (m.usesLeftoversFrom && inClosure.has(m.usesLeftoversFrom)) {
      return `leftovers of ${labelOf(byId.get(m.usesLeftoversFrom)!)}`;
    }
    const eater = plan.meals.find((x) => inClosure.has(x.id) && x.usesLeftoversFrom === id);
    if (eater) return `makes leftovers for ${labelOf(eater)}`;
    if (m.makesLeftoversFor && inClosure.has(m.makesLeftoversFor)) {
      return `makes leftovers for ${labelOf(byId.get(m.makesLeftoversFor)!)}`;
    }
    return undefined;
  };

  return {
    closure,
    chosen: closure.filter((id) => chosenIds.has(id)).map((id) => entry(id)),
    linked: closure.filter((id) => !chosenIds.has(id)).map((id) => entry(id, reasonFor(id))),
  };
}

/** The line for a linked meal in the dialog: "Also swaps Tue lunch (leftovers of Mon dinner)". */
export function linkedLine(e: SwapEntry): string {
  return e.reason ? `Also swaps ${e.label} (${e.reason})` : `Also swaps ${e.label}`;
}

/** The note with a chip's phrase added: "quicker", or "quicker, vegetarian". Never longer than the note limit. */
export function withChip(note: string, chip: string): string {
  const phrase = chip.toLowerCase();
  const base = note.trim();
  if (base.toLowerCase().includes(phrase)) return note.slice(0, SWAP_NOTE_MAX);
  const joined = base === '' ? phrase : `${base.replace(/[,;.\s]+$/, '')}, ${phrase}`;
  return joined.slice(0, SWAP_NOTE_MAX);
}
