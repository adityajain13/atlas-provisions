import { useCallback, useEffect, useState } from 'react';
import {
  CATEGORY_ORDER,
  INGREDIENT_BY_ID,
  expiringSoon,
  formatUseBy,
  torontoDate,
  unitLabel,
  type CatalogIngredient,
  type Category,
  type PantryItem,
} from '@provisions/shared';
import { addPantryItem, errorMessage, getPantry, removePantryItem, updatePantryItem } from '../api';
import { Header } from '../components/Header';
import { Page } from '../components/Page';
import { IngredientPicker } from '../components/IngredientPicker';
import { ReceiptFlow } from '../components/ReceiptFlow';
import { Section } from '../components/Section';
import { addBtn, fieldCls, linkBtn, removeIconBtn } from '../components/ui';

const ERROR_TEXT = 'text-[#D98C7A]';
const MAX_QTY = 10000;

const stepFor = (unit: PantryItem['unit']) => (unit === 'each' ? 1 : 0.25);
const round2 = (n: number) => Math.round(n * 100) / 100;
const categoryOf = (item: PantryItem): Category => INGREDIENT_BY_ID[item.ingredientId]?.category ?? 'pantry';
const nameOf = (item: PantryItem) => INGREDIENT_BY_ID[item.ingredientId]?.name ?? item.ingredientId;
const categoryLabel = (c: Category) => c.charAt(0).toUpperCase() + c.slice(1);
const byExpiry = (a: PantryItem, b: PantryItem) =>
  a.expiresOn.localeCompare(b.expiresOn) || nameOf(a).localeCompare(nameOf(b));

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function Pantry() {
  const [items, setItems] = useState<PantryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    getPantry()
      .then(setItems)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const today = torontoDate();
  const soon = items ? expiringSoon(items, today) : [];
  const sorted = items ? [...items].sort(byExpiry) : [];

  async function changeQty(item: PantryItem, qty: number) {
    setError(null);
    try {
      const updated = await updatePantryItem(item.id, { qty });
      setItems((prev) => prev && prev.map((i) => (i.id === updated.id ? updated : i)));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function remove(item: PantryItem) {
    setError(null);
    try {
      await removePantryItem(item.id);
      setItems((prev) => prev && prev.filter((i) => i.id !== item.id));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  // `highlight` marks the use-by text in the Expiring soon section only.
  function row(item: PantryItem, highlight: boolean) {
    const name = nameOf(item);
    const step = stepFor(item.unit);
    const lower = round2(item.qty - step);
    const expired = item.expiresOn < today;
    return (
      <li
        key={`${highlight ? 'soon' : 'all'}-${item.id}`}
        className={`flex items-center gap-2 border-b border-line2 py-2.5${
          highlight ? ' lg:rounded-lg lg:border lg:border-line2 lg:bg-field lg:px-3' : ''
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] text-paper">{name}</p>
          <p className="text-[13px] text-muted">
            {round2(item.qty)} {unitLabel(item.unit)} ·{' '}
            <span className={highlight ? 'text-herbLight' : undefined}>
              {expired ? `Expired ${formatUseBy(item.expiresOn)}` : `Use by ${formatUseBy(item.expiresOn)}`}
            </span>
          </p>
        </div>
        <button
          type="button"
          aria-label={`Use less ${name}`}
          disabled={lower <= 0}
          onClick={() => changeQty(item, lower)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-edge text-[18px] text-paper disabled:opacity-30"
        >
          &minus;
        </button>
        <button
          type="button"
          aria-label={`Add more ${name}`}
          disabled={item.qty + step > MAX_QTY}
          onClick={() => changeQty(item, round2(item.qty + step))}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-edge text-[18px] text-paper disabled:opacity-30"
        >
          +
        </button>
        <button type="button" aria-label={`Remove ${name}`} onClick={() => remove(item)} className={removeIconBtn}>
          &times;
        </button>
      </li>
    );
  }

  const subtitle = items
    ? `${plural(items.length, 'item', 'items')} · ${soon.length} expiring soon`
    : 'Loading…';

  return (
    <Page>
      <div className="lg:flex lg:items-start lg:justify-between lg:gap-10">
        <div className="min-w-0 lg:flex-1">
          <Header title="Pantry" subtitle={subtitle} />
        </div>
        <div className="mt-6 lg:mt-0 lg:w-[380px] lg:shrink-0">
          <ReceiptFlow onSaved={reload} />
        </div>
      </div>

      {error && <p className={`mt-4 text-[13px] ${ERROR_TEXT}`}>Could not update the pantry: {error}</p>}
      {items === null && !error && <p className="mt-10 text-[14px] text-muted">Loading&hellip;</p>}

      <div className="lg:mt-10 lg:flex lg:flex-col lg:gap-12 xl:grid xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start xl:gap-12">
        <div className="min-w-0 lg:flex lg:flex-col lg:gap-12">
          {items && soon.length > 0 && (
            <Section title="Expiring soon" caption="Within three days, or already past its date.">
              <ul className="lg:grid lg:grid-cols-2 lg:gap-3">{soon.map((i) => row(i, true))}</ul>
            </Section>
          )}

          {items &&
            CATEGORY_ORDER.map((cat) => {
              const rows = sorted.filter((i) => categoryOf(i) === cat);
              if (rows.length === 0) return null;
              return (
                <Section key={cat} title={categoryLabel(cat)}>
                  <ul className="lg:grid lg:grid-cols-2 lg:gap-x-8">{rows.map((i) => row(i, false))}</ul>
                </Section>
              );
            })}

          {items && items.length === 0 && (
            <p className="mt-10 text-[14px] text-muted lg:mt-0">Nothing in the pantry yet. Add what you have below.</p>
          )}
        </div>

        {items && (
          <div className="min-w-0 xl:sticky xl:top-10">
            <AddForm
              onAdded={(item) => setItems((prev) => [...(prev ?? []), item])}
            />
          </div>
        )}
      </div>
    </Page>
  );
}

function AddForm({ onAdded }: { onAdded: (item: PantryItem) => void }) {
  const [picked, setPicked] = useState<CatalogIngredient | null>(null);
  const [qty, setQty] = useState('1');
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const amount = Number(qty);
  const valid = picked !== null && Number.isFinite(amount) && amount > 0 && amount <= MAX_QTY;

  async function add() {
    if (!picked || !valid) return;
    setSaving(true);
    setAddError(null);
    try {
      const item = await addPantryItem({ ingredientId: picked.id, qty: amount });
      onAdded(item);
      setPicked(null);
      setQty('1');
    } catch (e) {
      setAddError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Add to pantry" caption="Use-by dates are set from how long each food usually keeps.">
      {picked ? (
        <div>
          <div className="flex items-center justify-between">
            <p className="text-[15px] text-paper">{picked.name}</p>
            <button type="button" onClick={() => setPicked(null)} className={linkBtn}>
              Change
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={stepFor(picked.baseUnit)}
              aria-label="Quantity"
              className={`${fieldCls} w-28`}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            <span className="w-12 text-[14px] text-muted">{unitLabel(picked.baseUnit)}</span>
            <button type="button" disabled={!valid || saving} onClick={add} className={addBtn}>
              {saving ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      ) : (
        <IngredientPicker onPick={setPicked} />
      )}
      {addError && <p className={`mt-3 text-[13px] ${ERROR_TEXT}`}>Could not add: {addError}</p>}
    </Section>
  );
}
