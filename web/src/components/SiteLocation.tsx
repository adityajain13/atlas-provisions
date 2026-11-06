import { useEffect, useState } from 'react';
import { SITE_BANNER_NAMES, hasLocationList, siteBannerOf, type Store } from '@provisions/shared';
import { errorMessage, type SiteLocationOption } from '../api';
import { eyebrow, fieldCls, linkBtn, secondaryBtn } from './ui';

type StoresUpdate = (fn: (stores: Store[]) => Store[]) => void;

const ERROR_TEXT = 'text-[#D98C7A]';
const SEARCH_DELAY_MS = 300;
const MIN_QUERY = 2;
/** The nearest locations listed under the search before anything is typed. */
const NEAREST_SHOWN = 5;
const BASE = '/provisions/api';
export const TANDT_NO_LOCATIONS = "Regular prices aren't available for T&T yet. Prices from your scanned receipts still count.";

/** What the search answers: the matches, whether the chain lists no locations at all, and whether distances are rough. */
interface SearchReply {
  locations: SiteLocationOption[];
  unsupported: boolean;
  approx: boolean;
}

/**
 * The locations of a banner that match the search text, or the nearest to the household's postal code when the text is
 * empty. The worker answers 200 with unsupported set when the site lists none for the chain, so that case is a reply,
 * not an error. A refusal (a sign-in) comes back as an error with its text.
 */
async function searchLocations(banner: string, q: string, near: string): Promise<SearchReply> {
  const query = `q=${encodeURIComponent(q)}${near ? `&near=${encodeURIComponent(near)}` : ''}`;
  const res = await fetch(`${BASE}/site-stores/${encodeURIComponent(banner)}/locations?${query}`);
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  const body = (await res.json()) as { locations?: SiteLocationOption[]; unsupported?: boolean; approx?: boolean };
  return { locations: body.locations ?? [], unsupported: body.unsupported === true, approx: body.approx === true };
}

/** The store number a person typed: exactly four digits, spaces around it ignored. Null when it is not one. */
export function storeNumberOf(text: string): string | null {
  const t = text.trim();
  return /^\d{4}$/.test(t) ? t : null;
}

/** A distance for a location row, such as "2.1 km". */
export function kmLabel(km: number): string {
  return `${km.toFixed(1)} km`;
}

/**
 * The store location whose regular shelf prices the app reads, shown in an expanded store row. A Loblaw-family store
 * shows the nearest locations to the household's postal code first, and searches its banner's locations by street,
 * city or postal code. A store number can be typed instead, and a chain the site lists no locations for gets only that.
 * T&T has no location list, so it gets a note instead.
 */
export function RegularPriceLocation({ store: s, change, near = '' }: { store: Store; change: StoresUpdate; near?: string }) {
  const banner = siteBannerOf(s.id);
  const listed = banner !== undefined && hasLocationList(banner);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [found, setFound] = useState<SiteLocationOption[]>([]);
  const [unsupported, setUnsupported] = useState(false);
  const [approx, setApprox] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [numberOpen, setNumberOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [numberError, setNumberError] = useState<string | null>(null);
  const query = text.trim();
  // The search is open until a location is picked: when the store has none yet, or when it is being changed.
  const choosing = s.siteStore === undefined || editing;
  // Nothing typed and a household postal code: the nearest locations are listed first.
  const nearby = choosing && listed && query === '' && near !== '';
  const searchable = choosing && listed && (query.length >= MIN_QUERY || nearby);
  // The site lists no locations for this chain: the number form is the way to pick one.
  const noLocations = searchable && !searching && !searchError && unsupported;
  const showNumber = numberOpen || noLocations;
  const shown = nearby ? found.slice(0, NEAREST_SHOWN) : found;

  useEffect(() => {
    if (!searchable || banner === undefined) return;
    let alive = true;
    const timer = setTimeout(() => {
      setSearching(true);
      searchLocations(banner, query, near)
        .then((reply) => {
          if (!alive) return;
          setFound(reply.locations);
          setUnsupported(reply.unsupported);
          setApprox(reply.approx);
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
  }, [searchable, banner, query, near]);

  if (banner === undefined) {
    return (
      <div>
        <span className={eyebrow}>Location for regular prices</span>
        <p className="mt-2 text-[13px] text-muted">Regular prices aren&apos;t available for this store yet.</p>
      </div>
    );
  }
  if (!listed) {
    return (
      <div>
        <span className={eyebrow}>Location for regular prices</span>
        <p className="mt-2 text-[13px] text-muted">{TANDT_NO_LOCATIONS}</p>
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
    setApprox(false);
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
          {nearby && shown.length > 0 && !searching && <p className="mt-3 text-[12px] text-muted">Nearest to {near}</p>}
          {searchable && !searching && !searchError && !unsupported && found.length === 0 && (
            <p className="mt-2 text-[13px] text-muted">
              {nearby
                ? `No ${chainName} locations near ${near}. Search by street, city or postal code.`
                : `No ${chainName} locations match. Try a city or the first letters of the postal code.`}
            </p>
          )}
          {searchable && shown.length > 0 && (
            <ul className="mt-2 divide-y divide-line2 overflow-hidden rounded-lg border border-edge">
              {shown.map((loc) => (
                <li key={loc.storeId}>
                  <button
                    type="button"
                    onClick={() => choose(loc)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left text-[14px] text-paper hover:bg-field focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herb"
                  >
                    <span className="min-w-0 truncate">{loc.label}</span>
                    <span className="flex shrink-0 gap-3 text-[12px] text-muted">
                      {loc.distanceKm !== undefined && <span>{kmLabel(loc.distanceKm)}</span>}
                      {loc.postalCode && <span>{loc.postalCode}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {approx && shown.length > 0 && !searching && <p className="mt-2 text-[12px] text-muted">Distances are approximate.</p>}

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
                On the chain&apos;s website it&apos;s the last part of the store page address, e.g. nofrills.ca/store-locator/details/3643.
              </p>
              {numberError && <p className={`mt-2 text-[13px] ${ERROR_TEXT}`}>{numberError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
