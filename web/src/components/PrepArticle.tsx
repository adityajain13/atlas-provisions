import type { MealPlan, PrepPlan } from '@provisions/shared';
import { DAY_SHORT } from '../lib/labels';

/** "Thu dinner" for a planned meal id, or null when the plan has no such meal. */
function mealLabel(plan: MealPlan, id: string): string | null {
  const m = plan.meals.find((x) => x.id === id);
  return m ? `${DAY_SHORT[m.day]} ${m.slot}` : null;
}

/** The batch-prep checklist for the household's prep day, shown above the day's meals. Ticks live in the page's shared checks. */
export function PrepArticle({
  plan,
  prep,
  ticked,
  onToggle,
  framed = false,
}: {
  plan: MealPlan;
  prep: PrepPlan;
  ticked: Record<string, boolean>;
  onToggle: (stepId: string) => void;
  framed?: boolean;
}) {
  return (
    <article className={framed ? 'rounded-lg border border-line2 p-5' : 'border-t border-line pt-4'}>
      <h3 className="font-display font-semibold tracking-[-0.01em] text-paper text-[20px] leading-[1.25]">Prep &middot; {prep.totalMinutes} min</h3>
      <p className="mt-1 text-[12px] text-muted">Shared with everyone in your household.</p>
      {prep.steps.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">Nothing to prep ahead this week.</p>
      ) : (
        <ul className="mt-3 columns-1 gap-x-8 lg:columns-2 2xl:columns-3">
          {prep.steps.map((s) => {
            const done = ticked[s.id] === true;
            const serves = s.forMeals.map((id) => mealLabel(plan, id)).filter((x): x is string => x !== null);
            return (
              <li key={s.id} className="break-inside-avoid border-b border-line2 py-2.5">
                <label className="flex cursor-pointer gap-3">
                  <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={done} onChange={() => onToggle(s.id)} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[15px] ${done ? 'text-muted line-through' : 'text-paper'}`}>{s.task}</span>
                    <span className="block text-[13px] text-muted">
                      {s.minutes} min{serves.length > 0 && ` · for ${serves.join(', ')}`}
                    </span>
                    {s.storage && <span className="block text-[12px] text-muted">{s.storage}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
