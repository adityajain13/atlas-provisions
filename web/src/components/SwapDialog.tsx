import { useEffect, useRef } from 'react';
import { SWAP_NOTE_MAX } from '@provisions/shared';
import { linkedLine, NOTE_CHIPS, swapTitle, withChip, type SwapPreview } from '../lib/swap';
import { primaryBtn, secondaryBtn } from './ui';

// The dialog that confirms a swap: which meals go, what else the leftover links bring in, and an optional note.
export default function SwapDialog({
  preview,
  note,
  onNote,
  onCancel,
  onConfirm,
}: {
  preview: SwapPreview;
  note: string;
  onNote: (note: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // The control that had focus before the dialog opened; focus returns there on close.
  const trigger = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    confirmRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      const el = trigger.current as HTMLElement | null;
      if (el && typeof el.focus === 'function' && el.isConnected) el.focus();
    };
  }, []);

  const count = preview.closure.length;
  return (
    <dialog
      ref={ref}
      aria-labelledby="swap-title"
      aria-describedby="swap-summary"
      // Escape closes the native dialog; we answer "no" and unmount it.
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      // Clicks on the backdrop target the dialog element itself, not the panel inside it.
      onClick={(e) => {
        if (e.target === ref.current) onCancel();
      }}
      className="m-auto w-[calc(100%-32px)] max-w-[420px] bg-transparent p-0 backdrop:bg-black/60"
    >
      <div className="max-h-[calc(100vh-48px)] overflow-y-auto rounded-xl border border-edge bg-field p-6">
        <h2 id="swap-title" className="font-display font-semibold tracking-[-0.01em] text-paper text-[20px] leading-[1.25]">
          {swapTitle(count)}
        </h2>
        <p id="swap-summary" className="mt-2 text-[14px] leading-[1.5] text-muted">
          The rest of the week stays as it is.
        </p>

        <ul className="mt-4 space-y-3 border-t border-line pt-4">
          {preview.chosen.map((e) => (
            <li key={e.id} className="text-[14px]">
              <span className="text-paper">{e.name}</span>
              <span className="ml-2 text-[12px] uppercase tracking-[0.12em] text-muted">{e.label}</span>
            </li>
          ))}
          {preview.linked.map((e) => (
            <li key={e.id} className="text-[13px]">
              <span className="block text-herbLight">{linkedLine(e)}</span>
              <span className="block text-muted">{e.name}</span>
            </li>
          ))}
        </ul>

        <label htmlFor="swap-note" className="mt-5 block text-[13px] text-muted">
          Anything to change?
        </label>
        <textarea
          id="swap-note"
          value={note}
          maxLength={SWAP_NOTE_MAX}
          rows={2}
          placeholder="e.g. quicker, no fish"
          onChange={(e) => onNote(e.target.value)}
          className="mt-2 w-full rounded-md border border-edge bg-field p-3 text-[15px] text-paper placeholder:text-faint focus:border-herb focus:outline-none"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {NOTE_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onNote(withChip(note, chip))}
              className="h-11 rounded-full border border-edge px-3.5 text-[13px] text-muted hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herb"
            >
              {chip}
            </button>
          ))}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={secondaryBtn}>
            Cancel
          </button>
          <button ref={confirmRef} type="button" onClick={onConfirm} className={primaryBtn}>
            Swap
          </button>
        </div>
      </div>
    </dialog>
  );
}
