// Always and never buy: what the Household chips and their inset say. Pure, so it is tested without the DOM.
import { INGREDIENT_BY_ID, alwaysBuyId, expandRule, type ItemRule } from '@provisions/shared';

export const NO_MATCH_TEXT = 'No match';
export const EMPTY_EXPANSION_TEXT =
  'Matches nothing in the catalogue yet; meals named with it are still blocked.';

/** "beef · 3 items", "corn · 1 item", "oats · 0 items". */
export function neverChipLabel(name: string, blocked: number): string {
  return `${name} · ${blocked} ${blocked === 1 ? 'item' : 'items'}`;
}

/** The catalogue name an always-buy name stands for, or null when nothing matches. */
export function alwaysMatchName(name: string): string | null {
  const id = alwaysBuyId(name);
  return id ? (INGREDIENT_BY_ID[id]?.name ?? null) : null;
}

/** Every ingredient a never-buy name covers, in catalogue order, with whether it is blocked now. */
export function neverExpansion(rule: Pick<ItemRule, 'name' | 'except'>): { id: string; name: string; blocked: boolean }[] {
  const except = new Set(rule.except ?? []);
  return expandRule(rule.name).map((id) => ({
    id,
    name: INGREDIENT_BY_ID[id]?.name ?? id,
    blocked: !except.has(id),
  }));
}

/**
 * The except list after one ingredient is ticked or un-ticked. Ticked means blocked, so un-ticking adds it to
 * the list. An empty list is dropped, so the stored rule stays as it was before any un-ticking.
 */
export function exceptAfter(except: string[] | undefined, id: string, blocked: boolean): string[] | undefined {
  const next = (except ?? []).filter((x) => x !== id);
  if (!blocked) next.push(id);
  return next.length > 0 ? next : undefined;
}
