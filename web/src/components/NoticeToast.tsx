import { useEffect, useRef } from 'react';

export const NOTICE_MS = 8000;

// A short line after an action, with one follow-up the person may take. It goes away on its own after a few seconds.
export default function NoticeToast({
  message,
  actionLabel,
  onAction,
  onDismiss,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}) {
  // Read through a ref so a parent re-render does not restart the timer.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const t = window.setTimeout(() => dismissRef.current(), NOTICE_MS);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-6 z-40 mx-auto flex max-w-md items-center justify-between gap-4 rounded-lg border border-edge bg-field px-4 py-3 shadow-lg"
    >
      <span className="min-w-0 text-[14px] text-paper">{message}</span>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="h-11 shrink-0 px-3 text-left text-[14px] font-medium text-herbLight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herb"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
