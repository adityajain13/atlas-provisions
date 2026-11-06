import { useState, type FormEvent } from 'react';
import { type Store } from '@provisions/shared';
import { addBtn, fieldCls } from '../../../components/ui';
import { addCustomStore } from '../../../lib/stores';

import { type StoresUpdate, ERROR_TEXT } from '../ui';

export function AddCustomStore({
  stores,
  change,
  onAdded,
}: {
  stores: Store[];
  change: StoresUpdate;
  onAdded: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [flipp, setFlipp] = useState('');
  const [where, setWhere] = useState('');
  const [error, setError] = useState<string | null>(null);

  function add(e: FormEvent) {
    e.preventDefault();
    const result = addCustomStore(stores, name, flipp, where);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const store = result.store;
    change((list) => {
      const again = addCustomStore(list, name, flipp, where);
      return again.ok && again.store.id === store.id ? [...list, again.store] : list;
    });
    onAdded(`Added ${store.name}`);
    setName('');
    setFlipp('');
    setWhere('');
    setError(null);
  }

  return (
    <form onSubmit={add} noValidate className="mt-3">
      <div className="flex flex-col gap-2">
        <input
          className={fieldCls}
          placeholder="Store name"
          aria-label="Store name"
          value={name}
          maxLength={40}
          aria-invalid={error !== null}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
        <input
          className={fieldCls}
          placeholder="Address (optional)"
          aria-label="Address (optional)"
          value={where}
          maxLength={160}
          onChange={(e) => setWhere(e.target.value)}
        />
        <input
          className={fieldCls}
          placeholder="Name on Flipp (optional)"
          aria-label="Name on Flipp (optional)"
          value={flipp}
          maxLength={200}
          onChange={(e) => setFlipp(e.target.value)}
        />
        <div>
          <button type="submit" className={addBtn}>
            Add
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className={`mt-2 text-[13px] ${ERROR_TEXT}`}>
          {error}
        </p>
      )}
    </form>
  );
}
