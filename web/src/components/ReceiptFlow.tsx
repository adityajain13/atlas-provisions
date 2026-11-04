import { useState, type ChangeEvent } from 'react';
import {
  INGREDIENT_BY_ID,
  LOW_CONFIDENCE,
  matchReceipt,
  round2,
  torontoDate,
  unitLabel,
  type CatalogIngredient,
  type ParsedReceipt,
  type ReceiptCommit,
} from '@provisions/shared';
import { commitReceipt, errorMessage, getHousehold, parseReceipt, type ReceiptCommitResult } from '../api';
import { photoToJpeg } from '../lib/receipt';
import { IngredientPicker } from './IngredientPicker';
import { ctaBtn, eyebrow, fieldCls, linkBtn, secondaryBtn } from './ui';
import { useSaveStatus } from './SaveStatus';

const ERROR_TEXT = 'text-[#D98C7A]';

/** One line on the confirm step. `cost` is what the line really cost, tax and tip included. */
interface Row {
  index: number;
  name: string;
  original?: string;
  cost: number;
  ingredientId: string | null;
  confidence: number; // set to 1 once the person picks the ingredient
  include: boolean;
  addToPantry: boolean;
  qtyText: string;
}

type Phase = { kind: 'idle' } | { kind: 'reading' } | { kind: 'confirm' } | { kind: 'error'; message: string } | { kind: 'saved'; result: ReceiptCommitResult };

const todayIso = () => torontoDate();
const isIsoDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const qtyOf = (r: Row) => Number(r.qtyText);
const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * Scan a grocery receipt: photo, then Claude reads it, then the person checks the lines (store,
 * date, the ingredient for each line, quantity, what goes in the pantry), then Save. The matches
 * and prices are written by the worker. Calls onSaved so the pantry list can reload.
 */
export function ReceiptFlow({ onSaved }: { onSaved: () => void }) {
  const { track } = useSaveStatus();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [photo, setPhoto] = useState<string | null>(null);
  const [storeOptions, setStoreOptions] = useState<string[]>([]);
  const [store, setStore] = useState('');
  const [date, setDate] = useState(todayIso());
  const [total, setTotal] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [pickingIndex, setPickingIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function read(image: string) {
    setPhase({ kind: 'reading' });
    setSaveError(null);
    try {
      const [receipt, household] = await Promise.all([parseReceipt(image), getHousehold().catch(() => null)]);
      const all = household?.stores ?? [];
      const enabled = all.filter((s) => s.enabled);
      showConfirm(receipt, enabled.length > 0 ? enabled : all);
    } catch (e) {
      setPhase({ kind: 'error', message: errorMessage(e) });
    }
  }

  function showConfirm(receipt: ParsedReceipt, stores: { name: string; flippNames?: string[] }[]) {
    const items = (receipt.items ?? []).filter((i) => i && typeof i.price === 'number');
    // Flipp names count when matching, so a receipt from a store under another name still finds it.
    const match = matchReceipt({ ...receipt, items }, stores);
    const storeList = stores.map((s) => s.name);
    const options = [...new Set([...(match.store ? [match.store] : []), ...storeList])];

    setStoreOptions(options);
    setStore(match.store ?? options[0] ?? '');
    setDate(isIsoDate(receipt.date) ? receipt.date : todayIso());
    setTotal(typeof receipt.total === 'number' ? receipt.total : null);
    setRows(
      match.lines.map((l) => ({
        index: l.index,
        name: l.name,
        original: l.original,
        cost: l.price,
        ingredientId: l.ingredientId,
        confidence: l.confidence,
        include: l.include,
        addToPantry: l.include,
        qtyText: String(l.qty),
      })),
    );
    setPickingIndex(null);
    setPhase({ kind: 'confirm' });
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // so the same photo can be picked again
    if (!file) return;
    setSaveError(null);
    try {
      const jpeg = await photoToJpeg(file);
      setPhoto(jpeg);
      await read(jpeg);
    } catch {
      setPhase({ kind: 'error', message: 'Could not read that photo. Try another.' });
    }
  }

  function patchRow(index: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.index === index ? { ...r, ...patch } : r)));
  }

  // Picking an ingredient confirms the line. Food is included and goes to the pantry by default.
  function pick(index: number, ing: CatalogIngredient) {
    setRows((rs) =>
      rs.map((r) => {
        if (r.index !== index) return r;
        const prevUnit = r.ingredientId ? INGREDIENT_BY_ID[r.ingredientId]?.baseUnit : undefined;
        const food = ing.category !== 'household';
        return {
          ...r,
          ingredientId: ing.id,
          confidence: 1,
          include: food,
          addToPantry: food,
          qtyText: prevUnit === ing.baseUnit ? r.qtyText : '1',
        };
      }),
    );
    setPickingIndex(null);
  }

  const included = rows.filter((r) => r.include && r.ingredientId);
  const includedSum = round2(included.reduce((sum, r) => sum + r.cost, 0));
  const sumAll = round2(rows.reduce((sum, r) => sum + r.cost, 0));
  const qtyOk = included.every((r) => Number.isFinite(qtyOf(r)) && qtyOf(r) > 0);
  const canSave = store !== '' && included.length > 0 && qtyOk && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    const input: ReceiptCommit = {
      store,
      date,
      lines: included.map((r) => {
        const ing = INGREDIENT_BY_ID[r.ingredientId!]!;
        const qty = qtyOf(r);
        return {
          ingredientId: ing.id,
          name: r.name || ing.name,
          ...(r.original ? { original: r.original } : {}),
          qty,
          unit: ing.baseUnit,
          price: round2(r.cost),
          pricePerUnit: r.cost > 0 ? Number((r.cost / qty).toFixed(4)) : null,
          addToPantry: r.addToPantry,
        };
      }),
    };
    try {
      const result = await track(commitReceipt(input), () => commitReceipt(input));
      setPhase({ kind: 'saved', result });
      onSaved();
    } catch (e) {
      setSaveError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  function startAgain() {
    setPhoto(null);
    setRows([]);
    setPhase({ kind: 'idle' });
  }

  return (
    <section aria-label="Scan a receipt">
      {phase.kind === 'idle' && (
        <div>
          <label className={`${secondaryBtn} w-full cursor-pointer`}>
            Scan receipt
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPhoto} />
          </label>
          <p className="mt-2 text-center text-[12px] text-muted">Photograph a receipt to record prices and add food to the pantry.</p>
        </div>
      )}

      {phase.kind === 'reading' && (
        <div className="py-6">
          <h2 className="font-display font-semibold tracking-[-0.01em] text-paper text-[22px]">Reading receipt&hellip;</h2>
          <p className="mt-2 text-[13px] text-muted">Claude is reading every line. This takes a few seconds.</p>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="rounded-lg border border-herb px-4 py-3">
          <p className="text-[14px] text-muted">{phase.message}</p>
          <div className="mt-3 flex gap-3">
            {photo && (
              <button type="button" className={secondaryBtn} onClick={() => read(photo)}>
                Retry
              </button>
            )}
            <button type="button" className={linkBtn} onClick={startAgain}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase.kind === 'saved' && (
        <div className="rounded-lg border border-edge px-4 py-3">
          <p className="text-[14px] text-paper">
            Recorded {phase.result.prices} prices and {phase.result.pantryItems} pantry items.
          </p>
          <button type="button" className={`${linkBtn} mt-1`} onClick={startAgain}>
            Scan another receipt
          </button>
        </div>
      )}

      {phase.kind === 'confirm' && (
        <div>
          <h2 className="font-display font-semibold tracking-[-0.01em] text-paper text-[22px]">Check the receipt</h2>
          <p className="mt-1 text-[13px] text-muted">Lines marked Check were matched by guess. Fix anything that is wrong.</p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="block">
              <span className={eyebrow}>Store</span>
              <select className={`${fieldCls} mt-2`} value={store} onChange={(e) => setStore(e.target.value)}>
                {storeOptions.length === 0 && <option value="">No store</option>}
                {storeOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={eyebrow}>Date</span>
              <input type="date" className={`${fieldCls} mt-2`} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>

          <ul className="mt-5">
            {rows.map((r) => (
              <LineRow
                key={r.index}
                row={r}
                picking={pickingIndex === r.index}
                onPicking={(on) => setPickingIndex(on ? r.index : null)}
                onPick={(ing) => pick(r.index, ing)}
                onPatch={(p) => patchRow(r.index, p)}
              />
            ))}
          </ul>
          {rows.length === 0 && <p className="mt-4 text-[14px] text-muted">No lines were read from this receipt.</p>}

          <div className="mt-6 space-y-1.5 border-t border-line pt-4 text-[14px]">
            <div className="flex justify-between">
              <span className="text-muted">Receipt total</span>
              <span className="text-paper">{money(total ?? sumAll)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Included lines</span>
              <span className="text-paper">{money(includedSum)}</span>
            </div>
          </div>

          {saveError && <p className={`mt-4 text-[13px] ${ERROR_TEXT}`}>Could not save: {saveError}</p>}
          <button type="button" disabled={!canSave} onClick={save} className={`${ctaBtn} mt-4`}>
            Save
          </button>
          {!qtyOk && included.length > 0 && <p className="mt-2 text-[13px] text-muted">Every included line needs a quantity above zero.</p>}
        </div>
      )}
    </section>
  );
}

function LineRow({
  row,
  picking,
  onPicking,
  onPick,
  onPatch,
}: {
  row: Row;
  picking: boolean;
  onPicking: (on: boolean) => void;
  onPick: (ing: CatalogIngredient) => void;
  onPatch: (patch: Partial<Row>) => void;
}) {
  const ing = row.ingredientId ? INGREDIENT_BY_ID[row.ingredientId] : undefined;
  const check = row.confidence < LOW_CONFIDENCE;

  return (
    <li className={`mb-2 border-b border-line2 pb-3 ${check ? 'rounded-md border border-herb px-3 pt-3' : 'pt-1'}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          aria-label={`Include ${row.name}`}
          className="mt-1 h-5 w-5 shrink-0"
          checked={row.include}
          disabled={!row.ingredientId}
          onChange={(e) => onPatch({ include: e.target.checked })}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-[15px] text-paper">{row.name}</p>
            <span className="shrink-0 text-[14px] text-paper">{money(row.cost)}</span>
          </div>
          {row.original && row.original !== row.name && <p className="text-[12px] text-muted">{row.original}</p>}
          {check && <span className="mt-1 inline-block rounded-full border border-herb px-2 py-0.5 text-[11px] text-herbLight">Check</span>}

          {picking ? (
            <div className="mt-2 space-y-2">
              <IngredientPicker autoFocus onPick={onPick} />
              <button type="button" className={linkBtn} onClick={() => onPicking(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => onPicking(true)} className="min-h-11 rounded-md border border-edge px-3 text-[13px] text-paper">
                {ing ? ing.name : 'Choose ingredient'}
              </button>
              {ing && (
                <>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    aria-label={`Quantity of ${row.name}`}
                    className={`${fieldCls} w-24`}
                    value={row.qtyText}
                    onChange={(e) => onPatch({ qtyText: e.target.value })}
                  />
                  <span className="text-[13px] text-muted">{unitLabel(ing.baseUnit)}</span>
                  <label className="flex min-h-11 items-center gap-2 text-[13px] text-muted">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={row.addToPantry}
                      onChange={(e) => onPatch({ addToPantry: e.target.checked })}
                    />
                    Add to pantry
                  </label>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
