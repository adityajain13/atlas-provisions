import { primaryBtn, secondaryBtn } from './ui';
import { selectedMessage } from '../lib/swap';

// The bar along the bottom while meals are being chosen for a swap.
export default function SwapBar({
  selected,
  linked,
  onSwap,
  onCancel,
}: {
  selected: number;
  linked: number;
  onSwap: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4">
        <p className="min-w-0 text-[14px] text-paper" aria-live="polite">
          {selectedMessage(selected)}
          {linked > 0 && <span className="text-muted"> · {linked} linked</span>}
        </p>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={onCancel} className={secondaryBtn}>
            Cancel
          </button>
          <button type="button" onClick={onSwap} disabled={selected === 0} className={`${primaryBtn} disabled:opacity-40`}>
            Swap
          </button>
        </div>
      </div>
    </div>
  );
}
