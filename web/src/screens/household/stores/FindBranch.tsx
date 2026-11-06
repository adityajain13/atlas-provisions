import { useEffect, useState } from 'react';
import { SITE_BANNER_NAMES, isSiteBanner, type SiteBanner, type Store } from '@provisions/shared';
import { errorMessage, searchStoreBranches, type StoreBranchOption } from '../../../api';
import { kmLabel } from '../../../components/SiteLocation';
import { eyebrow, fieldCls } from '../../../components/ui';
import { withBranch } from '../../../lib/stores';

import { type StoresUpdate, ERROR_TEXT } from '../ui';

/**
 * Finds a branch of a Loblaw-family chain by street, city or postal code. Empty, with the household's postal code, it
 * lists the nearest across the chains. Adding a branch adds its chain, or replaces that chain's branch.
 */
export function FindBranch({
  stores,
  change,
  postalCode,
  onAdded,
}: {
  stores: Store[];
  change: StoresUpdate;
  postalCode?: string;
  onAdded: (message: string) => void;
}) {
  const [text, setText] = useState('');
  const [found, setFound] = useState<StoreBranchOption[]>([]);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [approx, setApprox] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = text.trim();
  const near = postalCode ?? '';
  const nearby = query === '' && near !== '';
  const active = nearby || query.length >= 2;

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      searchStoreBranches(query, near)
        .then((reply) => {
          if (!alive) return;
          setFound(reply.locations);
          setUnavailable(reply.unavailable ?? []);
          setApprox(reply.approx === true);
          setError(null);
        })
        .catch((e: unknown) => {
          if (!alive) return;
          setFound([]);
          setError(errorMessage(e));
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [active, query, near]);

  // Nothing is listed until something is typed or a postal code is saved. The nearest list shows six.
  const shown = active ? found.slice(0, nearby ? 6 : found.length) : [];

  function addBranch(loc: StoreBranchOption) {
    const branch = { banner: loc.banner as SiteBanner, storeId: loc.storeId, label: loc.label };
    const result = withBranch(stores, branch);
    if (!result) return;
    change((list) => withBranch(list, branch)?.stores ?? list);
    onAdded(result.outcome === 'added' ? `Added ${result.name}` : `Updated ${result.name} location`);
  }

  const unavailableNames = unavailable.map((b) => (isSiteBanner(b) ? SITE_BANNER_NAMES[b] : b));

  return (
    <div className="mt-4">
      <label className="block">
        <span className={eyebrow}>Find a store by address or postal code</span>
        <input
          type="search"
          className={`${fieldCls} mt-3`}
          placeholder="Street, city or postal code"
          aria-label="Find a store by address or postal code"
          value={text}
          maxLength={60}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p className="mt-2 text-[12px] text-muted">Flyers are the same at every branch; the branch is used for shelf prices and distance.</p>

      {!active && <p className="mt-3 text-[13px] text-muted">Add your postal code under Stores to see the nearest branches.</p>}
      {active && nearby && shown.length > 0 && !searching && <p className="mt-3 text-[12px] text-muted">Near {near}</p>}
      {searching && <p className="mt-2 text-[12px] text-muted">Searching&hellip;</p>}
      {error && (
        <p role="alert" className={`mt-2 text-[13px] ${ERROR_TEXT}`}>
          {error}
        </p>
      )}
      {active && !searching && !error && shown.length === 0 && (
        <p className="mt-3 text-[13px] text-muted">
          {nearby ? 'No branches found near your postal code yet.' : `No branches match "${query}". Try a city or a postal code.`}
        </p>
      )}
      {shown.length > 0 && (
        <ul className="mt-3 divide-y divide-line2 overflow-hidden rounded-lg border border-edge">
          {shown.map((loc) => (
            <li key={`${loc.banner}-${loc.storeId}`} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0">
                <span className="block truncate text-[14px] text-paper">{loc.label}</span>
                {loc.distanceKm !== undefined && <span className="block text-[12px] text-muted">{kmLabel(loc.distanceKm)}</span>}
              </span>
              <button
                type="button"
                aria-label={`Add ${loc.label}`}
                onClick={() => addBranch(loc)}
                className="h-11 shrink-0 rounded-lg border border-herb px-4 text-[14px] text-herbLight"
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      )}
      {approx && shown.length > 0 && !searching && <p className="mt-2 text-[12px] text-muted">Distances are approximate.</p>}
      {unavailableNames.length > 0 && <p className="mt-2 text-[12px] text-muted">Couldn&apos;t read {unavailableNames.join(', ')} right now.</p>}
    </div>
  );
}
