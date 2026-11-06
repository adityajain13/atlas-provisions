// Who's eating, per cell, for the Plan screen: a headcount for each meal (0 is out), or a fixed meal's choice. Pure, so
// the menu rules and the bulk rules are tested without the DOM. Overrides are kept only against the default, so a cell
// set back to its default has no override.
import { cellKey, type Cell } from './cells';

export type FixedChoice = 'keep' | 'plan' | 'out';

export interface AttendanceState {
  overrides: Record<string, number>; // headcount per cell, only where it differs from the default
  choices: Record<string, FixedChoice>; // fixed meals only, only where not kept
}

/** One cell as the menu sees it. A fixed cell has a choice; any other has a headcount against its default. */
export interface AttendanceCell {
  cell: Cell;
  fixed: boolean;
  value: number; // headcount now (0 is out); unused for fixed cells
  def: number; // the household's default headcount
  choice: FixedChoice; // a fixed cell's choice; unused otherwise
}

export interface MenuItemSpec {
  key: string;
  label: string;
  checked?: boolean;
  note?: string;
}

export const MORE_MIN = 4;
export const MORE_MAX = 10;
const PRESETS = [1, 2, 3];

export const CHOICE_LABEL: Record<FixedChoice, string> = { keep: 'Keep fixed', plan: 'Plan instead', out: 'Out' };

/** "Out", "1 person", "3 people". */
export function headcountText(n: number): string {
  if (n === 0) return 'Out';
  return `${n} ${n === 1 ? 'person' : 'people'}`;
}

/** Sets the headcount of each cell. A cell set to its own default loses its override. Returns a new map. */
export function setHeadcounts(overrides: Record<string, number>, cells: AttendanceCell[], value: number): Record<string, number> {
  const next = { ...overrides };
  for (const c of cells) {
    if (c.fixed) continue;
    const key = cellKey(c.cell);
    if (value === c.def) delete next[key];
    else next[key] = value;
  }
  return next;
}

/** Sets the fixed choice of each fixed cell. 'keep' is the default, so it removes the entry. Returns a new map. */
export function setChoices(choices: Record<string, FixedChoice>, cells: AttendanceCell[], choice: FixedChoice): Record<string, FixedChoice> {
  const next = { ...choices };
  for (const c of cells) {
    if (!c.fixed) continue;
    const key = cellKey(c.cell);
    if (choice === 'keep') delete next[key];
    else next[key] = choice;
  }
  return next;
}

/**
 * The bulk rule for a menu key. 'out' takes non-fixed cells to no one and fixed cells to not eating. A number applies to
 * non-fixed cells only. 'keep' and 'plan' apply to fixed cells only.
 */
export function applyKey(state: AttendanceState, cells: AttendanceCell[], key: string): AttendanceState {
  if (key === 'keep' || key === 'plan') return { ...state, choices: setChoices(state.choices, cells, key) };
  if (key === 'out') {
    return { overrides: setHeadcounts(state.overrides, cells, 0), choices: setChoices(state.choices, cells, 'out') };
  }
  return { ...state, overrides: setHeadcounts(state.overrides, cells, Number(key)) };
}

/** The toast line for a bulk change: how many meals it touched and what they were set to. */
export function changeMessage(key: string, cells: AttendanceCell[]): string {
  const fixed = cells.filter((c) => c.fixed).length;
  const plain = cells.length - fixed;
  if (key === 'keep') return `Kept ${fixed} fixed ${fixed === 1 ? 'meal' : 'meals'}`;
  if (key === 'plan') return `Planning ${fixed} ${fixed === 1 ? 'meal' : 'meals'} instead of fixed`;
  if (key === 'out') return `${cells.length} ${cells.length === 1 ? 'meal' : 'meals'} set to out`;
  return `${plain} ${plain === 1 ? 'meal' : 'meals'} set to ${headcountText(Number(key))}`;
}

/**
 * The items of a who's-eating menu for these cells. A mixed selection with fixed meals offers the fixed choices and
 * then the numbers, which apply to the non-fixed cells only. Each number that is the default or the current value
 * (even beyond 3) is listed, so it can be seen and picked; "More…" takes any other count from 4 to 10.
 */
export function attendanceMenu(cells: AttendanceCell[]): {
  subtitle: string;
  items: MenuItemSpec[];
  custom?: boolean;
} {
  const fixedCells = cells.filter((c) => c.fixed);
  const plain = cells.filter((c) => !c.fixed);
  const sameValue = plain.length > 0 && plain.every((c) => c.value === plain[0]!.value) ? plain[0]!.value : undefined;
  const sameDef = plain.length > 0 && plain.every((c) => c.def === plain[0]!.def) ? plain[0]!.def : undefined;

  const items: MenuItemSpec[] = [];
  if (fixedCells.length > 0) {
    const all = (choice: FixedChoice) => fixedCells.every((c) => c.choice === choice);
    items.push({ key: 'keep', label: CHOICE_LABEL.keep, checked: all('keep'), note: '(default)' });
    items.push({ key: 'plan', label: CHOICE_LABEL.plan, checked: all('plan') });
  }
  // "Out" is the same choice for a fixed cell and a plain one, so it is offered once.
  const outChecked =
    (plain.length === 0 || plain.every((c) => c.value === 0)) && (fixedCells.length === 0 || fixedCells.every((c) => c.choice === 'out'));
  if (cells.length > 0) {
    items.push({ key: 'out', label: 'Out', checked: outChecked, note: sameDef === 0 ? '(default)' : undefined });
  }

  let custom = false;
  if (plain.length > 0) {
    const extras = [sameDef, sameValue].filter((n): n is number => n !== undefined && n >= MORE_MIN && n <= MORE_MAX);
    const numbers = [...new Set([...PRESETS, ...extras])].sort((a, b) => a - b);
    for (const n of numbers) {
      items.push({
        key: String(n),
        label: String(n),
        checked: sameValue === n,
        note: sameDef === n ? '(default)' : undefined,
      });
    }
    custom = true;
  }

  let subtitle: string;
  if (cells.length === 1) {
    const c = cells[0]!;
    subtitle = c.fixed
      ? `Now: ${CHOICE_LABEL[c.choice]}`
      : `Now: ${headcountText(c.value)} · default ${headcountText(c.def)}`;
  } else {
    const parts = [`${cells.length} meals`];
    if (fixedCells.length > 0) parts.push(`${fixedCells.length} fixed`);
    parts.push(sameValue === undefined ? 'mixed counts' : `now ${headcountText(sameValue)}`);
    subtitle = parts.join(' · ');
  }
  return { subtitle, items, ...(custom ? { custom: true } : {}) };
}

/** The count typed into "More…": a whole number from 4 to 10. */
export function parseMore(text: string): { ok: true; value: number } | { ok: false; error: string } {
  const trimmed = text.trim();
  const n = Number(trimmed);
  if (trimmed === '' || !Number.isInteger(n) || n < MORE_MIN || n > MORE_MAX) {
    return { ok: false, error: `Enter a number from ${MORE_MIN} to ${MORE_MAX}.` };
  }
  return { ok: true, value: n };
}
