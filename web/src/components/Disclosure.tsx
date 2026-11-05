import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Svg } from './Icons';

type Props = {
  /** `row` is a list item that opens into a card. `compact` is a small inline toggle with an inset panel. */
  variant?: 'row' | 'compact';
  open: boolean;
  onToggle: () => void;
  /** Row: the item's name. Compact: the toggle's label. */
  title: ReactNode;
  /** Row only: second line under the title, truncated. */
  detail?: ReactNode;
  /** Row only: muted text at the right of the header, such as "18 meals a week". */
  summary?: ReactNode;
  /** Row only: a control before the header, outside its button, such as a switch. Clicking it does not toggle. */
  lead?: ReactNode;
  /** Row only: a destructive action on the left of the footer. Done always shows. */
  remove?: { label: string; onClick: () => void };
  /** Focus the first field when this opens. Set for an item that was just added. */
  focusFirstField?: boolean;
  /** Compact only: the header hides and the panel shows at lg. For the phone-only "Add stores" toggle. */
  desktopAlwaysOpen?: boolean;
  children: ReactNode;
};

// Inputs inside a panel sit on the page colour so they read as fields, not as part of the card.
const FIELDS_IN_PANEL = '[&_input:not([type=checkbox])]:bg-ink [&_select]:bg-ink';

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herb';

/**
 * A row or inline toggle that shows and hides its editor. The header is a button with aria-expanded.
 * Closed, it is a plain row with a chevron. Open, the row and its content form one card.
 * The parent owns `open`, so a list can keep only one row open at a time.
 */
export function Disclosure({
  variant = 'row',
  open,
  onToggle,
  title,
  detail,
  summary,
  lead,
  remove,
  focusFirstField = false,
  desktopAlwaysOpen = false,
  children,
}: Props) {
  const id = useId();
  const headerId = `${id}-header`;
  const panelId = `${id}-panel`;
  const headerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const compact = variant === 'compact';

  useEffect(() => {
    if (open && focusFirstField) panelRef.current?.querySelector<HTMLElement>('input, select, textarea')?.focus();
  }, [open, focusFirstField]);

  // Done collapses the row and returns focus to its header, since the button it was on is about to be inert.
  function done() {
    onToggle();
    headerRef.current?.focus();
  }

  const chevron = (
    <span
      className={`flex shrink-0 text-muted transition-transform duration-200 ease-out motion-reduce:transition-none ${
        open ? 'rotate-180' : ''
      }`}
    >
      <Svg size={16}>
        <path d="M6 9l6 6 6-6" />
      </Svg>
    </span>
  );

  const header = compact ? (
    <button
      ref={headerRef}
      id={headerId}
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onToggle}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-md text-left text-[14px] text-herb ${FOCUS_RING} ${
        desktopAlwaysOpen ? 'lg:hidden' : ''
      }`}
    >
      {title}
      {chevron}
    </button>
  ) : (
    <button
      ref={headerRef}
      id={headerId}
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onToggle}
      className={`flex items-center gap-3 text-left transition-colors hover:bg-chip/40 ${FOCUS_RING} ${
        lead ? 'min-h-12 min-w-0 flex-1 py-1 pl-1 pr-3' : 'min-h-[52px] w-full px-3'
      } ${open ? 'rounded-t-xl' : 'rounded-lg'}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] text-paper">{title}</span>
        {detail && <span className="block truncate text-[13px] text-muted">{detail}</span>}
      </span>
      {summary && <span className="shrink-0 text-[13px] text-muted">{summary}</span>}
      {chevron}
    </button>
  );

  const body = compact ? (
    <div className={`mt-2 rounded-lg border border-line2 bg-field/60 p-3 ${FIELDS_IN_PANEL}`}>{children}</div>
  ) : (
    <>
      <div className={`space-y-5 border-t border-line2 p-4 lg:p-5 ${FIELDS_IN_PANEL}`}>{children}</div>
      <div className="flex items-center justify-between gap-3 border-t border-line2 px-4 py-3 lg:px-5">
        {remove ? (
          <button
            type="button"
            onClick={remove.onClick}
            className="min-h-11 text-[14px] text-[#D98C7A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herb"
          >
            {remove.label}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={done}
          className={`inline-flex h-11 items-center justify-center rounded-lg border border-herb px-5 text-[14px] font-medium text-herbLight ${FOCUS_RING}`}
        >
          Done
        </button>
      </div>
    </>
  );

  // Closed content stays mounted so the height can animate, but it is inert so Tab skips it.
  // A desktop-always-open panel is hidden by display on phones instead, which already removes it from Tab order.
  const inertWhenClosed = !open && !desktopAlwaysOpen;
  const outer = desktopAlwaysOpen
    ? open
      ? ''
      : 'hidden lg:block'
    : `grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`;

  const rootCls = compact
    ? ''
    : open
      ? 'my-2 rounded-xl border border-edge bg-field'
      : 'border-b border-line2';

  return (
    <div className={rootCls}>
      {lead ? (
        <div className="flex items-center pl-2">
          {lead}
          {header}
        </div>
      ) : (
        header
      )}
      <div className={outer} {...(inertWhenClosed ? { inert: '' } : {})}>
        <div
          ref={panelRef}
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className={desktopAlwaysOpen ? '' : 'min-h-0 overflow-hidden'}
        >
          {body}
        </div>
      </div>
    </div>
  );
}
