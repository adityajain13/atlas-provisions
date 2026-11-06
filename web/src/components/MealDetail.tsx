import { useEffect, useRef } from 'react';
import {
  INGREDIENT_BY_ID,
  DAY_LONG,
  round2,
  unitLabel,
  type Day,
  type PlannedMeal,
  type RatingKind,
} from '@provisions/shared';
import { Fragment } from 'react';
import type { MealRef, ViewMeal, ViewTag } from '../lib/planView';
import { SLOT_LABEL } from '../lib/labels';
import { ReturnIcon } from './Icons';

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
};

/** Desktop side panel with the whole meal: ingredients, steps, tags and the rating buttons. */
export default function MealDetail({ day, meal, planned, rating, ratingError, onRate, onClose, onOpenMeal, onSwap }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
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

  const cost = meal.cost !== null ? `$${meal.cost.toFixed(2)}` : null;

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
              {planned.ingredients.map((ing) => (
                <li key={ing.ingredientId} className="flex items-baseline justify-between gap-4 border-b border-line2 py-2 text-[14px]">
                  <span className="text-paper">{INGREDIENT_BY_ID[ing.ingredientId]?.name ?? ing.ingredientId}</span>
                  <span className="shrink-0 text-muted">
                    {round2(ing.qty)} {unitLabel(ing.unit)}
                  </span>
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
      </section>
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
