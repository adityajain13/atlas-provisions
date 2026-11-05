import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, and Cancel takes focus so Enter does not confirm by reflex. */
  danger?: boolean;
  /** An optional tick box under the message. Its state comes back through useConfirmChoice(). */
  checkbox?: { label: string; checked?: boolean };
};

/** What the person chose: confirmed or not, and the tick box (false when there is none). */
export type ConfirmAnswer = { ok: boolean; checked: boolean };

type AskFn = (options: ConfirmOptions) => Promise<ConfirmAnswer>;

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

type Pending = ConfirmOptions & { resolve: (value: ConfirmAnswer) => void };

const NO: ConfirmAnswer = { ok: false, checked: false };

const ConfirmContext = createContext<AskFn | null>(null);

/** Mount once, above the routes. Dialogs opened through useConfirm() or useConfirmChoice() render here. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const ask = useCallback<AskFn>(
    (options) =>
      new Promise<ConfirmAnswer>((resolve) => {
        // A dialog already open is answered "no" before the new one replaces it.
        setPending((prev) => {
          prev?.resolve(NO);
          return { ...options, resolve };
        });
      }),
    [],
  );

  function done(answer: ConfirmAnswer) {
    setPending((prev) => {
      prev?.resolve(answer);
      return null;
    });
  }

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending && <ConfirmDialog key={pending.title} request={pending} onDone={done} />}
    </ConfirmContext.Provider>
  );
}

function useAsk(): AskFn {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error('useConfirm must be used inside ConfirmProvider');
  return ask;
}

/** Returns confirm({ title, message?, confirmLabel?, cancelLabel?, danger? }) => Promise<boolean>. */
export function useConfirm(): ConfirmFn {
  const ask = useAsk();
  return useMemo<ConfirmFn>(() => (options) => ask(options).then((a) => a.ok), [ask]);
}

/** Like useConfirm, but the answer also says whether the tick box was ticked. */
export function useConfirmChoice(): AskFn {
  return useAsk();
}

const CANCEL_BTN =
  'flex h-11 items-center justify-center rounded-lg border border-edge px-4 text-[14px] text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herb';

const CONFIRM_BTN =
  'flex h-11 items-center justify-center rounded-lg bg-herb px-4 text-[14px] font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herbLight';

const DANGER_BTN =
  'flex h-11 items-center justify-center rounded-lg border border-[#5A2E28] bg-transparent px-4 text-[14px] font-medium text-[#E5806F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5806F]';

function ConfirmDialog({ request, onDone }: { request: ConfirmOptions; onDone: (answer: ConfirmAnswer) => void }) {
  const [checked, setChecked] = useState(request.checkbox?.checked === true);
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // The control that had focus before the dialog opened; focus returns there on close.
  const trigger = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  const danger = request.danger === true;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    (danger ? cancelRef.current : confirmRef.current)?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      const el = trigger.current as HTMLElement | null;
      if (el && typeof el.focus === 'function' && el.isConnected) el.focus();
    };
  }, [danger]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      aria-describedby={request.message ? 'confirm-message' : undefined}
      // Escape closes the native dialog; we answer "no" and unmount it.
      onCancel={(e) => {
        e.preventDefault();
        onDone({ ok: false, checked });
      }}
      // Clicks on the backdrop target the dialog element itself, not the panel inside it.
      onClick={(e) => {
        if (e.target === ref.current) onDone({ ok: false, checked });
      }}
      className="m-auto w-[calc(100%-32px)] max-w-[380px] bg-transparent p-0 backdrop:bg-black/60"
    >
      <div className="rounded-xl border border-edge bg-field p-6">
        <h2 id="confirm-title" className="font-display font-semibold tracking-[-0.01em] text-paper text-[20px] leading-[1.25]">
          {request.title}
        </h2>
        {request.message && (
          <p id="confirm-message" className="mt-2 text-[14px] leading-[1.5] text-muted">
            {request.message}
          </p>
        )}
        {request.checkbox && (
          <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 text-[14px] text-paper">
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            {request.checkbox.label}
          </label>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={() => onDone({ ok: false, checked })} className={CANCEL_BTN}>
            {request.cancelLabel ?? 'Cancel'}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onDone({ ok: true, checked })}
            className={danger ? DANGER_BTN : CONFIRM_BTN}
          >
            {request.confirmLabel ?? 'Remove'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
