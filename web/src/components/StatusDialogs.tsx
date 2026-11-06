import { useEffect, useRef, type ReactNode } from 'react';
import { primaryBtn, secondaryBtn } from './ui';
import type { PantryChoice } from '../lib/mealStatus';

// The dialogs that follow a skipped or made-instead meal. Both are native <dialog>s, as the swap confirmation is.

/** A modal dialog. Escape and a click on the backdrop call onCancel; focus returns to what opened it on close. */
function Modal({ id, title, summary, onCancel, children }: { id: string; title: string; summary?: string; onCancel: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const trigger = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    dialog?.querySelector<HTMLElement>('button, input')?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      const el = trigger.current as HTMLElement | null;
      if (el && typeof el.focus === 'function' && el.isConnected) el.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={summary ? `${id}-summary` : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCancel();
      }}
      className="m-auto w-[calc(100%-32px)] max-w-[420px] bg-transparent p-0 backdrop:bg-black/60"
    >
      <div className="max-h-[calc(100vh-48px)] overflow-y-auto rounded-xl border border-edge bg-field p-6">
        <h2 id={`${id}-title`} className="font-display text-[20px] font-semibold leading-[1.25] tracking-[-0.01em] text-paper">
          {title}
        </h2>
        {summary && (
          <p id={`${id}-summary`} className="mt-2 text-[14px] leading-[1.5] text-muted">
            {summary}
          </p>
        )}
        {children}
      </div>
    </dialog>
  );
}

/** Asked after a meal is skipped or made instead, when other meals were to eat its leftovers. */
export function LeftoversDialog({
  question,
  canSwap,
  busy,
  onSkip,
  onSwap,
  onKeep,
  onCancel,
}: {
  question: string;
  canSwap: boolean;
  busy: boolean;
  onSkip: () => void;
  onSwap: () => void;
  onKeep: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal id="leftovers" title={question} onCancel={onCancel}>
      <div className="mt-6 flex flex-col gap-2">
        <button type="button" onClick={onSkip} disabled={busy} className={`${primaryBtn} w-full disabled:opacity-40`}>
          Skip it too
        </button>
        {canSwap && (
          <button type="button" onClick={onSwap} disabled={busy} className={`${secondaryBtn} w-full disabled:opacity-40`}>
            Swap it
          </button>
        )}
        <button type="button" onClick={onKeep} disabled={busy} className={`${secondaryBtn} w-full disabled:opacity-40`}>
          Keep it
        </button>
      </div>
    </Modal>
  );
}

/** The unused ingredients of a skipped or made-instead meal, as a checklist. Adding them puts the ticked ones in the pantry. */
export function PantryDialog({
  choices,
  busy,
  error,
  onToggle,
  onAdd,
  onCancel,
}: {
  choices: PantryChoice[];
  busy: boolean;
  error: string | null;
  onToggle: (ingredientId: string) => void;
  onAdd: () => void;
  onCancel: () => void;
}) {
  const ticked = choices.filter((c) => c.ticked).length;
  return (
    <Modal
      id="pantry"
      title="Add the unused ingredients to your pantry?"
      summary="They will be kept in the pantry until their use-by date, and the planner uses them first."
      onCancel={onCancel}
    >
      <ul className="mt-5 divide-y divide-line2 border-y border-line2">
        {choices.map((c) => (
          <li key={c.ingredientId}>
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 py-2 text-[14px]">
              <span className="flex min-w-0 items-center gap-3">
                <input
                  type="checkbox"
                  checked={c.ticked}
                  onChange={() => onToggle(c.ingredientId)}
                  className="h-4 w-4 accent-herb"
                />
                <span className="truncate text-paper">{c.name}</span>
              </span>
              <span className="shrink-0 text-muted">{c.amount}</span>
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-[13px] text-[#D98C7A]">Could not add to the pantry: {error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className={secondaryBtn}>
          Not now
        </button>
        <button type="button" onClick={onAdd} disabled={busy || ticked === 0} className={`${primaryBtn} disabled:opacity-40`}>
          {busy ? 'Adding…' : 'Add to pantry'}
        </button>
      </div>
    </Modal>
  );
}
