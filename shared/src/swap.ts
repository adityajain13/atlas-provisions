// Meal swapping: which meals a swap takes in with the ones chosen (leftover chains), and the body a swap is sent with.
// Pure, so the Worker and the web app agree on what a selection replaces.
import { z } from 'zod';

export const SWAP_MAX_MEALS = 21;
export const SWAP_NOTE_MAX = 200;

/** Body for POST /plan/:weekOf/swap. The meals chosen; leftover links are added on the server. */
export const SwapRequestSchema = z.object({
  mealIds: z
    .array(z.string().min(1))
    .min(1, 'Choose at least one meal')
    .max(SWAP_MAX_MEALS, `Choose at most ${SWAP_MAX_MEALS} meals`),
  note: z.string().trim().max(SWAP_NOTE_MAX, `The note is at most ${SWAP_NOTE_MAX} characters`).optional(),
});
export type SwapRequest = z.infer<typeof SwapRequestSchema>;

/** What a swap changed: the meal ids it replaced, and the ids of the new meals in their place. */
export interface SwapResult {
  swapped: string[];
  added: string[];
}

/** The leftover fields a swap reads from a planned meal. */
export interface LeftoverLinked {
  id: string;
  usesLeftoversFrom?: string;
  makesLeftoversFor?: string;
}

/**
 * The meals a selection takes in. Each selected meal brings in the meals it links to by leftovers: the meals
 * that eat its leftovers, and the meal whose leftovers it eats. Those meals bring in their own links, so a chain
 * (A makes leftovers for B, B for C) comes in whole, and one source feeding several meals takes them all.
 * Ids that are not in `meals` (fixed meals, unknown ids) are ignored. Returns the ids in plan order.
 */
export function swapClosure(meals: readonly LeftoverLinked[], selectedIds: readonly string[]): string[] {
  const known = new Set(meals.map((m) => m.id));
  const links = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b || !known.has(a) || !known.has(b)) return;
    links.set(a, (links.get(a) ?? new Set<string>()).add(b));
    links.set(b, (links.get(b) ?? new Set<string>()).add(a));
  };
  for (const m of meals) {
    if (m.makesLeftoversFor) link(m.id, m.makesLeftoversFor);
    if (m.usesLeftoversFrom) link(m.id, m.usesLeftoversFrom);
  }

  const taken = new Set(selectedIds.filter((id) => known.has(id)));
  const queue = [...taken];
  while (queue.length > 0) {
    const id = queue.pop()!;
    for (const next of links.get(id) ?? []) {
      if (taken.has(next)) continue;
      taken.add(next);
      queue.push(next);
    }
  }
  return meals.map((m) => m.id).filter((id) => taken.has(id));
}
