// Placeholder for receipt scanning. The next update wires this to the receipt parser.
export function ScanReceiptButton() {
  return (
    <div>
      <button
        id="scan-receipt"
        type="button"
        disabled
        className="flex h-11 w-full items-center justify-center rounded-lg border border-edge text-[14px] text-muted disabled:cursor-not-allowed"
      >
        Scan receipt
      </button>
      <p className="mt-2 text-center text-[12px] text-muted">Coming in the next update</p>
    </div>
  );
}
