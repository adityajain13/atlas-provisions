import {
  type Store,
  storeSyncDetail,
  storeSyncLabel,
  storeSyncPartLine,
  storeSyncState,
  syncSourcesOf,
  type StoreSyncMap,
} from '@provisions/shared';
import { TNT_STORE_ID } from '../../../components/TntSync';
import { eyebrow, linkBtn } from '../../../components/ui';
import { takesBranch } from '../../../lib/stores';

/**
 * The store's price status in its row, after the chain: a dot (herb when fresh, amber when stale, a hollow ring when
 * nothing has been read) and the label from the small screens up. The dot's title and label give each source's detail.
 * Off stores and the first load show nothing.
 */
export function SyncStatus({ store, sync }: { store: Store; sync: StoreSyncMap | null }) {
  if (!store.enabled || sync === null) return null;
  const now = new Date();
  const result = storeSyncState(syncSourcesOf(sync[store.id] ?? {}), now);
  const label = storeSyncLabel(result, now);
  const detail = storeSyncDetail(result, now) || label;
  const dot =
    result.state === 'fresh' ? 'bg-herb' : result.state === 'stale' ? 'bg-[#D9A55A]' : 'border border-muted';
  return (
    <span className="ml-2 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap align-middle text-[12px] text-muted">
      <span role="img" aria-label={detail} title={detail} className={`inline-block h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

/**
 * The Price data block in an open store: each source with its count and time. For a store nothing has read, the block
 * says which action fills it. Off stores and the first load show nothing.
 */
export function PriceData({ store, sync }: { store: Store; sync: StoreSyncMap | null }) {
  if (!store.enabled || sync === null) return null;
  const now = new Date();
  const result = storeSyncState(syncSourcesOf(sync[store.id] ?? {}), now);
  return (
    <div className="border-t border-line2 pt-4">
      <p className={eyebrow}>Price data</p>
      {result.state === 'none' ? (
        <div className="mt-2 space-y-1 text-[13px] text-muted">
          <p>No prices read for this store yet.</p>
          <p>Refresh flyers above to read its flyer.</p>
          {takesBranch(store.id) && (
            <p>
              {store.siteStore
                ? 'Refresh regular prices above to read its shelf prices.'
                : 'Pick a location below, then refresh regular prices above.'}
            </p>
          )}
          {store.id === TNT_STORE_ID && (
            <p>
              <button
                type="button"
                onClick={() => document.getElementById('tnt-sync')?.scrollIntoView({ block: 'center' })}
                className={linkBtn}
              >
                Sync T&amp;T from your browser
              </button>
            </p>
          )}
        </div>
      ) : (
        <ul className="mt-2 space-y-1 text-[13px] text-muted">
          {result.parts.map((p) => (
            <li key={p.source}>{storeSyncPartLine(p, now)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
