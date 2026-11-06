import { useEffect, useRef } from 'react';

export const UNDO_MS = 8000;

// The toast after a swap: what changed, and a way back for a few seconds.
export default function UndoToast({
  message,
  busy,
  onUndo,
  onDismiss,
}: {
  message: string;
  busy: boolean;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  // Read through a ref so a parent re-render does not restart the timer.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const t = window.setTimeout(() => dismissRef.current(), UNDO_MS);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-6 z-40 mx-auto flex max-w-md items-center justify-between gap-4 rounded-lg border border-edge bg-field px-4 py-3 shadow-lg"
    >
      <span className="min-w-0 text-[14px] text-paper">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        disabled={busy}
        className="h-11 shrink-0 px-3 text-[14px] font-medium text-herbLight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herb disabled:opacity-40"
      >
        {busy ? 'Undoing…' : 'Undo'}
      </button>
    </div>
  );
}
