import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

/** What a fixed meal does in one week: served as set, replaced by a plan, or the eater is out. */
export type FixedChoice = 'keep' | 'plan' | 'out';

const OPTIONS: { value: FixedChoice; label: string }[] = [
  { value: 'keep', label: 'Keep fixed meal' },
  { value: 'plan', label: 'Plan something instead' },
  { value: 'out', label: 'Not eating / eating out' },
];

/**
 * The menu for one fixed cell in the Plan grid. A popover beside the cell on a desktop, a bottom sheet
 * on a phone. Arrow keys move through the options, Enter picks, Escape closes and returns focus to the cell.
 * Follows the Time caps menu in TimeCapGrid.
 */
export function FixedMealMenu({
  title,
  anchor,
  desktop,
  value,
  onPick,
  onClose,
}: {
  title: string;
  anchor: HTMLElement;
  desktop: boolean;
  value: FixedChoice;
  onPick: (value: FixedChoice) => void;
  onClose: (returnFocus: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Desktop: beside the cell. Below it when it fits, else above, else pinned to the screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!desktop || !el) return;
    const a = anchor.getBoundingClientRect();
    const m = el.getBoundingClientRect();
    const margin = 16;
    const below = a.bottom + 8;
    const above = a.top - 8 - m.height;
    let top = below;
    if (below + m.height > window.innerHeight - margin) top = above >= margin ? above : margin;
    top = Math.max(margin, Math.min(top, window.innerHeight - margin - m.height));
    const left = Math.min(Math.max(margin, a.left), window.innerWidth - m.width - margin);
    setPos({ top, left });
  }, [anchor, desktop]);

  // Focus starts on the current choice.
  useEffect(() => {
    const list = ref.current;
    const current = list?.querySelector<HTMLElement>('[aria-checked="true"]');
    current?.focus({ preventScroll: true });
  }, []);

  // A press outside the menu and its anchor closes it without moving focus.
  useEffect(() => {
    function down(e: globalThis.PointerEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose(false);
    }
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [anchor, onClose]);

  // The desktop popover follows its cell, so scrolling the page or resizing closes it.
  useEffect(() => {
    if (!desktop) return;
    const close = (e: Event) => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return;
      onClose(false);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [desktop, onClose]);

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
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-fixed-item]') ?? []);
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

  const panel = desktop
    ? 'fixed z-30 w-72 rounded-xl border border-edge bg-field shadow-lg'
    : 'fixed inset-x-0 bottom-0 z-30 rounded-t-2xl border border-b-0 border-edge bg-field pb-[env(safe-area-inset-bottom)]';
  const rowH = desktop ? 'h-10' : 'h-11';

  return (
    <>
      {!desktop && <div aria-hidden="true" className="fixed inset-0 z-20 bg-black/60" />}
      <div
        ref={ref}
        role="dialog"
        aria-label={`Fixed meal for ${title}`}
        onKeyDown={onKeyDown}
        className={panel}
        style={desktop ? (pos ?? { top: 0, left: 0 }) : undefined}
      >
        {!desktop && <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-edge" />}
        <div className="px-4 pb-2 pt-3">
          <p className="text-[15px] font-medium text-paper">{title}</p>
        </div>
        <div role="menu" aria-label="Fixed meal this week" className="pb-1">
          {OPTIONS.map((o) => {
            const on = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                data-fixed-item
                onClick={() => onPick(o.value)}
                className={`flex ${rowH} w-full items-center justify-between px-4 text-left text-[15px] hover:bg-chip/50 focus-visible:bg-chip/60 focus-visible:outline-none ${
                  on ? 'text-herbLight' : 'text-paper'
                }`}
              >
                <span>{o.label}</span>
                {on && (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
