import { useEffect, useState } from 'react';
import { SITE_BANNER_NAMES, siteBannerOf, type Store } from '@provisions/shared';
import { errorMessage, searchSiteLocations, type SiteLocationOption } from '../api';
import { eyebrow, fieldCls, linkBtn, secondaryBtn } from './ui';

type StoresUpdate = (fn: (stores: Store[]) => Store[]) => void;

const ERROR_TEXT = 'text-[#D98C7A]';
const SEARCH_DELAY_MS = 300;
const MIN_QUERY = 2;

/**
 * The store location whose regular shelf prices the app reads, shown in an expanded store row. A Loblaw-family store
 * searches its banner's locations by street, city or postal code and keeps the one picked. Other stores say so.
 */
export function RegularPriceLocation({ store: s, change }: { store: Store; change: StoresUpdate }) {
  const banner = siteBannerOf(s.id);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [found, setFound] = useState<SiteLocationOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const query = text.trim();
  // The search is open until a location is picked: when the store has none yet, or when it is being changed.
  const choosing = s.siteStore === undefined || editing;
  const searchable = choosing && banner !== undefined && query.length >= MIN_QUERY;

  useEffect(() => {
    if (!searchable || banner === undefined) return;
    let alive = true;
    const timer = setTimeout(() => {
      setSearching(true);
      searchSiteLocations(banner, query)
        .then((list) => {
          if (!alive) return;
          setFound(list);
          setSearchError(null);
        })
        .catch((e: unknown) => {
          if (!alive) return;
          setFound([]);
          setSearchError(errorMessage(e));
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [searchable, banner, query]);

  if (banner === undefined) {
    return (
      <div>
        <span className={eyebrow}>Location for regular prices</span>
        <p className="mt-2 text-[13px] text-muted">Regular prices aren&apos;t available for this store yet.</p>
      </div>
    );
  }

  const chainName = SITE_BANNER_NAMES[banner];

  function choose(loc: SiteLocationOption) {
    change((list) => list.map((x) => (x.id === s.id ? { ...x, siteStore: { banner: banner!, storeId: loc.storeId, label: loc.label } } : x)));
    setEditing(false);
    setText('');
    setFound([]);
  }

  function remove() {
    change((list) => list.map((x) => (x.id === s.id ? { ...x, siteStore: undefined } : x)));
    setEditing(false);
  }

  function cancel() {
    setEditing(false);
    setText('');
    setFound([]);
  }

  const picked = s.siteStore;
  return (
    <div>
      <span className={eyebrow}>Location for regular prices</span>

      {picked && !choosing ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="min-w-0 text-[15px] text-paper">{picked.label}</span>
          <span className="flex shrink-0 gap-4">
            <button type="button" onClick={() => setEditing(true)} className={linkBtn}>
              Change
            </button>
            <button type="button" onClick={remove} className={`${linkBtn} text-muted`}>
              Remove
            </button>
          </span>
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-[12px] text-muted">
            Search for the {chainName} near you by street, city or postal code. Its shelf prices are read for that store.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="search"
              className={fieldCls}
              placeholder="e.g. Mississauga or M5V"
              aria-label={`Search ${chainName} locations`}
              value={text}
              maxLength={60}
              onChange={(e) => setText(e.target.value)}
            />
            {picked && (
              <button type="button" onClick={cancel} className={`${secondaryBtn} shrink-0`}>
                Cancel
              </button>
            )}
          </div>

          {searching && <p className="mt-2 text-[12px] text-muted">Searching&hellip;</p>}
          {searchError && <p className={`mt-2 text-[13px] ${ERROR_TEXT}`}>{searchError}</p>}
          {searchable && !searching && !searchError && found.length === 0 && (
            <p className="mt-2 text-[13px] text-muted">No {chainName} locations match. Try a city or the first letters of the postal code.</p>
          )}
          {searchable && found.length > 0 && (
            <ul className="mt-3 divide-y divide-line2 overflow-hidden rounded-lg border border-edge">
              {found.map((loc) => (
                <li key={loc.storeId}>
                  <button
                    type="button"
                    onClick={() => choose(loc)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left text-[14px] text-paper hover:bg-field focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herb"
                  >
                    <span className="min-w-0">{loc.label}</span>
                    {loc.postalCode && <span className="shrink-0 text-[12px] text-muted">{loc.postalCode}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
