import { type Day, type Household, type Slot } from '@provisions/shared';
import { allCells, cellKey, dayCells, moveCell, rectCells, sameCell, slotCells, weekendCells, weeknightDinnerCells, type Cell } from './cells';

export { allCells, cellKey, dayCells, moveCell, rectCells, sameCell, slotCells, weekendCells, weeknightDinnerCells, type Cell, type GridMove } from './cells';

// Busy-night time caps: helpers for the Household grid and the Plan labels. Pure, so they are tested without the DOM.

export type Caps = Household['timeCaps'];
export type CapChange = Cell & { minutes: number | undefined };

/** Quick choices in the cap menu, in minutes. Custom values (5 to 180, step 5) are typed in. */
export const CAP_PRESETS: readonly number[] = [5, 10, 15, 20, 30, 45, 60, 90, 120];
export const CAP_MIN = 5;
export const CAP_MAX = 180;
export const CAP_STEP = 5;

/** "15 min", "1 h", "1½ h", "2 h", "1 h 15". The compact style fits a grid cell: "15m", "1h", "1½h", "1h15". */
export function formatTimeCap(minutes: number, style: 'long' | 'compact' = 'long'): string {
  const compact = style === 'compact';
  if (minutes < 60) return compact ? `${minutes}m` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (minutes === 90) return compact ? '1½h' : '1½ h';
  if (rest === 0) return compact ? `${hours}h` : `${hours} h`;
  return compact ? `${hours}h${rest}` : `${hours} h ${rest}`;
}

/** The words a screen reader gets for a cell: "30 minute cap", or "no cap". */
export function spokenCap(minutes: number | undefined): string {
  return minutes === undefined ? 'no cap' : `${minutes} minute cap`;
}

/** The menu's choices: no cap, then the presets in order. A custom value already set is added in its place. */
export function capOptions(current: number | undefined): (number | undefined)[] {
  const values = [...CAP_PRESETS];
  if (current !== undefined && !values.includes(current)) values.push(current);
  values.sort((a, b) => a - b);
  return [undefined, ...values];
}

/** Reads the custom minutes box. Only whole multiples of 5 from 5 to 180 are kept. */
export function parseCustomCap(text: string): { ok: true; minutes: number } | { ok: false; error: string } {
  const trimmed = text.trim();
  const n = Number(trimmed);
  if (trimmed === '' || !Number.isInteger(n) || n < CAP_MIN || n > CAP_MAX) {
    return { ok: false, error: `Enter minutes from ${CAP_MIN} to ${CAP_MAX}.` };
  }
  if (n % CAP_STEP !== 0) return { ok: false, error: `Use a multiple of ${CAP_STEP}.` };
  return { ok: true, minutes: n };
}

export function capAt(caps: Caps, c: Cell): number | undefined {
  return caps[c.day]?.[c.slot];
}

/** The cap all these cells share, or mixed when they differ. */
export function commonCap(
  caps: Caps,
  cells: Cell[],
): { mixed: false; minutes: number | undefined } | { mixed: true } {
  const first = cells[0] ? capAt(caps, cells[0]) : undefined;
  return cells.every((c) => capAt(caps, c) === first) ? { mixed: false, minutes: first } : { mixed: true };
}

/** How many meal slots have a cap. */
export function capCount(caps: Caps): number {
  return Object.values(caps).reduce((sum, day) => sum + Object.keys(day).length, 0);
}

/**
 * Sets each cell to its minutes, or clears it when minutes is undefined. A day left with no caps is dropped, so the
 * stored document stays as small as before. Returns a new household; the input is not changed.
 */
export function applyCaps(h: Household, changes: CapChange[]): Household {
  const timeCaps: Caps = {};
  for (const [day, slots] of Object.entries(h.timeCaps)) timeCaps[day] = { ...slots };
  for (const { day, slot, minutes } of changes) {
    const dayCaps = { ...(timeCaps[day] ?? {}) };
    if (minutes === undefined) delete dayCaps[slot];
    else dayCaps[slot] = minutes;
    if (Object.keys(dayCaps).length === 0) delete timeCaps[day];
    else timeCaps[day] = dayCaps;
  }
  return { ...h, timeCaps };
}

/** What each cell holds now, so an undo can put it back. */
export function snapshotCaps(h: Household, cells: Cell[]): CapChange[] {
  return cells.map((c) => ({ day: c.day, slot: c.slot, minutes: capAt(h.timeCaps, c) }));
}

/** The toast line for a bulk change, without the Undo part: "Set 7 cells to 30 min". */
export function bulkMessage(count: number, minutes: number | undefined): string {
  const cells = `${count} ${count === 1 ? 'cell' : 'cells'}`;
  return minutes === undefined ? `Cleared ${cells}` : `Set ${cells} to ${formatTimeCap(minutes)}`;
}

/** True when a scrolling list has rows below the visible part, so the menu shows its bottom fade. */
export function hasMoreBelow(scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  return scrollHeight - (scrollTop + clientHeight) > 2;
}
