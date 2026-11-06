import { type PointerEvent } from 'react';
import { type Store, type StoreSyncMap } from '@provisions/shared';
import { Svg } from '../../../components/Icons';
import { RegularPriceLocation } from '../../../components/SiteLocation';
import { TNT_STORE_ID, TntSync } from '../../../components/TntSync';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Disclosure } from '../../../components/Disclosure';
import { addressOf, takesBranch, groupOf } from '../../../lib/stores';

import { type StoresUpdate } from '../ui';
import { SyncStatus, PriceData } from './PriceData';
import { StoreAddress, FlippNames } from './StoreFields';

/** One store: a shop-here switch, the name and chain, a price-match pill, and an expandable editor. */
/** Where a store sits in the ranking, and the controls that move it: arrows for the keyboard, a drag grip for a pointer. */
type RankControls = {
  index: number;
  count: number;
  dragging: boolean;
  onMove: (step: -1 | 1) => void;
  onGripDown: (e: PointerEvent<HTMLElement>) => void;
  onGripMove: (e: PointerEvent<HTMLElement>) => void;
  onGripUp: () => void;
};

// Hidden on phones, where they squeeze the store name; there the grip drags and the open row has Move buttons.
const RANK_BTN =
  'hidden sm:flex h-11 w-9 shrink-0 items-center justify-center rounded-md text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herb disabled:opacity-30';

export function StoreRow({
  store: s,
  postalCode,
  open,
  onToggle,
  change,
  rank,
  sync,
  onSynced,
}: {
  store: Store;
  postalCode?: string;
  open: boolean;
  onToggle: () => void;
  change: StoresUpdate;
  rank: RankControls;
  sync: StoreSyncMap | null;
  onSynced: () => void;
}) {
  const confirm = useConfirm();
  const shopping = s.enabled;
  const group = groupOf(s);

  function patch(p: Partial<Store>) {
    change((list) => list.map((x) => (x.id === s.id ? { ...x, ...p } : x)));
  }

  async function remove() {
    if (
      !(await confirm({
        title: `Remove ${s.name}?`,
        message: "Its flyer prices won't be used. Past price history is kept.",
        confirmLabel: 'Remove',
        danger: true,
      }))
    )
      return;
    if (open) onToggle();
    change((list) => list.filter((x) => x.id !== s.id));
  }

  return (
    <Disclosure
      open={open}
      onToggle={onToggle}
      lead={
        <span className="flex shrink-0 items-center">
          <span
            aria-hidden="true"
            onPointerDown={rank.onGripDown}
            onPointerMove={rank.onGripMove}
            onPointerUp={rank.onGripUp}
            onPointerCancel={rank.onGripUp}
            className={`flex h-11 w-7 shrink-0 touch-none select-none items-center justify-center text-faint ${
              rank.dragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
          >
            <Svg size={16}>
              <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
            </Svg>
          </span>
          <button
            type="button"
            aria-label={`Move ${s.name} up`}
            disabled={rank.index === 0}
            onClick={() => rank.onMove(-1)}
            className={RANK_BTN}
          >
            <Svg size={16}>
              <path d="M6 15l6-6 6 6" />
            </Svg>
          </button>
          <button
            type="button"
            aria-label={`Move ${s.name} down`}
            disabled={rank.index === rank.count - 1}
            onClick={() => rank.onMove(1)}
            className={RANK_BTN}
          >
            <Svg size={16}>
              <path d="M6 9l6 6 6-6" />
            </Svg>
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={shopping}
            aria-label={`Shop at ${s.name}`}
            onClick={() => patch({ enabled: !shopping })}
            className="flex h-12 w-11 shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herb"
          >
            <span
              aria-hidden="true"
              className={`relative inline-block h-5 w-9 rounded-full transition-colors motion-reduce:transition-none ${
                shopping ? 'bg-herb' : 'bg-edge'
              }`}
            >
              <span
                className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-paper transition-transform motion-reduce:transition-none ${
                  shopping ? 'translate-x-[18px]' : 'translate-x-0.5'
                }`}
              />
            </span>
          </button>
        </span>
      }
      title={
        <span className="flex min-w-0 items-baseline">
          <span className={`min-w-0 truncate ${shopping ? 'text-paper' : 'text-muted'}`}>{s.name}</span>
          {group && <span className="ml-2 shrink-0 text-[12px] text-muted">{group}</span>}
          <SyncStatus store={s} sync={sync} />
        </span>
      }
      detail={addressOf(s)}
      wideTitle
      summary={
        s.priceMatches ? (
          <span className="hidden rounded-full sm:inline-block border border-herb/40 px-2 py-0.5 text-[11px] text-herbLight">
            Price-matches
          </span>
        ) : undefined
      }
      remove={{ label: 'Remove store', onClick: () => void remove() }}
    >
      <div className="flex items-center justify-between gap-4 sm:hidden">
        <span className="text-[15px] text-paper">Rank {rank.index + 1} of {rank.count}</span>
        <span className="flex gap-2">
          <button
            type="button"
            disabled={rank.index === 0}
            onClick={() => rank.onMove(-1)}
            className="h-11 rounded-lg border border-edge px-4 text-[14px] text-paper disabled:opacity-30"
          >
            Move up
          </button>
          <button
            type="button"
            disabled={rank.index === rank.count - 1}
            onClick={() => rank.onMove(1)}
            className="h-11 rounded-lg border border-edge px-4 text-[14px] text-paper disabled:opacity-30"
          >
            Move down
          </button>
        </span>
      </div>
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
        <span className="min-w-0">
          <span className="block text-[15px] text-paper">Price-matches</span>
          <span className="block text-[12px] text-muted">Show price-match hints for this store.</span>
        </span>
        <input
          type="checkbox"
          className="h-5 w-5 shrink-0"
          checked={s.priceMatches}
          onChange={(e) => patch({ priceMatches: e.target.checked })}
        />
      </label>

      <PriceData store={s} sync={sync} />
      <FlippNames store={s} change={change} />
      {takesBranch(s.id) ? (
        <div className="mt-6">
          <RegularPriceLocation store={s} change={change} near={postalCode} />
        </div>
      ) : (
        <StoreAddress store={s} change={change} />
      )}
      {s.id === TNT_STORE_ID && (
        <div id="tnt-sync" className="mt-6 border-t border-line2 pt-4">
          <TntSync onDone={onSynced} />
        </div>
      )}
    </Disclosure>
  );
}
