import { DAYS, SLOTS, type Day, type Slot } from '@provisions/shared';

// Cells of the week grid (one meal slot on one day). Shared by every grid: the time caps and who's eating.
// Pure, so the grid rules are tested without the DOM.

export type Cell = { day: Day; slot: Slot };

export const cellKey = (c: Cell): string => `${c.day}-${c.slot}`;

export function sameCell(a: Cell, b: Cell): boolean {
  return a.day === b.day && a.slot === b.slot;
}

export function allCells(): Cell[] {
  return DAYS.flatMap((day) => SLOTS.map((slot) => ({ day, slot })));
}

/** One meal slot across the week, e.g. every dinner. */
export function slotCells(slot: Slot): Cell[] {
  return DAYS.map((day) => ({ day, slot }));
}

/** The three meals of one day. */
export function dayCells(day: Day): Cell[] {
  return SLOTS.map((slot) => ({ day, slot }));
}

/** Every cell inside the rectangle between two corners, both included. */
export function rectCells(a: Cell, b: Cell): Cell[] {
  const d0 = DAYS.indexOf(a.day);
  const d1 = DAYS.indexOf(b.day);
  const s0 = SLOTS.indexOf(a.slot);
  const s1 = SLOTS.indexOf(b.slot);
  const out: Cell[] = [];
  for (let d = Math.min(d0, d1); d <= Math.max(d0, d1); d++) {
    for (let s = Math.min(s0, s1); s <= Math.max(s0, s1); s++) {
      out.push({ day: DAYS[d]!, slot: SLOTS[s]! });
    }
  }
  return out;
}

export type GridMove = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';

/** The cell a key press moves focus to. Stops at the edges of the grid. */
export function moveCell(c: Cell, move: GridMove): Cell {
  let d = DAYS.indexOf(c.day);
  let s = SLOTS.indexOf(c.slot);
  if (move === 'left') d -= 1;
  if (move === 'right') d += 1;
  if (move === 'up') s -= 1;
  if (move === 'down') s += 1;
  if (move === 'home') d = 0;
  if (move === 'end') d = DAYS.length - 1;
  d = Math.min(Math.max(d, 0), DAYS.length - 1);
  s = Math.min(Math.max(s, 0), SLOTS.length - 1);
  return { day: DAYS[d]!, slot: SLOTS[s]! };
}

