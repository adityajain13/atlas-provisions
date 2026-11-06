import { DAY_LONG, type Day, type Household, type Slot } from '@provisions/shared';
import { DAY_SHORT, SLOT_LABEL } from '../lib/labels';
import {
  CAP_MAX,
  CAP_MIN,
  CAP_STEP,
  applyCaps,
  bulkMessage,
  capAt,
  capCount,
  capOptions,
  commonCap,
  formatTimeCap,
  parseCustomCap,
  snapshotCaps,
  spokenCap,
} from '../lib/timeCaps';
import { allCells, type Cell } from '../lib/cells';
import { useConfirm } from './ConfirmDialog';
import { QUICK, SlotGrid, type Undo } from './SlotGrid';

type Update = (fn: (prev: Household) => Household) => void;

const PLURAL: Record<Slot, string> = { breakfast: 'breakfasts', lunch: 'lunches', dinner: 'dinners' };

/**
 * The Time caps grid. Each cell holds a cap (none, or minutes). A cell click opens a menu for that cell. Row and day
 * labels open the menu for every cell in that row or column. Dragging, Shift and Ctrl/Cmd select several cells; on a
 * phone the Select toggle does the same with taps. Bulk changes can be undone for a few seconds. Every change goes
 * through the household's autosave. The grid itself is SlotGrid; this file says what a cap is.
 */
export function TimeCapGrid({ h, update }: { h: Household; update: Update }) {
  const confirm = useConfirm();
  const caps = h.timeCaps;
  const total = capCount(caps);

  // Sets the cells to minutes (undefined: no cap). Returns the change with the way back.
  function applyCells(cells: Cell[], minutes: number | undefined): Undo {
    const restore = snapshotCaps(h, cells);
    update((prev) => applyCaps(prev, cells.map((c) => ({ ...c, minutes }))));
    return { text: bulkMessage(cells.length, minutes), run: () => update((prev) => applyCaps(prev, restore)) };
  }

  async function clearAll(act: (cells: Cell[], run: () => Undo | null) => void) {
    const ok = await confirm({
      title: 'Clear all time caps?',
      message: 'Every meal goes back to no cap. You can undo for a few seconds after.',
      confirmLabel: 'Clear all',
      danger: true,
    });
    if (ok) act(allCells(), () => applyCells(allCells(), undefined));
  }

  return (
    <SlotGrid
      label="Time caps by day and meal"
      menuLabel={(title) => `Time cap for ${title}`}
      toolbar={({ act }) => (
        <>
          <button type="button" className={QUICK} disabled={total === 0} onClick={() => void clearAll(act)}>
            Clear all
          </button>
        </>
      )}
      cellView={(cell) => {
        const minutes = capAt(caps, cell);
        return {
          label: `${DAY_LONG[cell.day]} ${SLOT_LABEL[cell.slot].toLowerCase()}, ${spokenCap(minutes)}`,
          content: minutes === undefined ? '—' : formatTimeCap(minutes, 'compact'),
          className: `h-11 text-[12px] ${minutes === undefined ? 'border-edge text-muted' : 'border-herb text-herbLight'}`,
        };
      }}
      dayHeader={(day: Day) => ({
        label: `Set all of ${DAY_LONG[day]}`,
        content: DAY_SHORT[day],
        className: 'h-9 rounded text-center text-[11px] text-muted hover:text-paper',
      })}
      slotHeader={(slot: Slot) => ({
        label: `Set all ${PLURAL[slot]}`,
        content: SLOT_LABEL[slot],
        className: 'flex items-center rounded text-left text-[12px] text-muted hover:text-paper',
      })}
      menu={(cells) => {
        const common = commonCap(caps, cells);
        const current = common.mixed ? undefined : common.minutes;
        return {
          subtitle: common.mixed ? 'Mixed caps' : current === undefined ? 'Currently no cap' : `Currently ${formatTimeCap(current)}`,
          items: capOptions(current).map((v) => ({
            key: v === undefined ? 'none' : String(v),
            label: v === undefined ? 'No cap' : formatTimeCap(v),
            checked: !common.mixed && v === common.minutes,
          })),
          custom: {
            label: 'Custom…',
            hint: `Minutes (${CAP_MIN} to ${CAP_MAX}, step ${CAP_STEP})`,
            min: CAP_MIN,
            max: CAP_MAX,
            step: CAP_STEP,
            parse: (text) => {
              const r = parseCustomCap(text);
              return r.ok ? { ok: true, value: r.minutes } : r;
            },
          },
          apply: (key) => applyCells(cells, key === 'none' ? undefined : Number(key)),
        };
      }}
    />
  );
}

