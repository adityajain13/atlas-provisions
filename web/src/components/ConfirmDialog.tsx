import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, and Cancel takes focus so Enter does not confirm by reflex. */
  danger?: boolean;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

type Pending = ConfirmOptions & { resolve: (value: boolean) => void };

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Mount once, above the routes. Dialogs opened through useConfirm() render here. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        // A dialog already open is answered "no" before the new one replaces it.
        setPending((prev) => {
          prev?.resolve(false);
          return { ...options, resolve };
        });
      }),
    [],
  );

  function done(value: boolean) {
    setPending((prev) => {
      prev?.resolve(value);
      return null;
    });
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && <ConfirmDialog key={pending.title} request={pending} onDone={done} />}
    </ConfirmContext.Provider>
  );
}

/** Returns confirm({ title, message?, confirmLabel?, cancelLabel?, danger? }) => Promise<boolean>. */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used inside ConfirmProvider');
  return confirm;
}

const CANCEL_BTN =
  'flex h-11 items-center justify-center rounded-lg border border-edge px-4 text-[14px] text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herb';

const CONFIRM_BTN =
  'flex h-11 items-center justify-center rounded-lg bg-herb px-4 text-[14px] font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herbLight';

const DANGER_BTN =
  'flex h-11 items-center justify-center rounded-lg border border-[#5A2E28] bg-transparent px-4 text-[14px] font-medium text-[#E5806F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5806F]';

function ConfirmDialog({ request, onDone }: { request: ConfirmOptions; onDone: (value: boolean) => void }) {
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
        onDone(false);
      }}
      // Clicks on the backdrop target the dialog element itself, not the panel inside it.
      onClick={(e) => {
        if (e.target === ref.current) onDone(false);
      }}
      className="m-auto w-[calc(100%-32px)] max-w-[380px] bg-transparent p-0 backdrop:bg-black/60"
    >
      <div className="rounded-xl border border-edge bg-field p-6">
        <h2 id="confirm-title" className="font-display text-[20px] leading-[1.25] text-paper">
          {request.title}
        </h2>
        {request.message && (
          <p id="confirm-message" className="mt-2 text-[14px] leading-[1.5] text-muted">
            {request.message}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={() => onDone(false)} className={CANCEL_BTN}>
            {request.cancelLabel ?? 'Cancel'}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onDone(true)}
            className={danger ? DANGER_BTN : CONFIRM_BTN}
          >
            {request.confirmLabel ?? 'Remove'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
