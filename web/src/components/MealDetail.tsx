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
import type { MockMeal, MockTag } from '../mocks/week';
import { SLOT_LABEL } from '../lib/labels';

export const RATING_OPTIONS: { value: RatingKind; label: string }[] = [
  { value: 'up', label: 'Liked' },
  { value: 'down', label: 'Not again' },
  { value: 'never', label: 'Never' },
];

export const TAG_TONE: Record<MockTag['kind'], string> = {
  craving: 'border-herb text-herbLight',
  deal: 'border-[#3A3631] text-[#C9C3B8]',
  leftover: 'border-edge text-muted',
};

type Props = {
  day: Day;
  meal: MockMeal;
  // The saved plan's meal, for its ingredients and steps. Absent for sample data and fixed meals.
  planned: PlannedMeal | undefined;
  rating: RatingKind | null;
  ratingError: string | null;
  onRate: (value: RatingKind) => void;
  onClose: () => void;
};

/** Desktop side panel with the whole meal: ingredients, steps, tags and the rating buttons. */
export default function MealDetail({ day, meal, planned, rating, ratingError, onRate, onClose }: Props) {
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

        <h2 id="meal-detail-title" className="mt-4 font-display text-[32px] font-normal leading-[1.15] text-paper">
          {meal.name}
        </h2>
        <p className="mt-2 text-[14px] text-muted">
          {meal.fixed ? 'Fixed meal' : meal.detail}
          {cost && <span> &middot; {cost}</span>}
        </p>

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

        {planned && planned.ingredients.length > 0 && (
          <section className="mt-8 border-t border-line pt-4">
            <h3 className="font-display text-[20px] font-normal text-paper">Ingredients</h3>
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
            <h3 className="font-display text-[20px] font-normal text-paper">Steps</h3>
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
