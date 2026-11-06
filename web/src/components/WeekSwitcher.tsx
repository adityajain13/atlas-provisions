import { addWeeks, weekRangeLabel } from '@provisions/shared';
import { weekCaption, weekOffset } from '../lib/week';

type Props = {
  weekOf: string;
  current: string;
  /** The first and last weeks the screen lets the reader reach. */
  first: string;
  last: string;
  onChange: (weekOf: string) => void;
};

const NAV =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-edge text-[18px] leading-none text-paper outline-none hover:border-muted focus-visible:ring-2 focus-visible:ring-herb disabled:opacity-30 disabled:hover:border-edge';

/** Steps through plan weeks: a previous and next arrow around the week's range, and a way back to this week. */
export default function WeekSwitcher({ weekOf, current, first, last, onChange }: Props) {
  const before = addWeeks(weekOf, -1);
  const after = addWeeks(weekOf, 1);
  const n = weekOffset(weekOf, current);

  return (
    // Centred on phones, where "This week" wraps onto a line of its own; left-aligned from sm up as before.
    <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
      <button type="button" aria-label="Previous week" disabled={before < first} onClick={() => onChange(before)} className={NAV}>
        &lsaquo;
      </button>
      <div className="min-w-[11.5rem] px-1 text-center" aria-live="polite">
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted">{weekCaption(weekOf, current)}</p>
        <p className="mt-0.5 text-[14px] text-paper tabular-nums">{weekRangeLabel(weekOf, current)}</p>
      </div>
      <button type="button" aria-label="Next week" disabled={after > last} onClick={() => onChange(after)} className={NAV}>
        &rsaquo;
      </button>
      {n !== 0 && (
        <button
          type="button"
          onClick={() => onChange(current)}
          className="flex min-h-11 sm:ml-1 items-center rounded-md px-2 text-[13px] text-herb outline-none hover:text-herbLight focus-visible:ring-2 focus-visible:ring-herb"
        >
          This week
        </button>
      )}
    </div>
  );
}
