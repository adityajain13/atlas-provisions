import { useCallback, useEffect, useState } from 'react';
import type { IngestRunSummary, IngestStatus } from '@provisions/shared';
import { errorMessage, getFlyerStatus, refreshFlyers } from '../api';
import { Disclosure } from './Disclosure';
import { useSaveStatus } from './SaveStatus';
import { secondaryBtn } from './ui';

const ERROR_TEXT = 'text-[#D98C7A]';

/**
 * The sentence under the refresh button. Flyers mode names the flyers and the raw item counts per store;
 * search mode says the items came from a search.
 */
export function resultLine(r: IngestRunSummary): string {
  if (r.mode === 'search') return `Found ${r.items} items by search. ${r.matched} matched to ingredients.`;
  const perStore = r.storeCounts.map((s) => `${s.store}: ${s.count}`).join(', ');
  const where = perStore ? ` (${perStore})` : '';
  return `Found ${r.items} items in ${r.flyerCount} flyers${where}. ${r.matched} matched to ingredients.`;
}

/** "5 min ago", "3 h ago", "2 days ago". */
export function timeAgo(iso: string, now = Date.now()): string {
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(mins) || mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

/** The Flyers row in Household's Stores section: last update, a refresh button, and the result of the last run. */
export function FlyerRefresh() {
  const { track } = useSaveStatus();
  const [status, setStatus] = useState<IngestStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<IngestRunSummary | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [unmatchedOpen, setUnmatchedOpen] = useState(false);

  const load = useCallback(() => {
    getFlyerStatus()
      .then((s) => {
        setStatus(s);
        setStatusError(null);
      })
      .catch((e: unknown) => setStatusError(errorMessage(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function refresh() {
    setRunning(true);
    setRunError(null);
    setResult(null);
    try {
      setResult(await track(refreshFlyers(), refreshFlyers));
    } catch (e) {
      setRunError(errorMessage(e));
    } finally {
      setRunning(false);
      load();
    }
  }

  const total = status?.currentItems.reduce((n, r) => n + r.count, 0) ?? 0;
  const last = status?.lastRun ?? null;
  let line = 'Loading…';
  if (statusError) line = 'Could not load flyer status';
  else if (status && !last) line = 'Never';
  else if (last) {
    const when = last.ok ? 'Last updated' : 'Last refresh had errors';
    line = `${when} ${timeAgo(last.finishedAt)} · ${total} ${total === 1 ? 'price' : 'prices'}`;
  }

  const errors = result?.errors ?? [];

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="block text-[15px] text-paper">Flyers</span>
          <span className="block text-[12px] text-muted">{line}</span>
        </div>
        <button type="button" onClick={refresh} disabled={running} className={`${secondaryBtn} shrink-0 disabled:opacity-40`}>
          {running ? 'Refreshing… up to a minute' : 'Refresh flyers'}
        </button>
      </div>

      {result && (
        <div className="mt-4 space-y-3">
          <p className="text-[13px] text-paper">{resultLine(result)}</p>
          {errors.length > 0 && (
            <div className="rounded-lg border border-edge px-4 py-3">
              <p className="text-[14px] text-paper">Some requests failed</p>
              <ul className={`mt-2 space-y-1.5 text-[13px] ${ERROR_TEXT}`}>
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {result.unmatchedSample.length > 0 && (
            <Disclosure
              variant="compact"
              open={unmatchedOpen}
              onToggle={() => setUnmatchedOpen((v) => !v)}
              title={`Unmatched (${result.unmatchedSample.length} shown)`}
            >
              <ul className="space-y-1 text-[13px] text-muted">
                {result.unmatchedSample.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </Disclosure>
          )}
        </div>
      )}

      {runError && <p className={`mt-3 text-[13px] ${ERROR_TEXT}`}>Could not refresh flyers: {runError}</p>}
    </div>
  );
}
