import { useCallback, useEffect, useState } from 'react';
import { errorMessage, getSitePriceStatus, refreshSitePrices, type SiteRunResult, type SiteStatus } from '../api';
import { timeAgo } from './FlyerRefresh';
import { Disclosure } from './Disclosure';
import { useSaveStatus } from './SaveStatus';
import { secondaryBtn } from './ui';

const ERROR_TEXT = 'text-[#D98C7A]';

/** Shown when the site asks for a PC id sign-in before it will search. */
export const SITE_AUTH_LINE = "Loblaw's site needs a PC id sign-in for price search, so regular prices aren't available yet.";

/** The sentence under the button after a run: what was looked up, at how many stores, and how many matched. */
export function siteResultLine(r: SiteRunResult, stores: number): string {
  const where = `${stores} ${stores === 1 ? 'store' : 'stores'}`;
  return `Looked up ${r.lookups} items at ${where}, matched ${r.matched}.`;
}

/**
 * The Regular prices row in Household's Stores section, under the flyers: when the prices were last read, how many
 * there are, a button to read them now, and the result of the last run. `stores` is how many enabled stores have a
 * location picked.
 */
export function SitePrices({ stores, onDone }: { stores: number; onDone?: () => void }) {
  const { track, status: saveStatus } = useSaveStatus();
  // A location picked a moment ago may not be saved yet, and the refresh reads the saved household. Wait for the save.
  const saving = saveStatus.kind === 'pending' || saveStatus.kind === 'saving';
  const [status, setStatus] = useState<SiteStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SiteRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [errorsOpen, setErrorsOpen] = useState(false);

  const load = useCallback(() => {
    getSitePriceStatus()
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
      setResult(await track(refreshSitePrices(), refreshSitePrices));
    } catch (e) {
      setRunError(errorMessage(e));
    } finally {
      setRunning(false);
      load();
      onDone?.();
    }
  }

  const last = status?.lastRun ?? null;
  let line = 'Loading…';
  if (statusError) line = 'Could not load regular price status';
  else if (status && !last) line = 'Never';
  else if (last) {
    const when = last.ok ? 'Last updated' : 'Last refresh had errors';
    const prices = status?.prices ?? 0;
    line = `${when} ${timeAgo(last.finishedAt)} · ${prices} ${prices === 1 ? 'price' : 'prices'}`;
  }

  const errors = result?.errors ?? [];

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="block text-[15px] text-paper">Regular prices</span>
          <span className="block text-[12px] text-muted">
            {stores === 0 ? 'Pick a store location below to read its regular prices.' : line}
          </span>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={running || stores === 0 || saving}
          className={`${secondaryBtn} shrink-0 disabled:opacity-40`}
        >
          {running ? 'Looking up… up to a minute' : 'Refresh regular prices'}
        </button>
      </div>

      {result && (
        <div className="mt-4 space-y-3">
          {result.lookups > 0 && <p className="text-[13px] text-paper">{siteResultLine(result, stores)}</p>}
          {result.lookups === 0 && errors[0] && <p className={`text-[13px] ${ERROR_TEXT}`}>{errors[0]}</p>}
          {result.authNeeded && <p className={`text-[13px] ${ERROR_TEXT}`}>{SITE_AUTH_LINE}</p>}
          {result.lookups > 0 && errors.length > 0 && (
            <Disclosure
              variant="compact"
              open={errorsOpen}
              onToggle={() => setErrorsOpen((v) => !v)}
              title={`Some lookups failed (${errors.length})`}
            >
              <ul className={`space-y-1.5 text-[13px] ${ERROR_TEXT}`}>
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Disclosure>
          )}
        </div>
      )}

      {runError && <p className={`mt-3 text-[13px] ${ERROR_TEXT}`}>Could not refresh regular prices: {runError}</p>}
    </div>
  );
}
