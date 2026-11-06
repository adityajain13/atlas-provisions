import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { DAYS, DAY_LONG, SLOTS, type Day, type Slot } from '@provisions/shared';
import { SLOT_LABEL } from '../lib/labels';
import {
  allCells,
  cellKey,
  dayCells,
  moveCell,
  rectCells,
  sameCell,
  slotCells,
  type Cell,
  type GridMove,
} from '../lib/cells';
import { SlotMenu, type SlotMenuCustom, type SlotMenuItem } from './SlotMenu';
import { linkBtn } from './ui';

// The week grid shared by the time caps and who's eating. Rows are meal slots, columns are days. It owns the parts
// every grid needs: a click opens a menu for a cell, a row or a column; drag, Shift and Ctrl/Cmd select several
// cells (on a phone, the Select toggle does); a sticky bar acts on the selection; a bulk change can be undone for a
// few seconds; arrow keys move between cells. What a cell looks like and what its menu offers come from the caller.

export const GRID = 'grid grid-cols-[76px_repeat(7,minmax(0,1fr))] gap-1.5';
export const QUICK = 'h-11 rounded-lg border border-edge px-3 text-[13px] text-paper disabled:opacity-40';
const UNDO_MS = 5000;
const PLURAL: Record<Slot, string> = { breakfast: 'breakfasts', lunch: 'lunches', dinner: 'dinners' };
const MOVES: Record<string, GridMove> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
};

/** What a change did, so the toast can offer to put it back. */
export interface Undo {
  text: string;
  run(): void;
}

/** A menu's contents for the cells it was opened for. `apply` gets the key of the item picked, or the typed number. */
export interface SlotMenuSpec {
  subtitle: string;
  items: SlotMenuItem[];
  custom?: SlotMenuCustom;
  apply(key: string): Undo | null;
}

export interface SlotCellView {
  label: string; // the screen reader name of the cell
  content: ReactNode;
  className: string; // colours and text size; the layout is the grid's
}

export interface SlotHeaderView {
  label: string;
  content: ReactNode;
  className: string;
}

export interface SlotGridHelpers {
  /** Opens a menu for these cells. `title` replaces the title the cells would get on their own. */
  open(cells: Cell[], anchor: HTMLElement, title?: string): void;
  /** Makes a change to these cells. A bulk change (more than one cell) shows its undo line. */
  act(cells: Cell[], run: () => Undo | null): void;
}

export interface SlotGridProps {
  label: string;
  toolbar?: (h: SlotGridHelpers) => ReactNode;
  cellView(cell: Cell): SlotCellView;
  dayHeader(day: Day): SlotHeaderView;
  slotHeader(slot: Slot): SlotHeaderView;
  menu(cells: Cell[]): SlotMenuSpec;
  /** Extra text in the sticky bar, for the current selection. */
  selectionNote?(cells: Cell[]): ReactNode;
  /** The screen reader name of a menu, from its title. */
  menuLabel?(title: string): string;
  /** Called on a click on a cell. Return true when it took the click (and opens its own menu). */
  onCellClick?(cell: Cell, anchor: HTMLElement): boolean;
}

type OpenState = {
  id: number;
  cells: Cell[];
  title: string;
  anchor: HTMLElement;
  fromSelection: boolean;
  desktop: boolean;
};

let menuSeq = 0;

/** The title a menu gets from its cells: the cell itself, all of a day, all of a meal, or how many are selected. */
export function cellsTitle(cells: Cell[]): string {
  if (cells.length === 1) return `${DAY_LONG[cells[0]!.day]} ${SLOT_LABEL[cells[0]!.slot].toLowerCase()}`;
  const days = new Set(cells.map((c) => c.day));
  const slots = new Set(cells.map((c) => c.slot));
  if (days.size === 1 && slots.size === SLOTS.length) return `All of ${DAY_LONG[[...days][0]!]}`;
  if (slots.size === 1 && days.size === DAYS.length) return `All ${PLURAL[[...slots][0]!]}`;
  return `${cells.length} selected`;
}

export function SlotGrid(props: SlotGridProps) {
  const { label, toolbar, cellView, dayHeader, slotHeader, menu, selectionNote, menuLabel = (t: string) => t } = props;
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Cells under a drag rectangle while the mouse is down. Shown as selected, and committed on release.
  const [preview, setPreview] = useState<Set<string> | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [menuState, setMenuState] = useState<OpenState | null>(null);
  const [undo, setUndo] = useState<{ id: number; text: string; run(): void } | null>(null);
  const [focus, setFocus] = useState<Cell>(() => ({ day: DAYS[0], slot: SLOTS[0] }));
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  const lastCell = useRef<Cell | null>(null);
  const drag = useRef<{ anchor: Cell; keys: Set<string> | null } | null>(null);
  // A drag ends on a click event that must not also open a menu.
  const suppressClick = useRef(false);

  // Release anywhere ends a drag. Moving across cells commits the rectangle as the selection.
  useEffect(() => {
    function release() {
      const d = drag.current;
      drag.current = null;
      if (!d?.keys) return;
      setSelected(d.keys);
      lastCell.current = d.anchor;
      setPreview(null);
      suppressClick.current = true;
    }
    window.addEventListener('pointerup', release);
    return () => window.removeEventListener('pointerup', release);
  }, []);

  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), UNDO_MS);
    return () => window.clearTimeout(t);
  }, [undo]);

  function act(cells: Cell[], run: () => Undo | null) {
    if (cells.length === 0) return;
    const u = run();
    // A single cell needs no undo. A bulk change replaces any earlier toast.
    setUndo(u && cells.length > 1 ? { id: Date.now(), text: u.text, run: u.run } : null);
  }

  function undoLast() {
    if (!undo) return;
    undo.run();
    setUndo(null);
  }

  function openMenu(cells: Cell[], anchor: HTMLElement, title?: string, fromSelection = false) {
    setMenuState({
      id: ++menuSeq,
      cells,
      title: title ?? cellsTitle(cells),
      anchor,
      fromSelection,
      desktop: window.matchMedia('(min-width: 1024px)').matches,
    });
  }

  const closeMenu = (returnFocus: boolean) => {
    if (returnFocus && menuState) {
      const first = menuState.fromSelection && menuState.cells[0] ? cellRefs.current.get(cellKey(menuState.cells[0])) : undefined;
      const back = first ?? menuState.anchor;
      if (back.isConnected) back.focus();
    }
    setMenuState(null);
  };

  function pick(key: string) {
    if (!menuState) return;
    const cells = menuState.cells;
    act(cells, () => menu(cells).apply(key));
    if (menuState.fromSelection) setSelected(new Set());
    closeMenu(true);
  }

  function onCellPointerDown(e: PointerEvent<HTMLButtonElement>, cell: Cell) {
    suppressClick.current = false;
    // Touch scrolls the page, so only a mouse or pen drags. Phones use the Select toggle.
    if (e.button !== 0 || (e.pointerType !== 'mouse' && e.pointerType !== 'pen')) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey || selectMode) return;
    drag.current = { anchor: cell, keys: null };
  }

  function onCellEnter(cell: Cell) {
    const d = drag.current;
    if (!d) return;
    if (!d.keys && sameCell(d.anchor, cell)) return;
    d.keys = new Set(rectCells(d.anchor, cell).map(cellKey));
    setPreview(d.keys);
  }

  function handleCellClick(e: MouseEvent<HTMLButtonElement>, cell: Cell) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const key = cellKey(cell);
    if (selectMode || e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      lastCell.current = cell;
      return;
    }
    if (e.shiftKey && lastCell.current) {
      const from = lastCell.current;
      setSelected(new Set(rectCells(from, cell).map(cellKey)));
      return;
    }
    lastCell.current = cell;
    setSelected(new Set());
    if (props.onCellClick?.(cell, e.currentTarget)) return;
    openMenu([cell], e.currentTarget);
  }

  function onGridKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape' && selected.size > 0) {
      e.preventDefault();
      setSelected(new Set());
      return;
    }
    const move = MOVES[e.key];
    const target = e.target as HTMLElement;
    if (!move || !target.dataset.cell) return;
    e.preventDefault();
    const [day, slot] = target.dataset.cell.split('-') as [Day, Slot];
    const next = moveCell({ day, slot }, move);
    setFocus(next);
    cellRefs.current.get(cellKey(next))?.focus();
  }

  const shown = preview ?? selected;
  const selectedCells = allCells().filter((c) => selected.has(cellKey(c)));
  const spec = menuState ? menu(menuState.cells) : null;
  const helpers: SlotGridHelpers = {
    open: (cells, anchor, title) => openMenu(cells, anchor, title),
    act,
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        {toolbar?.(helpers)}
        <button
          type="button"
          aria-pressed={selectMode}
          onClick={() => setSelectMode((v) => !v)}
          className={`${QUICK} ml-auto lg:hidden ${selectMode ? 'border-herb text-herbLight' : ''}`}
        >
          Select
        </button>
      </div>

      <div role="group" aria-label={label} onKeyDown={onGridKey} className={`mt-4 select-none ${GRID}`}>
        <span />
        {DAYS.map((day) => {
          const h = dayHeader(day);
          return (
            <button key={day} type="button" aria-label={h.label} onClick={(e) => openMenu(dayCells(day), e.currentTarget)} className={h.className}>
              {h.content}
            </button>
          );
        })}
        {SLOTS.map((slot) => {
          const h = slotHeader(slot);
          return (
            <Fragment key={slot}>
              <button type="button" aria-label={h.label} onClick={(e) => openMenu(slotCells(slot), e.currentTarget)} className={h.className}>
                {h.content}
              </button>
              {DAYS.map((day) => {
                const cell: Cell = { day, slot };
                const key = cellKey(cell);
                const view = cellView(cell);
                const isSelected = shown.has(key);
                return (
                  <button
                    key={key}
                    ref={(el) => {
                      if (el) cellRefs.current.set(key, el);
                      else cellRefs.current.delete(key);
                    }}
                    type="button"
                    data-cell={key}
                    tabIndex={sameCell(focus, cell) ? 0 : -1}
                    aria-label={view.label}
                    aria-pressed={isSelected}
                    aria-haspopup="menu"
                    onFocus={() => setFocus(cell)}
                    onPointerDown={(e) => onCellPointerDown(e, cell)}
                    onPointerEnter={() => onCellEnter(cell)}
                    onClick={(e) => handleCellClick(e, cell)}
                    className={`flex items-center justify-center rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herbLight ${view.className} ${
                      isSelected ? 'bg-herb/25 ring-2 ring-herb ring-offset-2 ring-offset-ink' : ''
                    }`}
                  >
                    {view.content}
                  </button>
                );
              })}
            </Fragment>
          );
        })}
      </div>

      {selectedCells.length > 0 && (
        <div className="sticky bottom-20 z-[5] mt-3 flex items-center justify-between gap-3 rounded-lg border border-herb/40 bg-field px-4 py-2 lg:static">
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-[14px] text-paper">{selectedCells.length} selected</span>
            {selectionNote?.(selectedCells)}
          </span>
          <span className="flex items-center gap-4">
            <button
              type="button"
              onClick={(e) => openMenu(selectedCells, e.currentTarget, undefined, true)}
              className="text-[14px] text-herb"
            >
              Set to&hellip;
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="text-[14px] text-muted">
              Clear selection
            </button>
          </span>
        </div>
      )}

      {undo && (
        <p role="status" className="mt-3 rounded-lg border border-edge bg-field px-4 py-2 text-[13px] text-paper">
          {undo.text} &middot;{' '}
          <button type="button" onClick={undoLast} className={linkBtn}>
            Undo
          </button>
        </p>
      )}

      {menuState && spec && (
        <SlotMenu
          key={menuState.id}
          title={menuState.title}
          label={menuLabel(menuState.title)}
          subtitle={spec.subtitle}
          items={spec.items}
          custom={spec.custom}
          anchor={menuState.anchor}
          desktop={menuState.desktop}
          onPick={pick}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
