import { Fragment } from 'react';
import { DAYS, DAY_LONG, SLOTS, type Day, type Household, type Slot } from '@provisions/shared';
import { Section } from '../../components/Section';
import { fieldCls } from '../../components/ui';
import { DAY_SHORT, SLOT_LABEL } from '../../lib/labels';
import { TimeCapGrid } from '../../components/TimeCapGrid';

import { type Update } from './ui';

function isEating(h: Household, personId: string, day: Day, slot: Slot): boolean {
  return h.schedule[personId]?.[day]?.[slot] === true;
}

function setEating(h: Household, personId: string, day: Day, slot: Slot, value: boolean): Household {
  const person = h.schedule[personId] ?? {};
  const dayMap = person[day] ?? {};
  return {
    ...h,
    schedule: { ...h.schedule, [personId]: { ...person, [day]: { ...dayMap, [slot]: value } } },
  };
}

// ---------- Schedule ----------

export function ScheduleSection({ h, update }: { h: Household; update: Update }) {
  return (
    <Section title="Schedule" caption="Default for every week.">
      {h.people.length === 0 && <p className="text-[14px] text-muted">Add people first.</p>}
      {h.people.map((p) => (
        <div key={p.id} className="mb-6">
          <p className="mb-2 text-[14px] text-paper">{p.name}</p>
          <div className="grid grid-cols-[76px_repeat(7,minmax(0,1fr))] gap-1.5">
            <span />
            {DAYS.map((d) => (
              <span key={d} className="text-center text-[11px] text-muted" aria-hidden="true">
                {DAY_SHORT[d]}
              </span>
            ))}
            {SLOTS.map((slot) => (
              <Fragment key={slot}>
                <span className="flex items-center text-[12px] text-muted" aria-hidden="true">
                  {SLOT_LABEL[slot]}
                </span>
                {DAYS.map((day) => {
                  const on = isEating(h, p.id, day, slot);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      aria-label={`${p.name}, ${DAY_LONG[day]} ${SLOT_LABEL[slot].toLowerCase()}`}
                      onClick={() =>
                        update((prev) => setEating(prev, p.id, day, slot, !isEating(prev, p.id, day, slot)))
                      }
                      className={`flex h-10 items-center justify-center rounded-md border ${
                        on ? 'border-chip bg-chip' : 'border-edge'
                      }`}
                    >
                      {on && <span className="h-1.5 w-1.5 rounded-full bg-herb" />}
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      ))}
      <TimeCaps h={h} update={update} />
    </Section>
  );
}

// ---------- Batch prep ----------

export function PrepSection({ h, update }: { h: Household; update: Update }) {
  return (
    <Section title="Batch prep" caption="Each new plan gets a prep list for this day.">
      <label className="flex items-center justify-between gap-4">
        <span className="text-[15px] text-paper">Prep day</span>
        <select
          className={`${fieldCls} w-40`}
          value={h.prepDay ?? 'none'}
          onChange={(e) =>
            update((prev) => ({ ...prev, prepDay: e.target.value === 'none' ? null : (e.target.value as Day) }))
          }
        >
          <option value="none">None</option>
          {DAYS.map((d) => (
            <option key={d} value={d}>
              {DAY_LONG[d]}
            </option>
          ))}
        </select>
      </label>
    </Section>
  );
}

function TimeCaps({ h, update }: { h: Household; update: Update }) {
  return (
    <div className="mt-8 border-t border-line2 pt-4">
      <p className="text-[14px] text-paper">Time caps</p>
      <p className="mt-1 text-[13px] text-muted">
        Busy nights: meals in capped slots stay under that many minutes. Tap a meal, a row or a day to set it.
      </p>
      <TimeCapGrid h={h} update={update} />
    </div>
  );
}
