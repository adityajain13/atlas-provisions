import { useEffect, useState } from 'react';
import type { MealPlan, PrepPlan } from '@provisions/shared';
import { DAY_SHORT } from '../lib/labels';

// Two copies of the checklist can be mounted (phone and desktop layouts). They stay in step through this event.
const CHANGED = 'provisions:prep-changed';

// Which prep steps are ticked is kept per visitor, per week. Storage can be blocked or full, so every
// access is guarded and the checklist still works for the visit when it is.

const storageKey = (weekOf: string) => `provisions:prep:${weekOf}`;

function loadDone(weekOf: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey(weekOf));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveDone(weekOf: string, done: Set<string>): void {
  try {
    window.localStorage.setItem(storageKey(weekOf), JSON.stringify([...done]));
  } catch {
    // Not saved. The ticks still show for this visit.
  }
  try {
    window.dispatchEvent(new CustomEvent(CHANGED, { detail: { weekOf, done: [...done] } }));
  } catch {
    // No event support. The other copy catches up on its next load.
  }
}

/** "Thu dinner" for a planned meal id, or null when the plan has no such meal. */
function mealLabel(plan: MealPlan, id: string): string | null {
  const m = plan.meals.find((x) => x.id === id);
  return m ? `${DAY_SHORT[m.day]} ${m.slot}` : null;
}

/** The batch-prep checklist for the household's prep day, shown above the day's meals. */
export function PrepArticle({ plan, prep, framed = false }: { plan: MealPlan; prep: PrepPlan; framed?: boolean }) {
  const [done, setDone] = useState(() => loadDone(plan.weekOf));

  useEffect(() => {
    const sync = (e: Event) => {
      const detail = (e as CustomEvent<{ weekOf: string; done: string[] }>).detail;
      if (detail?.weekOf === plan.weekOf) setDone(new Set(detail.done));
    };
    window.addEventListener(CHANGED, sync);
    return () => window.removeEventListener(CHANGED, sync);
  }, [plan.weekOf]);

  function toggle(id: string) {
    const next = new Set(done);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDone(next);
    saveDone(plan.weekOf, next);
  }

  return (
    <article className={framed ? 'rounded-lg border border-line2 p-5' : 'border-t border-line pt-4'}>
      <h3 className="font-display font-semibold tracking-[-0.01em] text-paper text-[20px] leading-[1.25]">Prep &middot; {prep.totalMinutes} min</h3>
      <p className="mt-1 text-[12px] text-muted">Saved on this device. Ticks don&apos;t sync between devices.</p>
      {prep.steps.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">Nothing to prep ahead this week.</p>
      ) : (
        <ul className="mt-3 columns-1 gap-x-8 lg:columns-2 2xl:columns-3">
          {prep.steps.map((s) => {
            const ticked = done.has(s.id);
            const serves = s.forMeals.map((id) => mealLabel(plan, id)).filter((x): x is string => x !== null);
            return (
              <li key={s.id} className="break-inside-avoid border-b border-line2 py-2.5">
                <label className="flex cursor-pointer gap-3">
                  <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={ticked} onChange={() => toggle(s.id)} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[15px] ${ticked ? 'text-muted line-through' : 'text-paper'}`}>{s.task}</span>
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
