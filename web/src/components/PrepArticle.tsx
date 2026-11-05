import { storageSentence, type Day, type MealPlan, type PrepPlan, type PrepStep } from '@provisions/shared';
import { DAY_SHORT } from '../lib/labels';
import { prepAnchor, prepGroups, stepsOnDay, type PrepGroup } from '../lib/prepView';

/** "Thu dinner" for a planned meal id, or null when the plan has no such meal. */
function mealLabel(plan: MealPlan, id: string): string | null {
  const m = plan.meals.find((x) => x.id === id);
  return m ? `${DAY_SHORT[m.day]} ${m.slot}` : null;
}

type Ticks = Record<string, boolean>;

/** One step: its tick, the task, when and what for, where it is kept, and how to split it. Ids stay stable for ticks. */
function StepRow({
  plan,
  step,
  ticked,
  onToggle,
  showTime,
}: {
  plan: MealPlan;
  step: PrepStep;
  ticked: Ticks;
  onToggle: (stepId: string) => void;
  showTime: boolean;
}) {
  const done = ticked[step.id] === true;
  const serves = step.forMeals.map((id) => mealLabel(plan, id)).filter((x): x is string => x !== null);
  const when = showTime && step.time ? `${step.time[0]!.toUpperCase()}${step.time.slice(1)} · ` : '';
  return (
    <li className="break-inside-avoid border-b border-line2 py-2.5">
      <label className="flex cursor-pointer gap-3">
        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={done} onChange={() => onToggle(step.id)} />
        <span className="min-w-0 flex-1">
          <span className={`block text-[15px] ${done ? 'text-muted line-through' : 'text-paper'}`}>{step.task}</span>
          <span className="block text-[13px] text-muted">
            {when}
            {step.minutes} min{serves.length > 0 && ` · for ${serves.join(', ')}`}
          </span>
          {step.storage && <span className="block text-[12px] text-muted">{storageSentence(step.storage)}</span>}
          {step.useNote && <span className="block text-[12px] text-paper/80">{step.useNote}</span>}
        </span>
      </label>
    </li>
  );
}

function GroupBlock({
  plan,
  group,
  ticked,
  onToggle,
}: {
  plan: MealPlan;
  group: PrepGroup;
  ticked: Ticks;
  onToggle: (stepId: string) => void;
}) {
  return (
    <div className="mb-5 last:mb-0">
      <p className="text-[13px] font-medium text-paper">{group.label}</p>
      <ul className="mt-1.5">
        {group.steps.map((s) => (
          <StepRow key={s.id} plan={plan} step={s} ticked={ticked} onToggle={onToggle} showTime={false} />
        ))}
      </ul>
    </div>
  );
}

/** The desktop prep card, under the week grid: one column per day, grouped by time within it. */
export function PrepBoard({
  plan,
  prep,
  ticked,
  onToggle,
}: {
  plan: MealPlan;
  prep: PrepPlan;
  ticked: Ticks;
  onToggle: (stepId: string) => void;
}) {
  const groups = prepGroups(prep);
  const days = [...new Set(groups.map((g) => g.day))];

  return (
    <article className="rounded-lg border border-line2 p-5">
      <h3 className="font-display font-semibold tracking-[-0.01em] text-paper text-[20px] leading-[1.25]">
        Prep &middot; {prep.totalMinutes} min
      </h3>
      <p className="mt-1 text-[12px] text-muted">Shared with everyone in your household.</p>
      {groups.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">Nothing to prep ahead this week.</p>
      ) : (
        <div
          className="mt-5 grid gap-x-8 gap-y-6"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}
        >
          {days.map((day) => (
            <section key={day} id={prepAnchor(day)} className="min-w-0 scroll-mt-6">
              {groups
                .filter((g) => g.day === day)
                .map((g) => (
                  <GroupBlock key={g.key} plan={plan} group={g} ticked={ticked} onToggle={onToggle} />
                ))}
            </section>
          ))}
        </div>
      )}
    </article>
  );
}

/** The phone prep list for the day on screen, shown above that day's meals. */
export function PrepToday({
  plan,
  prep,
  day,
  heading,
  ticked,
  onToggle,
}: {
  plan: MealPlan;
  prep: PrepPlan;
  day: Day;
  heading: string;
  ticked: Ticks;
  onToggle: (stepId: string) => void;
}) {
  const steps = stepsOnDay(prep, day);
  if (steps.length === 0) return null;
  const minutes = steps.reduce((sum, s) => sum + s.minutes, 0);
  return (
    <article className="border-t border-line pt-4">
      <h3 className="font-display font-semibold tracking-[-0.01em] text-paper text-[20px] leading-[1.25]">
        {heading} <span className="text-[14px] font-normal text-muted">&middot; {minutes} min</span>
      </h3>
      <ul className="mt-3">
        {steps.map((s) => (
          <StepRow key={s.id} plan={plan} step={s} ticked={ticked} onToggle={onToggle} showTime />
        ))}
      </ul>
    </article>
  );
}
