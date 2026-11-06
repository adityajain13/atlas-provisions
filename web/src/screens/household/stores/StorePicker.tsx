import { useEffect, useRef, useState } from 'react';
import { STORE_PRESETS, type Store, type StorePreset } from '@provisions/shared';
import { addBtn, eyebrow, fieldCls, linkBtn } from '../../../components/ui';
import { takesBranch, groupPresets, presetsNotInList, storeFromPreset } from '../../../lib/stores';

import { type StoresUpdate } from '../ui';
import { AddCustomStore } from './AddCustomStore';
import { FindBranch } from './FindBranch';

/** Native dialog: a bottom sheet on a phone, a centred card on desktop. Find a branch by address, presets to add, and a custom store. */
export function StorePicker({
  open,
  onClose,
  stores,
  change,
  postalCode,
}: {
  open: boolean;
  onClose: () => void;
  stores: Store[];
  change: StoresUpdate;
  postalCode?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [added, setAdded] = useState<string | null>(null);
  const [addressFor, setAddressFor] = useState<string | null>(null);
  const [addressText, setAddressText] = useState('');

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
    } else if (!open && d.open) {
      d.close();
      setQuery('');
      setAdded(null);
      setAddressFor(null);
      setAddressText('');
    }
  }, [open]);

  // The "Added" line is brief.
  useEffect(() => {
    if (!added) return;
    const t = window.setTimeout(() => setAdded(null), 2500);
    return () => window.clearTimeout(t);
  }, [added]);

  const notListed = presetsNotInList(stores, STORE_PRESETS);
  const q = query.trim().toLowerCase();
  const groups = groupPresets(q ? notListed.filter((p) => p.name.toLowerCase().includes(q)) : notListed);

  function addPreset(p: StorePreset, address?: string) {
    change((list) => (list.some((x) => x.id === p.id) ? list : [...list, storeFromPreset(p, address)]));
    setAddressFor(null);
    setAddressText('');
    setAdded(`Added ${p.name}`);
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="store-picker-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-0 inset-x-0 bottom-0 top-auto h-fit w-full max-w-none bg-transparent p-0 backdrop:bg-black/60 lg:m-auto lg:inset-0 lg:h-fit lg:w-[calc(100%-32px)] lg:max-w-[480px] [&_input:not([type=checkbox])]:bg-ink"
    >
      <div className="flex max-h-[85vh] flex-col rounded-t-2xl border border-b-0 border-edge bg-field lg:max-h-[80vh] lg:rounded-xl lg:border-b">
        <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-edge lg:hidden" />
        <div className="flex shrink-0 items-center justify-between gap-4 px-5 pt-3 lg:pt-5">
          <h2 id="store-picker-title" className="font-display text-[20px] font-semibold tracking-[-0.01em] text-paper">
            Add a store
          </h2>
          <button type="button" onClick={onClose} className={linkBtn}>
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6">
          <p role="status" aria-live="polite" className="h-5 pt-2 text-[13px] text-herbLight">
            {added ?? ''}
          </p>

          {/* Mounted only while open, so a search from an earlier visit does not show again. */}
          {open && <FindBranch stores={stores} change={change} postalCode={postalCode} onAdded={setAdded} />}

          <div className="mt-6 border-t border-line2 pt-4">
            <p className={eyebrow}>Chains</p>
            <input
              type="text"
              className={`${fieldCls} mt-3`}
              placeholder="Filter stores by name"
              aria-label="Filter stores by name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {groups.length === 0 && (
            <p className="mt-4 text-[14px] text-muted">
              {notListed.length === 0 ? 'Every store we know about is already in your list.' : `No stores match "${query.trim()}".`}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.group} className="mt-5 first:mt-0">
              <p className={eyebrow}>{g.group}</p>
              <ul className="mt-2">
                {g.presets.map((p) => {
                  const needsAddress = !takesBranch(p.id);
                  const typing = addressFor === p.id;
                  return (
                    <li key={p.id} className="border-b border-line2">
                      <div className="flex min-h-12 items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-[15px] text-paper">{p.name}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          {needsAddress && (
                            <button
                              type="button"
                              aria-expanded={typing}
                              aria-label={`Add ${p.name} with an address`}
                              onClick={() => {
                                setAddressFor(typing ? null : p.id);
                                setAddressText('');
                              }}
                              className={`${linkBtn} text-[13px]`}
                            >
                              With address
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={`Add ${p.name}`}
                            onClick={() => addPreset(p)}
                            className="h-11 shrink-0 rounded-lg border border-herb px-4 text-[14px] text-herbLight"
                          >
                            Add
                          </button>
                        </span>
                      </div>
                      {typing && (
                        <form
                          className="flex gap-2 pb-3"
                          onSubmit={(e) => {
                            e.preventDefault();
                            addPreset(p, addressText);
                          }}
                        >
                          <input
                            className={fieldCls}
                            placeholder="Address (optional)"
                            aria-label={`Address for ${p.name} (optional)`}
                            value={addressText}
                            maxLength={160}
                            onChange={(e) => setAddressText(e.target.value)}
                          />
                          <button type="submit" aria-label={`Add ${p.name} at this address`} className={addBtn}>
                            Add
                          </button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          <div className="mt-6 border-t border-line2 pt-4">
            <p className={eyebrow}>Not listed?</p>
            <AddCustomStore stores={stores} change={change} onAdded={setAdded} />
          </div>
        </div>
      </div>
    </dialog>
  );
}
