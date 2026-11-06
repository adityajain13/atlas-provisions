import { useEffect, useRef, useState } from 'react';
import {
  INGREDIENT_BY_ID,
  DAY_LONG,
  formatCookAmount,
  type Day,
  type FeedbackKind,
  type IngredientFeedbackInput,
  type PlannedMeal,
  type RatingKind,
  type WeekFeedback,
} from '@provisions/shared';
import { Fragment, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { clearIngredientFeedback, errorMessage, getWeekFeedback, saveIngredientFeedback } from '../api';
import type { MealRef, ViewMeal, ViewTag } from '../lib/planView';
import { SLOT_LABEL } from '../lib/labels';
import { ReturnIcon } from './Icons';
import { searchIngredients } from './IngredientPicker';
import { fieldCls } from './ui';

export const RATING_OPTIONS: { value: RatingKind; label: string }[] = [
  { value: 'up', label: 'Liked' },
  { value: 'down', label: 'Not again' },
  { value: 'never', label: 'Never' },
];

export const TAG_TONE: Record<ViewTag['kind'], string> = {
  craving: 'border-herb text-herbLight',
  deal: 'border-[#3A3631] text-[#C9C3B8]',
  leftover: 'border-edge text-muted',
};

type Props = {
  day: Day;
  meal: ViewMeal;
  // The saved plan's meal, for its ingredients and steps. Absent for sample data and fixed meals.
  planned: PlannedMeal | undefined;
  rating: RatingKind | null;
  ratingError: string | null;
  onRate: (value: RatingKind) => void;
  onClose: () => void;
  // Opens another planned meal, from a leftover link.
  onOpenMeal: (id: string) => void;
  // Swaps this meal (and the meals linked to it by leftovers). Absent for fixed meals and past weeks.
  onSwap?: () => void;
  // The week of the saved plan this meal is in. With it, each ingredient can be marked skipped or replaced.
  weekOf?: string;
  // 'panel' is the desktop side panel. 'sheet' is the full-screen sheet on a phone, with a Back button.
  presentation?: 'panel' | 'sheet';
  // A fixed meal's ingredients as typed on Household. Read-only: a fixed meal has no plan to change.
  fixedIngredients?: { name: string; qty: number; unit: string }[];
};

/** Desktop side panel with the whole meal: ingredients, steps, tags and the rating buttons. */
export default function MealDetail({
  day,
  meal,
  planned,
  rating,
  ratingError,
  onRate,
  onClose,
  onOpenMeal,
  onSwap,
  weekOf,
  presentation = 'panel',
  fixedIngredients,
}: Props) {
  const sheet = presentation === 'sheet';
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Changes saved for this week, by meal and ingredient. Loaded once per meal shown; edits update it at once.
  const [changes, setChanges] = useState<WeekFeedback>({});
  const [changeError, setChangeError] = useState<string | null>(null);
  const [openIngredient, setOpenIngredient] = useState<string | null>(null);
  const mealId = planned?.id;
  const canChange = Boolean(weekOf && mealId);

  useEffect(() => {
    if (!weekOf || !mealId) return;
    let alive = true;
    getWeekFeedback(weekOf)
      .then((all) => {
        if (alive) setChanges(all);
      })
      .catch(() => {
        if (alive) setChangeError('Could not load the changes for this week.');
      });
    return () => {
      alive = false;
    };
  }, [weekOf, mealId]);

  /** Saves a change to one ingredient, or clears it (null). The screen shows it at once; a failure puts the old one back. */
  async function changeIngredient(ingredientId: string, input: IngredientFeedbackInput | null) {
    if (!weekOf || !mealId) return;
    const before = changes[mealId]?.[ingredientId];
    setChangeError(null);
    setChanges((prev) => {
      const next = { ...prev, [mealId]: { ...(prev[mealId] ?? {}) } };
      if (input) next[mealId]![ingredientId] = input.kind === 'replaced' ? { kind: 'replaced', replacement: input.replacement } : { kind: 'skipped' };
      else delete next[mealId]![ingredientId];
      return next;
    });
    try {
      if (input) await saveIngredientFeedback(weekOf, mealId, ingredientId, input);
      else await clearIngredientFeedback(weekOf, mealId, ingredientId);
    } catch (e) {
      setChangeError(errorMessage(e));
      setChanges((prev) => {
        const next = { ...prev, [mealId]: { ...(prev[mealId] ?? {}) } };
        if (before) next[mealId]![ingredientId] = before;
        else delete next[mealId]![ingredientId];
        return next;
      });
    }
  }

  // Read through a ref so a parent re-render does not refocus the close button.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCloseRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A sheet holds the page still behind it, and gives the page back when it closes.
  useEffect(() => {
    if (!sheet) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
    };
  }, [sheet]);

  // Tab goes round the sheet's controls and does not reach the page behind it.
  function keepFocusIn(e: ReactKeyboardEvent<HTMLDivElement>) {
    const root = sheetRef.current;
    if (e.key !== 'Tab' || !root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    const outside = !(active instanceof Node) || !root.contains(active);
    if (e.shiftKey && (active === first || outside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || outside)) {
      e.preventDefault();
      first.focus();
    }
  }

  const cost = meal.cost !== null ? `$${meal.cost.toFixed(2)}` : null;

  const body = (
    <>
        <h2 id="meal-detail-title" className="mt-4 font-display text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-paper">
          {meal.name}
        </h2>
        <p className="mt-2 text-[14px] text-muted">
          {meal.fixed ? 'Fixed meal' : meal.detail}
          {cost && <span> &middot; {cost}</span>}
        </p>

        {meal.leftover && (
          <p className="mt-3 flex items-center gap-2 text-[14px] text-herbLight">
            <ReturnIcon size={16} />
            {meal.leftover.from ? (
              <span>
                Leftovers from <MealLink reference={meal.leftover.from} onOpen={onOpenMeal} />
              </span>
            ) : (
              'Leftovers'
            )}
          </p>
        )}
        {meal.makes && (
          <p className="mt-2 text-[14px] text-muted">
            Makes{' '}
            {meal.makes.map((r, i) => (
              <Fragment key={r.id}>
                {i > 0 && ', '}
                <MealLink reference={r} onOpen={onOpenMeal} />
              </Fragment>
            ))}
          </p>
        )}

        {meal.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {meal.tags.map((t) => (
              <span key={`${t.kind}-${t.text}`} className={`rounded-full border px-2.5 py-1 text-[12px] ${TAG_TONE[t.kind]}`}>
                {t.text}
              </span>
            ))}
          </div>
        )}

        {meal.rateable && (
          <div className="mt-6 grid grid-cols-3 gap-2" role="group" aria-label={`Rate ${meal.name}`}>
            {RATING_OPTIONS.map((opt) => {
              const on = rating === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onRate(opt.value)}
                  className={`h-11 rounded-md border text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-herb ${
                    on ? 'border-herb text-herbLight' : 'border-edge text-muted hover:text-paper'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}
        {ratingError && <p className="mt-3 text-[13px] text-[#D98C7A]">Could not save rating: {ratingError}</p>}

        {onSwap && (
          <button type="button" onClick={onSwap} className="mt-4 flex h-11 items-center justify-center rounded-lg border border-edge text-[14px] text-paper outline-none hover:border-muted focus-visible:ring-2 focus-visible:ring-herb">
            Swap this meal
          </button>
        )}

        {planned && planned.ingredients.length > 0 && (
          <section className="mt-8 border-t border-line pt-4">
            <h3 className="font-display font-semibold tracking-[-0.01em] text-paper text-[20px]">Ingredients</h3>
            <ul className="mt-3">
              {planned.ingredients.map((ing) => {
                const name = INGREDIENT_BY_ID[ing.ingredientId]?.name ?? ing.ingredientId;
                const change = mealId ? changes[mealId]?.[ing.ingredientId] : undefined;
                const open = openIngredient === ing.ingredientId;
                return (
                  <li key={ing.ingredientId} className="border-b border-line2 py-2 text-[14px]">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="min-w-0">
                        <span className={change?.kind === 'skipped' ? 'text-muted line-through' : 'text-paper'}>{name}</span>
                        {change?.kind === 'skipped' && <span className="block text-[12px] text-muted">Skipped</span>}
                        {change?.kind === 'replaced' && (
                          <span className="block text-[12px] text-herbLight">Replaced with {change.replacement}</span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-baseline gap-3">
                        <span className={change?.kind === 'skipped' ? 'text-muted line-through' : 'text-muted'}>
                          {formatCookAmount(ing.ingredientId, ing.qty)}
                        </span>
                        {canChange && (
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-label={`Changes for ${name}`}
                            onClick={() => setOpenIngredient(open ? null : ing.ingredientId)}
                            className="rounded px-1 text-[13px] text-muted underline underline-offset-2 outline-none hover:text-paper focus-visible:ring-2 focus-visible:ring-herb"
                          >
                            Changes
                          </button>
                        )}
                      </span>
                    </div>
                    {canChange && open && (
                      <IngredientChange
                        key={ing.ingredientId}
                        ingredientId={ing.ingredientId}
                        name={name}
                        current={change}
                        onChange={(input) => void changeIngredient(ing.ingredientId, input)}
                        onClear={() => void changeIngredient(ing.ingredientId, null)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
            {changeError && <p className="mt-3 text-[13px] text-[#D98C7A]">{changeError}</p>}
          </section>
        )}

        {!planned && fixedIngredients && fixedIngredients.length > 0 && (
          <section className="mt-8 border-t border-line pt-4">
            <h3 className="font-display font-semibold tracking-[-0.01em] text-paper text-[20px]">Ingredients</h3>
            <ul className="mt-3">
              {fixedIngredients.map((ing, i) => (
                <li key={`${ing.name}-${i}`} className="flex items-baseline justify-between gap-4 border-b border-line2 py-2 text-[14px]">
                  <span className="min-w-0 text-paper">{ing.name}</span>
                  <span className="shrink-0 text-muted">{fixedAmount(ing)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {planned && planned.steps.length > 0 && (
          <section className="mt-8 border-t border-line pt-4">
            <h3 className="font-display font-semibold tracking-[-0.01em] text-paper text-[20px]">Steps</h3>
            <ol className="mt-3 space-y-3">
              {planned.steps.map((step, i) => (
                <li key={i} className="flex gap-3 text-[14px] leading-[1.5] text-paper">
                  <span className="w-5 shrink-0 text-muted">{i + 1}.</span>
                  <span className="min-w-0">{step}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
    </>
  );

  // The phone sheet: a full-screen page with a Back button. Tab stays inside it, and the page behind does not scroll.
  if (sheet) {
    return (
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="meal-detail-title"
        onKeyDown={keepFocusIn}
        className="fixed inset-0 z-30 flex flex-col bg-ink"
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-4 py-3">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex h-11 items-center rounded-md px-2 text-[15px] text-paper outline-none hover:text-herbLight focus-visible:ring-2 focus-visible:ring-herb"
          >
            &larr; Back
          </button>
          <p className="min-w-0 truncate text-[11px] uppercase tracking-[0.14em] text-muted">
            {DAY_LONG[day]} &middot; {SLOT_LABEL[meal.slot]} &middot; {meal.who}
          </p>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-12 pt-6">{body}</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <button type="button" aria-label="Close meal details" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/60" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="meal-detail-title"
        className="relative flex h-full w-[460px] max-w-full flex-col overflow-y-auto border-l border-line bg-ink p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted">
            {DAY_LONG[day]} &middot; {SLOT_LABEL[meal.slot]} &middot; {meal.who}
          </p>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close meal details"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-edge text-[18px] text-muted outline-none hover:text-paper focus-visible:ring-2 focus-visible:ring-herb"
          >
            &times;
          </button>
        </div>

        {body}
      </section>
    </div>
  );
}

/** A fixed-meal ingredient's amount as typed: "250 g", "2 each", "1.5 l". */
export function fixedAmount(ing: { qty: number; unit: string }): string {
  const qty = Number(ing.qty.toFixed(2));
  return ing.unit === 'each' ? `${qty}` : `${qty} ${ing.unit}`;
}

/**
 * The changes menu for one ingredient: used as planned, skipped, or replaced with something the household uses instead.
 * A replacement is free text; catalogue suggestions appear as the name is typed.
 */
function IngredientChange({
  ingredientId,
  name,
  current,
  onChange,
  onClear,
}: {
  ingredientId: string;
  name: string;
  current: { kind: FeedbackKind; replacement?: string } | undefined;
  onChange: (input: IngredientFeedbackInput) => void;
  onClear: () => void;
}) {
  const [replacing, setReplacing] = useState(current?.kind === 'replaced');
  const [text, setText] = useState(current?.replacement ?? '');
  const suggestions = replacing ? searchIngredients(text).filter((i) => i.id !== ingredientId).slice(0, 5) : [];
  const saveText = text.trim();

  const option = (on: boolean) =>
    `h-11 rounded-md border px-3 text-left text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-herb ${
      on ? 'border-herb text-herbLight' : 'border-edge text-paper hover:border-muted'
    }`;

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-line2 p-3" role="group" aria-label={`Changes for ${name}`}>
      <div className="grid grid-cols-3 gap-2">
        <button type="button" aria-pressed={!current} className={option(!current)} onClick={() => { setReplacing(false); onClear(); }}>
          As planned
        </button>
        <button type="button" aria-pressed={current?.kind === 'skipped'} className={option(current?.kind === 'skipped')} onClick={() => { setReplacing(false); onChange({ kind: 'skipped' }); }}>
          Skipped
        </button>
        <button type="button" aria-pressed={replacing} className={option(replacing)} onClick={() => setReplacing(true)}>
          Replaced…
        </button>
      </div>
      {replacing && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              className={fieldCls}
              placeholder="Replace with, e.g. parsley"
              aria-label={`Replacement for ${name}`}
              value={text}
              maxLength={60}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && saveText) {
                  e.preventDefault();
                  onChange({ kind: 'replaced', replacement: saveText });
                }
              }}
            />
            <button
              type="button"
              disabled={!saveText}
              onClick={() => onChange({ kind: 'replaced', replacement: saveText })}
              className="h-11 shrink-0 rounded-md border border-herb px-4 text-[14px] text-herbLight outline-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-herb"
            >
              Save
            </button>
          </div>
          {suggestions.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {suggestions.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => onChange({ kind: 'replaced', replacement: i.name })}
                    className="h-9 rounded-full border border-edge px-3 text-[13px] text-paper outline-none hover:border-muted focus-visible:ring-2 focus-visible:ring-herb"
                  >
                    {i.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function MealLink({ reference, onOpen }: { reference: MealRef; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(reference.id)}
      className="text-paper underline underline-offset-2 hover:text-herbLight"
    >
      {reference.label}
    </button>
  );
}
