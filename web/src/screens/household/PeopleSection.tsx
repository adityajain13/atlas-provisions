import { useState, type KeyboardEvent } from 'react';
import { ALLERGEN_PRESETS, DAYS, SLOTS, newId, type Household, type Person } from '@provisions/shared';
import { useConfirm } from '../../components/ConfirmDialog';
import { Disclosure } from '../../components/Disclosure';
import { Section } from '../../components/Section';
import { addBtn, chipBase, chipTone, eyebrow, fieldCls, linkBtn, removeIconBtn } from '../../components/ui';

import { type Update } from './ui';

// ---------- helpers ----------

function countMeals(h: Household, personId: string): number {
  let n = 0;
  for (const d of DAYS) for (const s of SLOTS) if (h.schedule[personId]?.[d]?.[s] === true) n++;
  return n;
}

function allOn(): Record<string, Record<string, boolean>> {
  return Object.fromEntries(DAYS.map((d) => [d, Object.fromEntries(SLOTS.map((s) => [s, true]))]));
}

function readableCount(n: number): string {
  return `${n} ${n === 1 ? 'meal' : 'meals'} a week`;
}

// ---------- People ----------

export function PeopleSection({ h, update }: { h: Household; update: Update }) {
  const confirm = useConfirm();
  const [openId, setOpenId] = useState<string | null>(null);
  // The row added last, so its name field takes focus when it opens. Cleared on any toggle.
  const [freshId, setFreshId] = useState<string | null>(null);

  function toggle(id: string) {
    setFreshId(null);
    setOpenId((cur) => (cur === id ? null : id));
  }

  function addPerson() {
    const id = newId();
    update((prev) => ({
      ...prev,
      people: [...prev.people, { id, name: 'New person', dietTags: [], allergies: [] }],
      schedule: { ...prev.schedule, [id]: allOn() },
    }));
    setOpenId(id);
    setFreshId(id);
  }

  async function removePerson(p: Person) {
    if (
      !(await confirm({
        title: `Remove ${p.name}?`,
        message: 'Their schedule, allergies and fixed-meal assignments are removed too.',
        confirmLabel: 'Remove',
        danger: true,
      }))
    )
      return;
    setOpenId(null);
    setFreshId(null);
    update((prev) => {
      const schedule = { ...prev.schedule };
      delete schedule[p.id];
      return {
        ...prev,
        people: prev.people.filter((x) => x.id !== p.id),
        schedule,
        fixedMeals: prev.fixedMeals.map((m) => ({
          ...m,
          personIds: m.personIds.filter((id) => id !== p.id),
        })),
      };
    });
  }

  return (
    <Section title="People">
      {h.people.length === 0 && <p className="text-[14px] text-muted">No one yet.</p>}
      <ul>
        {h.people.map((p) => (
          <li key={p.id}>
            <Disclosure
              open={openId === p.id}
              onToggle={() => toggle(p.id)}
              title={p.name}
              summary={readableCount(countMeals(h, p.id))}
              focusFirstField={freshId === p.id}
              remove={{ label: 'Remove person', onClick: () => void removePerson(p) }}
            >
              <PersonFields person={p} update={update} />
            </Disclosure>
          </li>
        ))}
      </ul>
      <button type="button" onClick={addPerson} className={`mt-3 ${linkBtn}`}>
        + Add person
      </button>
    </Section>
  );
}

function PersonFields({ person, update }: { person: Person; update: Update }) {
  function patch(p: Partial<Person>) {
    update((prev) => ({
      ...prev,
      people: prev.people.map((x) => (x.id === person.id ? { ...x, ...p } : x)),
    }));
  }

  return (
    <>
      <label className="block">
        <span className={eyebrow}>Name</span>
        <input
          className={`${fieldCls} mt-2`}
          value={person.name}
          maxLength={40}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </label>

      <label className="block">
        <span className={eyebrow}>Protein target (g/day, optional)</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          className={`${fieldCls} mt-2`}
          value={person.proteinTargetG ?? ''}
          onChange={(e) =>
            patch({ proteinTargetG: e.target.value === '' ? undefined : Number(e.target.value) })
          }
        />
      </label>

      <AllergyFields person={person} update={update} />

    </>
  );
}

/**
 * One person's allergies: the preset chips, any others typed in, and the box to add one. A plan with these is
 * never shown. Used by the Household page and the setup wizard.
 */
export function AllergyFields({ person, update }: { person: Person; update: Update }) {
  const [custom, setCustom] = useState('');

  function setAllergies(allergies: string[]) {
    update((prev) => ({
      ...prev,
      people: prev.people.map((x) => (x.id === person.id ? { ...x, allergies } : x)),
    }));
  }

  function toggleAllergy(a: string) {
    setAllergies(person.allergies.includes(a) ? person.allergies.filter((x) => x !== a) : [...person.allergies, a]);
  }

  function addCustom() {
    const v = custom.trim().toLowerCase();
    setCustom('');
    if (!v || person.allergies.includes(v)) return;
    setAllergies([...person.allergies, v]);
  }

  const customs = person.allergies.filter((a) => !ALLERGEN_PRESETS.includes(a));

  return (
    <>
      <div>
        <span className={eyebrow}>Allergies</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {ALLERGEN_PRESETS.map((a) => {
            const on = person.allergies.includes(a);
            return (
              <button
                key={a}
                type="button"
                aria-pressed={on}
                onClick={() => toggleAllergy(a)}
                className={`${chipBase} px-4 ${chipTone(on)}`}
              >
                {a}
              </button>
            );
          })}
          {customs.map((a) => (
            <span key={a} className={`${chipBase} gap-1 border-herb pl-4 pr-1 text-herbLight`}>
              {a}
              <button
                type="button"
                aria-label={`Remove ${a}`}
                onClick={() => toggleAllergy(a)}
                className={removeIconBtn}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            className={fieldCls}
            placeholder="Other allergen"
            value={custom}
            maxLength={40}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustom();
              }
            }}
          />
          <button type="button" onClick={addCustom} className={addBtn}>
            Add
          </button>
        </div>
      </div>
    </>
  );
}
