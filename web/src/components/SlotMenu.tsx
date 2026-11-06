import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { addBtn, eyebrow, fieldCls } from './ui';
import { hasMoreBelow } from '../lib/timeCaps';

export interface SlotMenuItem {
  key: string;
  label: string;
  checked?: boolean;
  note?: string; // e.g. "(default)", shown beside the label
}

/** A last row that takes a typed number. Its value is passed to onPick as a string. */
export interface SlotMenuCustom {
  label: string; // "Custom…", "More…"
  hint: string; // what the box takes, e.g. "Minutes (5 to 180, step 5)"
  min: number;
  max: number;
  step: number;
  parse(text: string): { ok: true; value: number } | { ok: false; error: string };
}

export interface SlotMenuProps {
  title: string;
  /** The name a screen reader gets for the menu, e.g. "Time cap for Tuesday dinner". */
  label: string;
  subtitle: string;
  items: SlotMenuItem[];
  custom?: SlotMenuCustom;
  anchor: HTMLElement;
  desktop: boolean;
  onPick(key: string): void;
  onClose(returnFocus: boolean): void;
}

/**
 * A menu for one or more grid cells: a popover beside the cell on a desktop, a bottom sheet on a phone. Arrow keys
 * move through the options, Enter picks, Escape closes and returns focus to where it came from. Mounted fresh for
 * each opening (the caller keys it), so it opens with the current value focused.
 */
export function SlotMenu({ title, label, subtitle, items, custom, anchor, desktop, onPick, onClose }: SlotMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const customRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  // Rows below the visible part of the list: shows the bottom fade.
  const [more, setMore] = useState(false);

  // Desktop: beside the cell. Below it when it fits, else above, else pinned to the screen with its own scroll.
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
  }, [desktop, anchor, customOpen]);

  function syncMore() {
    const el = listRef.current;
    setMore(el ? hasMoreBelow(el.scrollTop, el.clientHeight, el.scrollHeight) : false);
  }

  // On open, the current value is scrolled to the middle of the list and focused. The page does not move.
  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (list && current) list.scrollTop = current.offsetTop - (list.clientHeight - current.offsetHeight) / 2;
    (current ?? list?.querySelector<HTMLElement>('[data-cap-item]'))?.focus({ preventScroll: true });
    syncMore();
  }, []);

  useEffect(() => {
    if (customOpen) customRef.current?.focus();
  }, [customOpen]);

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

  // The desktop popover follows its cell, so scrolling the page or resizing closes it. Scrolling its own list does not.
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
    const list = Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-cap-item]') ?? []);
    const i = list.indexOf(e.target as HTMLElement);
    if (i < 0) return;
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % list.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    if (next >= 0) {
      e.preventDefault();
      list[next]!.focus();
    }
  }

  function submitCustom(e: FormEvent) {
    e.preventDefault();
    if (!custom) return;
    const result = custom.parse(customText);
    if (!result.ok) {
      setCustomError(result.error);
      return;
    }
    onPick(String(result.value));
  }

  const phone = !desktop;
  // Only the list scrolls. The title and current value stay above it, and the custom row stays last in it.
  const panel = phone
    ? 'fixed inset-x-0 bottom-0 z-30 max-h-[85vh] rounded-t-2xl border border-b-0 border-edge bg-field pb-[env(safe-area-inset-bottom)]'
    : 'fixed z-30 max-h-[calc(100vh-32px)] w-72 rounded-xl border border-edge bg-field shadow-lg';
  const rowH = phone ? 'h-11' : 'h-10';

  return (
    <>
      {phone && <div aria-hidden="true" className="fixed inset-0 z-20 bg-black/60" />}
      <div
        ref={ref}
        role="dialog"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={panel}
        style={phone ? undefined : (pos ?? { top: 0, left: 0 })}
      >
        {phone && <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-edge" />}
        <div className="px-4 pb-2 pt-3">
          <p className="text-[15px] font-medium text-paper">{title}</p>
          <p className="text-[12px] text-muted">{subtitle}</p>
        </div>
        <div className="relative">
          <div
            ref={listRef}
            role="menu"
            aria-label={label}
            onScroll={syncMore}
            className={`relative overflow-y-auto ${phone ? 'max-h-[50vh]' : 'max-h-72'}`}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitemradio"
                aria-checked={item.checked === true}
                data-cap-item
                onClick={() => onPick(item.key)}
                className={`flex ${rowH} w-full items-center justify-between px-4 text-left text-[15px] hover:bg-chip/50 focus-visible:bg-chip/60 focus-visible:outline-none ${
                  item.checked ? 'text-herbLight' : 'text-paper'
                }`}
              >
                <span>
                  {item.label}
                  {item.note && <span className="ml-2 text-[12px] text-muted">{item.note}</span>}
                </span>
                {item.checked && (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            ))}
            {custom && (
              <button
                type="button"
                role="menuitem"
                data-cap-item
                aria-expanded={customOpen}
                aria-controls="slot-custom-form"
                onClick={() => setCustomOpen((v) => !v)}
                className={`flex ${rowH} w-full items-center px-4 text-left text-[15px] text-paper hover:bg-chip/50 focus-visible:bg-chip/60 focus-visible:outline-none`}
              >
                {custom.label}
              </button>
            )}
          </div>
          {more && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-field to-transparent"
            />
          )}
        </div>
        {custom && customOpen && (
          <form id="slot-custom-form" noValidate onSubmit={submitCustom} className="border-t border-line2 px-4 pb-4 pt-3">
            <label className="block">
              <span className={eyebrow}>{custom.hint}</span>
              <span className="mt-2 flex gap-2">
                <input
                  ref={customRef}
                  type="number"
                  inputMode="numeric"
                  min={custom.min}
                  max={custom.max}
                  step={custom.step}
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
