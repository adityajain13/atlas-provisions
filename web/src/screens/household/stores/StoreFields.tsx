import { useState, type KeyboardEvent } from 'react';
import { type Store } from '@provisions/shared';
import { addBtn, chipBase, eyebrow, fieldCls, removeIconBtn } from '../../../components/ui';
import { MAX_FLIPP_NAMES, withAddress, addFlippName, removeFlippName } from '../../../lib/stores';

import { type StoresUpdate } from '../ui';

/** The address typed for a store with no location picker. Saved when the field loses focus. */
export function StoreAddress({ store: s, change }: { store: Store; change: StoresUpdate }) {
  const [text, setText] = useState(s.address ?? '');
  function save() {
    const next = text.trim();
    if (next === (s.address ?? '')) return;
    change((list) => list.map((x) => (x.id === s.id ? withAddress(x, next) : x)));
  }
  return (
    <label className="block">
      <span className={eyebrow}>Address</span>
      <input
        className={`${fieldCls} mt-2`}
        placeholder="Optional"
        value={text}
        maxLength={160}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') save();
        }}
      />
      <span className="mt-2 block text-[12px] text-muted">The branch you shop at, so you can tell stores apart.</span>
    </label>
  );
}

/** The other names a store uses on Flipp: chips to remove, and an input to add one. */
export function FlippNames({ store: s, change }: { store: Store; change: StoresUpdate }) {
  const [text, setText] = useState('');
  const names = s.flippNames ?? [];
  const full = names.length >= MAX_FLIPP_NAMES;

  function edit(fn: (x: Store) => Store) {
    change((list) => list.map((x) => (x.id === s.id ? fn(x) : x)));
  }

  function add() {
    const name = text.trim();
    setText('');
    if (name) edit((x) => addFlippName(x, name));
  }

  return (
    <div>
      <span className={eyebrow}>Names on Flipp</span>
      <p className="mt-1 text-[12px] text-muted">Other names this store uses in flyers.</p>
      {names.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {names.map((n) => (
            <li key={n} className={`${chipBase} gap-1 border-edge pl-4 pr-1 text-paper`}>
              {n}
              <button
                type="button"
                aria-label={`Remove ${n}`}
                onClick={() => edit((x) => removeFlippName(x, n))}
                className={removeIconBtn}
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        <input
          className={fieldCls}
          placeholder={full ? `Up to ${MAX_FLIPP_NAMES} names` : 'Add a name'}
          aria-label={`Add a Flipp name for ${s.name}`}
          value={text}
          maxLength={40}
          disabled={full}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" onClick={add} disabled={full} className={`${addBtn} disabled:opacity-40`}>
          Add
        </button>
      </div>
    </div>
  );
}
