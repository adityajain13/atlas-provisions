import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  formatPostalCode,
  normalizePostalCode,
  type Household,
  type StorePreference,
  type StoreSyncMap,
} from '@provisions/shared';
import { getStoreSync } from '../../api';
import { FlyerRefresh } from '../../components/FlyerRefresh';
import { SitePrices } from '../../components/SitePrices';
import { Section } from '../../components/Section';
import { eyebrow, fieldCls, linkBtn } from '../../components/ui';
import {
  clampMaxStores,
  dropIndex,
  enabledCount,
  maxStoresLimit,
  moveStore,
  moveStoreTo,
  parseMinSaving,
  readsSitePrices,
} from '../../lib/stores';

import { StorePicker } from './stores/StorePicker';
import { StoreRow } from './stores/StoreRow';
import { type Update, type StoresUpdate, ERROR_TEXT } from './ui';

// ---------- Stores ----------

export function StoresSection({ h, update }: { h: Household; update: Update }) {
  // Every change to the list goes through here, so the per-trip count stays within the enabled stores.
  const changeStores = useCallback<StoresUpdate>(
    (fn) =>
      update((prev) => {
        const stores = fn(prev.stores);
        return { ...prev, stores, maxStores: clampMaxStores(prev.maxStores, stores) };
      }),
    [update],
  );
  // One store row open at a time, and the add-store picker.
  const [openId, setOpenId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // When each price source last read each store: the status dots and the Price data blocks. Refetched after a refresh
  // and when the window regains focus (a T&T sync can run in another tab). Nothing shows until it loads.
  const [sync, setSync] = useState<StoreSyncMap | null>(null);
  const loadSync = useCallback(() => {
    getStoreSync()
      .then(setSync)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    loadSync();
    window.addEventListener('focus', loadSync);
    return () => window.removeEventListener('focus', loadSync);
  }, [loadSync]);
  const limit = maxStoresLimit(h.stores);
  const perTrip = clampMaxStores(h.maxStores, h.stores);
  // The list's order is the ranking: the first store is the closest or the favourite.
  const rows = h.stores;
  const listRef = useRef<HTMLUListElement>(null);
  // A row being dragged, and the position it would drop to (0 to rows.length, counted as the rows are now).
  const [drag, setDrag] = useState<{ id: string; to: number } | null>(null);

  function setMax(n: number) {
    update((prev) => ({ ...prev, maxStores: clampMaxStores(n, prev.stores) }));
  }

  function setPreference(patch: Partial<StorePreference>) {
    update((prev) => ({ ...prev, storePreference: { ...prev.storePreference, ...patch } }));
  }

  function gripDown(e: PointerEvent<HTMLElement>, id: string) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id, to: rows.findIndex((r) => r.id === id) });
  }

  function gripMove(e: PointerEvent<HTMLElement>) {
    if (!drag || !listRef.current) return;
    const middles = Array.from(listRef.current.querySelectorAll<HTMLElement>('[data-store-row]')).map((el) => {
      const box = el.getBoundingClientRect();
      return box.top + box.height / 2;
    });
    const to = dropIndex(middles, e.clientY);
    if (to !== drag.to) setDrag({ id: drag.id, to });
  }

  function gripUp() {
    if (!drag) return;
    const { id, to } = drag;
    setDrag(null);
    changeStores((list) => moveStoreTo(list, id, to));
  }

  return (
    <Section title="Stores">
      {/* Stacked full width: the right column is too narrow to put the refresh rows beside the postal code. */}
      <div className="flex flex-col">
        <div className="max-w-xs">
          <PostalCodeField h={h} update={update} />
        </div>
        <div className="mt-6 border-t border-line2 pt-4">
          <FlyerRefresh onDone={loadSync} />
        </div>
        <div className="mt-6 border-t border-line2 pt-4">
          <SitePrices stores={h.stores.filter(readsSitePrices).length} onDone={loadSync} />
        </div>
      </div>

      <div className="mt-8">
        <p className={eyebrow}>Your stores</p>
        {rows.length === 0 ? (
          <p className="mt-2 text-[14px] text-muted">No stores yet. Add one below.</p>
        ) : (
          <>
            <p className="mt-1 text-[13px] text-muted">Ranked by preference: closest or favourite first.</p>
            <ul className="mt-2" ref={listRef}>
              {rows.map((s, index) => (
                <li
                  key={s.id}
                  data-store-row
                  className={drag && drag.to === index && drag.id !== s.id ? 'border-t-2 border-herb' : ''}
                >
                  <StoreRow
                    store={s}
                    postalCode={h.postalCode}
                    open={openId === s.id}
                    onToggle={() => setOpenId((cur) => (cur === s.id ? null : s.id))}
                    change={changeStores}
                    sync={sync}
                    onSynced={loadSync}
                    rank={{
                      index,
                      count: rows.length,
                      dragging: drag?.id === s.id,
                      onMove: (step) => changeStores((list) => moveStore(list, s.id, step)),
                      onGripDown: (e) => gripDown(e, s.id),
                      onGripMove: gripMove,
                      onGripUp: gripUp,
                    }}
                  />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[13px] text-muted">
              {`${enabledCount(h.stores)} of ${h.stores.length} stores enabled.`}
            </p>
          </>
        )}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          aria-haspopup="dialog"
          className={`mt-3 ${linkBtn}`}
        >
          + Add store
        </button>
      </div>

      <div className="mt-8">
        <p className="text-[15px] text-paper">When stores tie or nearly tie</p>
        <div
          role="radiogroup"
          aria-label="When stores tie or nearly tie"
          className="mt-3 inline-flex rounded-full border border-edge p-1"
        >
          {PREFERENCE_CHOICES.map((choice) => {
            const active = h.storePreference.mode === choice.mode;
            return (
              <button
                key={choice.mode}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPreference({ mode: choice.mode })}
                className={`min-h-11 rounded-full px-4 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herb ${
                  active ? 'bg-herb font-medium text-ink' : 'text-muted'
                }`}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
        {h.storePreference.mode === 'prefer' ? (
          <MinSavingField value={h.storePreference.minSaving} onChange={(minSaving) => setPreference({ minSaving })} />
        ) : (
          <p className="mt-2 text-[13px] text-muted">The lowest total wins, whatever order the stores are in.</p>
        )}
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <span className="text-[15px] text-paper">Max stores per trip</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Fewer stores"
              disabled={perTrip <= 1}
              onClick={() => setMax(perTrip - 1)}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-edge text-[18px] text-paper disabled:opacity-40"
            >
              &minus;
            </button>
            <span className="w-6 text-center text-[18px] font-semibold tabular-nums text-paper">{perTrip}</span>
            <button
              type="button"
              aria-label="More stores"
              disabled={perTrip >= limit}
              onClick={() => setMax(perTrip + 1)}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-edge text-[18px] text-paper disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>
        <p className="mt-2 text-[13px] text-muted">
          {`We'll pick up to ${perTrip} of your enabled stores, by price and by how you rank them.`}
        </p>
      </div>

      <StorePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        stores={h.stores}
        change={changeStores}
        postalCode={h.postalCode}
      />
    </Section>
  );
}

/** The store preference choices, in the order the control shows them. */
const PREFERENCE_CHOICES: { mode: StorePreference['mode']; label: string }[] = [
  { mode: 'cheapest', label: 'Cheapest wins' },
  { mode: 'prefer', label: 'Prefer my top stores' },
];

/** The dollar amount a higher-ranked store may cost more by before a lower-ranked one is taken. Typed freely; saved when valid. */
function MinSavingField({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  // A saved value that changes from elsewhere replaces the draft.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  return (
    <label className="mt-4 flex flex-wrap items-center gap-2 text-[15px] text-paper">
      <span>Switch to a lower-ranked store only if it saves at least $</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={50}
        step={0.5}
        aria-label="Minimum saving in dollars"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseMinSaving(e.target.value);
          if (n !== null) onChange(n);
        }}
        onBlur={() => setDraft(String(value))}
        className="h-11 w-24 rounded-md border border-edge bg-ink px-3 text-[15px] text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herb"
      />
    </label>
  );
}

/** Postal code for finding flyers. Only a complete code is saved, as "M5T 1R5": uppercase, with the space. */
function PostalCodeField({ h, update }: { h: Household; update: Update }) {
  const [text, setText] = useState(formatPostalCode(h.postalCode ?? '') ?? h.postalCode ?? '');
  const invalid = text.trim() !== '' && normalizePostalCode(text) === null;

  function onChange(value: string) {
    const formatted = formatPostalCode(value);
    if (formatted) {
      setText(formatted);
      update((prev) => (prev.postalCode === formatted ? prev : { ...prev, postalCode: formatted }));
      return;
    }
    setText(value);
    if (value.trim() === '') {
      update((prev) => {
        const next = { ...prev };
        delete next.postalCode;
        return next;
      });
    }
  }

  return (
    <label className="block">
      <span className={eyebrow}>Postal code</span>
      <input
        className={`${fieldCls} mt-2`}
        value={text}
        maxLength={7}
        autoComplete="postal-code"
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="mt-2 block text-[12px] text-muted">Used to find flyers near you.</span>
      {invalid && <span className={`mt-1 block text-[12px] ${ERROR_TEXT}`}>Enter a Canadian postal code, like M5V 2T6.</span>}
    </label>
  );
}
