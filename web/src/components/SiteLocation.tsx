import { useEffect, useState } from 'react';
import { SITE_BANNER_NAMES, siteBannerOf, type Store } from '@provisions/shared';
import { errorMessage, type SiteLocationOption } from '../api';
import { eyebrow, fieldCls, linkBtn, secondaryBtn } from './ui';

type StoresUpdate = (fn: (stores: Store[]) => Store[]) => void;

const ERROR_TEXT = 'text-[#D98C7A]';
const SEARCH_DELAY_MS = 300;
const MIN_QUERY = 2;
const BASE = '/provisions/api';

/** What the search answers: the matches, and whether the chain lists no locations at all (the picker then asks for a number). */
interface SearchReply {
  locations: SiteLocationOption[];
  unsupported: boolean;
}

/**
 * The locations of a banner that match the search text. The worker answers 200 with unsupported set when the site lists
 * none for the chain, so that case is a reply, not an error. A refusal (a sign-in) comes back as an error with its text.
 */
async function searchLocations(banner: string, q: string): Promise<SearchReply> {
  const res = await fetch(`${BASE}/site-stores/${encodeURIComponent(banner)}/locations?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  const body = (await res.json()) as { locations?: SiteLocationOption[]; unsupported?: boolean };
  return { locations: body.locations ?? [], unsupported: body.unsupported === true };
}

/** The store number a person typed: exactly four digits, spaces around it ignored. Null when it is not one. */
export function storeNumberOf(text: string): string | null {
  const t = text.trim();
  return /^\d{4}$/.test(t) ? t : null;
}

/**
 * The store location whose regular shelf prices the app reads, shown in an expanded store row. A Loblaw-family store
 * searches its banner's locations by street, city or postal code and keeps the one picked. A store number can be
 * typed instead, and a chain the site lists no locations for gets only that. Other stores say so.
 */
export function RegularPriceLocation({ store: s, change }: { store: Store; change: StoresUpdate }) {
  const banner = siteBannerOf(s.id);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [found, setFound] = useState<SiteLocationOption[]>([]);
  const [unsupported, setUnsupported] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [numberOpen, setNumberOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [numberError, setNumberError] = useState<string | null>(null);
  const query = text.trim();
  // The search is open until a location is picked: when the store has none yet, or when it is being changed.
  const choosing = s.siteStore === undefined || editing;
  const searchable = choosing && banner !== undefined && query.length >= MIN_QUERY;
  // The site lists no locations for this chain: the number form is the way to pick one.
  const noLocations = searchable && !searching && !searchError && unsupported;
  const showNumber = numberOpen || noLocations;

  useEffect(() => {
    if (!searchable || banner === undefined) return;
    let alive = true;
    const timer = setTimeout(() => {
      setSearching(true);
      searchLocations(banner, query)
        .then((reply) => {
          if (!alive) return;
          setFound(reply.locations);
          setUnsupported(reply.unsupported);
          setSearchError(null);
        })
        .catch((e: unknown) => {
          if (!alive) return;
          setFound([]);
          setUnsupported(false);
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
  const numberId = `store-number-${s.id}`;
  const helpId = `store-number-help-${s.id}`;

  function resetSearch() {
    setEditing(false);
    setText('');
    setFound([]);
    setUnsupported(false);
    setNumberOpen(false);
    setNumber('');
    setNumberError(null);
  }

  function choose(loc: SiteLocationOption) {
    change((list) => list.map((x) => (x.id === s.id ? { ...x, siteStore: { banner: banner!, storeId: loc.storeId, label: loc.label } } : x)));
    resetSearch();
  }

  function saveNumber() {
    const storeId = storeNumberOf(number);
    if (storeId === null) {
      setNumberError('Enter the 4-digit store number, such as 1234.');
      return;
    }
    change((list) => list.map((x) => (x.id === s.id ? { ...x, siteStore: { banner: banner!, storeId, label: `Store ${storeId}` } } : x)));
    resetSearch();
  }

  function remove() {
    change((list) => list.map((x) => (x.id === s.id ? { ...x, siteStore: undefined } : x)));
    setEditing(false);
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
              placeholder="e.g. Mississauga or M5V 1R5"
              aria-label={`Search ${chainName} locations`}
              value={text}
              maxLength={60}
              onChange={(e) => setText(e.target.value)}
            />
            {picked && (
              <button type="button" onClick={resetSearch} className={`${secondaryBtn} shrink-0`}>
                Cancel
              </button>
            )}
          </div>

          {searching && <p className="mt-2 text-[12px] text-muted">Searching&hellip;</p>}
          {searchError && <p className={`mt-2 text-[13px] ${ERROR_TEXT}`}>{searchError}</p>}
          {noLocations && (
            <p className="mt-2 text-[13px] text-muted">
              {`Store locations for ${chainName} aren't available from Loblaw's site. Enter the store number instead.`}
            </p>
          )}
          {searchable && !searching && !searchError && !unsupported && found.length === 0 && (
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

          {!showNumber && (
            <button type="button" onClick={() => setNumberOpen(true)} className={`${linkBtn} mt-2`}>
              Enter store number
            </button>
          )}
          {showNumber && (
            <div className="mt-4">
              <label htmlFor={numberId} className="block text-[13px] text-muted">
                Store number
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id={numberId}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  className={fieldCls}
                  placeholder="e.g. 1234"
                  value={number}
                  aria-invalid={numberError ? true : undefined}
                  aria-describedby={helpId}
                  onChange={(e) => {
                    setNumber(e.target.value);
                    setNumberError(null);
                  }}
                />
                <button type="button" onClick={saveNumber} className={`${secondaryBtn} shrink-0`}>
                  Save
                </button>
              </div>
              <p id={helpId} className="mt-2 text-[12px] text-muted">
                {`It's in the store page URL on the chain's website, e.g. …/store-locator/details/1234`}
              </p>
              {numberError && <p className={`mt-2 text-[13px] ${ERROR_TEXT}`}>{numberError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
