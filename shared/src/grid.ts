import { DAYS, SLOTS, type Day, type Slot } from './calendar';
import type { Household } from './index';
import type { PlanRequest, SlotCell, WeekOverride } from './plan';

/** A fixed meal served at one (day, slot) to some of the people covered by it. */
export interface FixedPlacement {
  id: string;
  fixedMealId: string;
  day: Day;
  slot: Slot;
  eaters: string[];
}

export interface ExpandedWeek {
  cells: SlotCell[]; // plannable cells only, each with at least one eater
  fixed: FixedPlacement[];
}

export function placementId(fixedMealId: string, day: Day, slot: Slot): string {
  return `${fixedMealId}@${day}-${slot}`;
}

// Schedule entries are missing unless set, and a missing entry means the person eats that meal.
function eatsByDefault(household: Household, personId: string, day: Day, slot: Slot): boolean {
  return household.schedule[personId]?.[day]?.[slot] !== false;
}

function fitHeadcount(eaters: string[], headcount: number): string[] {
  if (headcount <= eaters.length) return eaters.slice(0, headcount);
  const guests = Array.from({ length: headcount - eaters.length }, (_, i) => `guest-${i + 1}`);
  return [...eaters, ...guests];
}

/**
 * Expand the household's schedule into the cells the planner fills for one week.
 *
 * - Each cell lists who eats it, from the schedule (missing entries default to eating).
 * - An active fixed meal takes its covered people out of the cell and is returned as a placement.
 * - Overrides for the cell, merged in request order:
 *   skipFixed puts covered people back into the cell and drops the fixed meal;
 *   eatingOut drops the cell (fixed placements for it stay);
 *   headcount sets the eater count, adding guest-N ids or truncating the list.
 * - Cells with nobody eating are dropped.
 */
export function expandWeek(household: Household, request: PlanRequest): ExpandedWeek {
  const activeFixed = household.fixedMeals.filter((m) => m.active);
  const cells: SlotCell[] = [];
  const fixed: FixedPlacement[] = [];

  for (const day of DAYS) {
    for (const slot of SLOTS) {
      const override = request.overrides
        .filter((o) => o.day === day && o.slot === slot)
        .reduce<Partial<WeekOverride>>((acc, o) => ({ ...acc, ...o }), {});

      const scheduled = household.people
        .map((p) => p.id)
        .filter((id) => eatsByDefault(household, id, day, slot));

      const taken = new Set<string>();
      if (override.skipFixed !== true) {
        for (const meal of activeFixed) {
          if (meal.slot !== slot || !meal.days.includes(day)) continue;
          const eaters = scheduled.filter((id) => meal.personIds.includes(id) && !taken.has(id));
          if (eaters.length === 0) continue;
          eaters.forEach((id) => taken.add(id));
          fixed.push({ id: placementId(meal.id, day, slot), fixedMealId: meal.id, day, slot, eaters });
        }
      }

      if (override.eatingOut === true) continue;

      let eaters = scheduled.filter((id) => !taken.has(id));
      if (override.headcount !== undefined) eaters = fitHeadcount(eaters, override.headcount);
      // TODO(busy): Household has no busy tags yet, so maxMinutes stays undefined.
      if (eaters.length > 0) cells.push({ day, slot, eaters });
    }
  }

  return { cells, fixed };
}
