import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { DAYS, DAY_LONG, SLOTS, type Day, type Household, type Slot } from '@provisions/shared';
import { DAY_SHORT, SLOT_LABEL } from '../lib/labels';
import {
  CAP_MAX,
  CAP_MIN,
  CAP_STEP,
  allCells,
  applyCaps,
  bulkMessage,
  capAt,
  capCount,
  capOptions,
  cellKey,
  commonCap,
  dayCells,
  formatTimeCap,
  moveCell,
  parseCustomCap,
  rectCells,
  sameCell,
  slotCells,
  snapshotCaps,
  spokenCap,
  weekendCells,
  weeknightDinnerCells,
  type CapChange,
  type Caps,
  type Cell,
  type GridMove,
} from '../lib/timeCaps';
import { useConfirm } from './ConfirmDialog';
import { addBtn, eyebrow, fieldCls, linkBtn } from './ui';

type Update = (fn: (prev: Household) => Household) => void;

const UNDO_MS = 5000;
const PLURAL: Record<Slot, string> = { breakfast: 'breakfasts', lunch: 'lunches', dinner: 'dinners' };
const GRID = 'grid grid-cols-[76px_repeat(7,minmax(0,1fr))] gap-1.5';
const QUICK = 'h-11 rounded-lg border border-edge px-3 text-[13px] text-paper disabled:opacity-40';
const MOVES: Record<string, GridMove> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
};

type Menu = {
  id: number;
  title: string;
  cells: Cell[];
  /** Element that gets focus back when the menu closes. */
  anchor: HTMLElement;
  /** Opened from the selection bar: applying clears the selection. */
  fromSelection: boolean;
  desktop: boolean;
};

let menuSeq = 0;

/**
 * The Time caps grid. Each cell holds a cap (none, or minutes). A cell click opens a menu for that cell. Row and day
 * labels open the menu for every cell in that row or column. Dragging, Shift and Ctrl/Cmd select several cells; on a
 * phone the Select toggle does the same with taps. Bulk changes can be undone for a few seconds. Every change goes
 * through the household's autosave.
 */
export function TimeCapGrid({ h, update }: { h: Household; update: Update }) {
  const confirm = useConfirm();
  const caps = h.timeCaps;
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Cells under a drag rectangle while the mouse is down. Shown as selected, and committed on release.
  const [preview, setPreview] = useState<Set<string> | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [undo, setUndo] = useState<{ id: number; text: string; restore: CapChange[] } | null>(null);
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

  function applyCells(cells: Cell[], minutes: number | undefined) {
    if (cells.length === 0) return;
    const restore = snapshotCaps(h, cells);
    update((prev) => applyCaps(prev, cells.map((c) => ({ ...c, minutes }))));
    // A single cell needs no undo. A bulk change replaces any earlier toast.
    setUndo(cells.length > 1 ? { id: Date.now(), text: bulkMessage(cells.length, minutes), restore } : null);
  }

  function undoLast() {
    if (!undo) return;
    const restore = undo.restore;
    update((prev) => applyCaps(prev, restore));
    setUndo(null);
  }

  function openMenu(cells: Cell[], title: string, anchor: HTMLElement, fromSelection = false) {
    setMenu({
      id: ++menuSeq,
      title,
      cells,
      anchor,
      fromSelection,
      desktop: window.matchMedia('(min-width: 1024px)').matches,
    });
  }

  function closeMenu(returnFocus: boolean) {
    if (returnFocus) {
      const first = menu?.fromSelection && menu.cells[0] ? cellRefs.current.get(cellKey(menu.cells[0])) : undefined;
      const back = first ?? menu?.anchor;
      if (back?.isConnected) back.focus();
    }
    setMenu(null);
  }

  function pick(minutes: number | undefined) {
    if (!menu) return;
    applyCells(menu.cells, minutes);
    if (menu.fromSelection) setSelected(new Set());
    closeMenu(true);
  }

  async function clearAll() {
    const ok = await confirm({
      title: 'Clear all time caps?',
      message: 'Every meal goes back to no cap. You can undo for a few seconds after.',
      confirmLabel: 'Clear all',
      danger: true,
    });
    if (ok) applyCells(allCells(), undefined);
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

  function onCellClick(e: MouseEvent<HTMLButtonElement>, cell: Cell) {
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
    openMenu([cell], `${DAY_LONG[cell.day]} ${SLOT_LABEL[cell.slot].toLowerCase()}`, e.currentTarget);
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
  const total = capCount(caps);

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={QUICK}
          onClick={(e) => openMenu(weeknightDinnerCells(), 'Weeknight dinners', e.currentTarget)}
        >
          Weeknight dinners&hellip;
        </button>
        <button
          type="button"
          className={QUICK}
          onClick={(e) => openMenu(weekendCells(), 'Weekends', e.currentTarget)}
        >
          Weekends&hellip;
        </button>
        <button type="button" className={QUICK} disabled={total === 0} onClick={() => void clearAll()}>
          Clear all
        </button>
        <button
          type="button"
          aria-pressed={selectMode}
          onClick={() => setSelectMode((v) => !v)}
          className={`${QUICK} ml-auto lg:hidden ${selectMode ? 'border-herb text-herbLight' : ''}`}
        >
          Select
        </button>
      </div>

      <div
        role="group"
        aria-label="Time caps by day and meal"
        onKeyDown={onGridKey}
        className={`mt-4 select-none ${GRID}`}
      >
        <span />
        {DAYS.map((day) => (
          <button
            key={day}
            type="button"
            aria-label={`Set all of ${DAY_LONG[day]}`}
            onClick={(e) => openMenu(dayCells(day), `All of ${DAY_LONG[day]}`, e.currentTarget)}
            className="h-9 rounded text-center text-[11px] text-muted hover:text-paper"
          >
            {DAY_SHORT[day]}
          </button>
        ))}
        {SLOTS.map((slot) => (
          <Fragment key={slot}>
            <button
              type="button"
              aria-label={`Set all ${PLURAL[slot]}`}
              onClick={(e) => openMenu(slotCells(slot), `All ${PLURAL[slot]}`, e.currentTarget)}
              className="flex items-center rounded text-left text-[12px] text-muted hover:text-paper"
            >
              {SLOT_LABEL[slot]}
            </button>
            {DAYS.map((day) => {
              const cell: Cell = { day, slot };
              const key = cellKey(cell);
              const minutes = capAt(caps, cell);
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
                  aria-label={`${DAY_LONG[day]} ${SLOT_LABEL[slot].toLowerCase()}, ${spokenCap(minutes)}`}
                  aria-pressed={isSelected}
                  onFocus={() => setFocus(cell)}
                  onPointerDown={(e) => onCellPointerDown(e, cell)}
                  onPointerEnter={() => onCellEnter(cell)}
                  onClick={(e) => onCellClick(e, cell)}
                  className={`flex h-11 items-center justify-center rounded-md border text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herbLight ${
                    minutes === undefined ? 'border-edge text-muted' : 'border-herb text-herbLight'
                  } ${isSelected ? 'bg-herb/25 ring-2 ring-herb ring-offset-2 ring-offset-ink' : ''}`}
                >
                  {minutes === undefined ? '—' : formatTimeCap(minutes, 'compact')}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>

      {selectedCells.length > 0 && (
        <div className="sticky bottom-20 z-[5] mt-3 flex items-center justify-between gap-3 rounded-lg border border-herb/40 bg-field px-4 py-2 lg:static">
          <span className="text-[14px] text-paper">{selectedCells.length} selected</span>
          <span className="flex items-center gap-4">
            <button
              type="button"
              onClick={(e) => openMenu(selectedCells, `${selectedCells.length} selected`, e.currentTarget, true)}
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

      {menu && (
        <CapMenu
          key={menu.id}
          menu={menu}
          caps={caps}
          onPick={pick}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}

/**
 * The cap picker for one or more cells. A popover beside the cell on a desktop, a bottom sheet on a phone. Arrow keys
 * move through the options, Enter picks, Escape closes and returns focus to where it came from.
 */
function CapMenu({
  menu,
  caps,
  onPick,
  onClose,
}: {
  menu: Menu;
  caps: Caps;
  onPick: (minutes: number | undefined) => void;
  onClose: (returnFocus: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const customRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  const common = commonCap(caps, menu.cells);
  const current = common.mixed ? undefined : common.minutes;
  const subtitle = common.mixed
    ? 'Mixed caps'
    : current === undefined
      ? 'Currently no cap'
      : `Currently ${formatTimeCap(current)}`;

  // Desktop: beside the cell. Below it when it fits, else above, else pinned to the screen with its own scroll.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!menu.desktop || !el) return;
    const a = menu.anchor.getBoundingClientRect();
    const m = el.getBoundingClientRect();
    const margin = 16;
    const below = a.bottom + 8;
    const above = a.top - 8 - m.height;
    let top = below;
    if (below + m.height > window.innerHeight - margin) top = above >= margin ? above : margin;
    top = Math.max(margin, Math.min(top, window.innerHeight - margin - m.height));
    const left = Math.min(Math.max(margin, a.left), window.innerWidth - m.width - margin);
    setPos({ top, left });
  }, [menu, customOpen]);

  useEffect(() => {
    const el = ref.current;
    const target =
      el?.querySelector<HTMLElement>('[aria-checked="true"]') ?? el?.querySelector<HTMLElement>('[data-cap-item]');
    target?.focus({ preventScroll: true });
  }, [menu]);

  useEffect(() => {
    if (customOpen) customRef.current?.focus();
  }, [customOpen]);

  // A press outside the menu and its anchor closes it without moving focus.
  useEffect(() => {
    function down(e: globalThis.PointerEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menu.anchor.contains(t)) return;
      onClose(false);
    }
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [menu, onClose]);

  // The desktop popover follows its cell, so scrolling or resizing closes it.
  useEffect(() => {
    if (!menu.desktop) return;
    const close = () => onClose(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu.desktop, onClose]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
      return;
    }
    if (e.key === 'Tab') {
      onClose(false);
      return;
    }
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-cap-item]') ?? []);
    const i = items.indexOf(e.target as HTMLElement);
    if (i < 0) return;
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      items[next]!.focus();
    }
  }

  function submitCustom(e: FormEvent) {
    e.preventDefault();
    const result = parseCustomCap(customText);
    if (!result.ok) {
      setCustomError(result.error);
      return;
    }
    onPick(result.minutes);
  }

  const phone = !menu.desktop;
  const panel = phone
    ? 'fixed inset-x-0 bottom-0 z-30 max-h-[85vh] overflow-y-auto rounded-t-2xl border border-b-0 border-edge bg-field pb-[env(safe-area-inset-bottom)]'
    : 'fixed z-30 max-h-[calc(100vh-32px)] w-72 overflow-y-auto rounded-xl border border-edge bg-field shadow-lg';

  return (
    <>
      {phone && <div aria-hidden="true" className="fixed inset-0 z-20 bg-black/60" />}
      <div
        ref={ref}
        role="dialog"
        aria-label={`Time cap for ${menu.title}`}
        onKeyDown={onKeyDown}
        className={panel}
        style={phone ? undefined : (pos ?? { top: 0, left: 0 })}
      >
        {phone && <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-edge" />}
        <div className="px-4 pb-2 pt-3">
          <p className="text-[15px] font-medium text-paper">{menu.title}</p>
          <p className="text-[12px] text-muted">{subtitle}</p>
        </div>
        <div role="menu" aria-label="Time cap" className="pb-2">
          {capOptions(current).map((value) => {
            const on = !common.mixed && value === common.minutes;
            return (
              <button
                key={value ?? 'none'}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                data-cap-item
                onClick={() => onPick(value)}
                className={`flex h-11 w-full items-center justify-between px-4 text-left text-[15px] hover:bg-chip/50 focus-visible:bg-chip/60 focus-visible:outline-none ${
                  on ? 'text-herbLight' : 'text-paper'
                }`}
              >
                <span>{value === undefined ? 'No cap' : formatTimeCap(value)}</span>
                {on && (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
          <button
            type="button"
            role="menuitem"
            data-cap-item
            aria-expanded={customOpen}
            aria-controls="cap-custom-form"
            onClick={() => setCustomOpen((v) => !v)}
            className="flex h-11 w-full items-center px-4 text-left text-[15px] text-paper hover:bg-chip/50 focus-visible:bg-chip/60 focus-visible:outline-none"
          >
            Custom&hellip;
          </button>
        </div>
        {customOpen && (
          <form
            id="cap-custom-form"
            noValidate
            onSubmit={submitCustom}
            className="border-t border-line2 px-4 pb-4 pt-3"
          >
            <label className="block">
              <span className={eyebrow}>Minutes ({CAP_MIN} to {CAP_MAX}, step {CAP_STEP})</span>
              <span className="mt-2 flex gap-2">
                <input
                  ref={customRef}
                  type="number"
                  inputMode="numeric"
                  min={CAP_MIN}
                  max={CAP_MAX}
                  step={CAP_STEP}
                  aria-invalid={customError !== null}
                  className={`${fieldCls} w-28`}
                  value={customText}
                  onChange={(e) => {
                    setCustomText(e.target.value);
                    setCustomError(null);
                  }}
                />
                <button type="submit" className={addBtn}>
                  Apply
                </button>
              </span>
            </label>
            {customError && (
              <p role="alert" className="mt-2 text-[12px] text-[#D98C7A]">
                {customError}
              </p>
            )}
          </form>
        )}
      </div>
    </>
  );
}
