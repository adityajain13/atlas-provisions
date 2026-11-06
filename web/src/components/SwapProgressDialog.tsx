import { useEffect, useRef } from 'react';
import { Spinner } from './Spinner';
import { secondaryBtn } from './ui';

/**
 * The modal shown while the planner swaps meals or rewrites the prep list. It cannot be dismissed while it runs: Escape
 * and a click outside are ignored. When the work fails, it shows the error with a Close button.
 */
export function SwapProgressDialog({
  title,
  progress,
  meals,
  error,
  onClose,
}: {
  title: string;
  progress: string;
  meals: string[];
  error: string | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    if (error) closeRef.current?.focus();
  }, [error]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="progress-title"
      aria-describedby="progress-line"
      // Escape is ignored while the work runs. The dialog stays until it succeeds or the person closes the error.
      onCancel={(e) => e.preventDefault()}
      className="m-auto w-[calc(100%-32px)] max-w-[380px] bg-transparent p-0 backdrop:bg-black/60"
    >
      <div className="rounded-xl border border-edge bg-field p-6">
        <div className="flex items-center gap-3">
          {!error && <Spinner size={20} />}
          <h2 id="progress-title" className="font-display font-semibold tracking-[-0.01em] text-paper text-[20px] leading-[1.25]">
            {title}
          </h2>
        </div>

        {error ? (
          <p id="progress-line" role="alert" className="mt-3 text-[14px] leading-[1.5] text-[#D98C7A]">
            {error}
          </p>
        ) : (
          <p id="progress-line" aria-live="polite" className="mt-3 text-[14px] leading-[1.5] text-muted">
            {progress}
          </p>
        )}

        {meals.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-line pt-4 text-[13px] text-muted">
            {meals.map((name, i) => (
              <li key={`${name}-${i}`} className="truncate">
                {name}
              </li>
            ))}
          </ul>
        )}

        {error && (
          <div className="mt-6 flex justify-end">
            <button ref={closeRef} type="button" onClick={onClose} className={secondaryBtn}>
              Close
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}
