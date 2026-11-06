// How recently each price source read a store, and whether the store's prices are fresh. Pure: no network, no database.
// The worker reads the per-store rows; the Household screen shows the state under each store.
import { torontoDate } from './pantry';

export type SyncSourceName = 'flyer' | 'shelf' | 'tnt';

/** One source's reading of one store. A flyer reads items and the last day its newest flyer is valid. */
export interface SyncSource {
  source: SyncSourceName;
  /** When the source last read this store (ISO time). */
  at: string;
  /** Current items for a flyer, prices for a shelf or T&T source. */
  count: number;
  /** A flyer's last valid day, YYYY-MM-DD. */
  validTo?: string;
}

/** What the worker reports for one store: each source's last read and its current count. Absent when that source never read it. */
export interface StoreSyncReadings {
  /** The newest flyer fetch, the items still valid, and the newest flyer's last valid day. */
  flyer?: { at: string; count: number; validTo: string };
  /** The last matched regular-price lookup at the store's location, and the ingredients priced there lately. */
  shelf?: { at: string; count: number };
  /** The household's last browser sync, and the T&T prices lately read at its region's store. */
  tnt?: { at: string; count: number };
}

/** The readings of every store, keyed by store id (GET /stores/sync). */
export type StoreSyncMap = Record<string, StoreSyncReadings>;

/** The sources a store's readings hold, in the order the Price data block lists them. */
export function syncSourcesOf(readings: StoreSyncReadings): SyncSource[] {
  const out: SyncSource[] = [];
  if (readings.flyer) out.push({ source: 'flyer', ...readings.flyer });
  if (readings.shelf) out.push({ source: 'shelf', ...readings.shelf });
  if (readings.tnt) out.push({ source: 'tnt', ...readings.tnt });
  return out;
}

/** fresh: read within the window and no flyer has expired. stale: older, or its flyer expired. none: nothing read. */
export type SyncState = 'fresh' | 'stale' | 'none';

export interface StoreSyncResult {
  state: SyncState;
  /** The newest read among the sources that count, or null when there is none. */
  lastAt: string | null;
  /** The sources that count: a source with no items or prices does not, unless it is a flyer (an expired flyer still says so). */
  parts: SyncSource[];
}

/** A store counts as fresh when its newest read is no older than this. */
export const FRESH_DAYS = 7;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export const SOURCE_NAMES: Record<SyncSourceName, string> = {
  flyer: 'Flyers',
  shelf: 'Regular prices',
  tnt: 'T&T prices',
};

/** The state of one store from the sources that read it. */
export function storeSyncState(sources: SyncSource[], now: Date): StoreSyncResult {
  const parts = sources.filter((s) => s.count > 0 || s.source === 'flyer');
  if (parts.length === 0) return { state: 'none', lastAt: null, parts: [] };

  let lastAt = parts[0]!.at;
  for (const p of parts) if (Date.parse(p.at) > Date.parse(lastAt)) lastAt = p.at;

  const today = torontoDate(now);
  const flyerExpired = parts.some((p) => p.source === 'flyer' && p.validTo !== undefined && p.validTo < today);
  const recent = now.getTime() - Date.parse(lastAt) <= FRESH_DAYS * DAY_MS;
  return { state: recent && !flyerExpired ? 'fresh' : 'stale', lastAt, parts };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A YYYY-MM-DD day as "Oct 28", with the year when it is not the year of `now`. */
function shortDay(day: string, now: Date): string {
  const [year, month, date] = day.split('-');
  const name = `${MONTHS[Number(month) - 1] ?? '?'} ${Number(date)}`;
  return year === torontoDate(now).slice(0, 4) ? name : `${name}, ${year}`;
}

/** The Toronto calendar day of an ISO time, as "Nov 5". */
function calendarDay(iso: string, now: Date): string {
  return shortDay(torontoDate(new Date(iso)), now);
}

/**
 * How long ago an ISO time was, for a person: "just now", "5 min ago", "3 h ago", "2 days ago", then the calendar day
 * ("Oct 28") from a week back. A time in the future, or one that cannot be read, is "just now".
 */
export function relativeAgo(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < MINUTE_MS) return 'just now';
  const mins = Math.floor(ms / MINUTE_MS);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? '1 day ago' : `${days} days ago`;
  return calendarDay(iso, now);
}

/** The short text beside the store's dot: "Synced 3 h ago", "Flyer expired" or "Not synced". */
export function storeSyncLabel(result: StoreSyncResult, now: Date = new Date()): string {
  if (result.state === 'none' || result.lastAt === null) return 'Not synced';
  const today = torontoDate(now);
  const flyer = result.parts.find((p) => p.source === 'flyer');
  if (flyer?.validTo !== undefined && flyer.validTo < today) return 'Flyer expired';
  return `Synced ${relativeAgo(result.lastAt, now)}`;
}

/** One source for the Price data block: "Flyers: 142 items, 3 h ago". */
export function storeSyncPartLine(part: SyncSource, now: Date = new Date()): string {
  const unit = part.source === 'flyer' ? 'items' : 'prices';
  const count = part.count === 1 ? unit.replace(/s$/, '') : unit;
  return `${SOURCE_NAMES[part.source]}: ${part.count} ${count}, ${relativeAgo(part.at, now)}`;
}

/**
 * The full detail for the dot's tooltip and label, with calendar days: "Flyer: 142 items, fetched Nov 5, valid to Nov 12
 * · Shelf prices: 380, Nov 4". Empty when nothing is read.
 */
export function storeSyncDetail(result: StoreSyncResult, now: Date = new Date()): string {
  return result.parts
    .map((p) => {
      if (p.source === 'flyer') {
        const items = p.count === 1 ? 'item' : 'items';
        const valid = p.validTo !== undefined ? `, valid to ${shortDay(p.validTo, now)}` : '';
        return `Flyer: ${p.count} ${items}, fetched ${calendarDay(p.at, now)}${valid}`;
      }
      return `${SOURCE_NAMES[p.source]}: ${p.count}, ${calendarDay(p.at, now)}`;
    })
    .join(' · ');
}
