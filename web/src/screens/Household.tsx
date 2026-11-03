import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  ALLERGEN_PRESETS,
  DAYS,
  HouseholdSchema,
  SLOTS,
  UNITS,
  VARIETY_RULES,
  newId,
  type Day,
  type FixedMeal,
  type Household,
  type ItemRule,
  type Person,
  type Slot,
  type Unit,
} from '@provisions/shared';
import { errorMessage, getHousehold, saveHousehold } from '../api';
import { Header } from '../components/Header';
import { Page } from '../components/Page';
import { Section } from '../components/Section';
import {
  addBtn,
  chipBase,
  chipTone,
  eyebrow,
  fieldCls,
  linkBtn,
  removeIconBtn,
  secondaryBtn,
} from '../components/ui';
import { DAY_LETTER, DAY_SHORT, SLOT_LABEL, SLOT_LETTER, formatDays } from '../lib/labels';

type Update = (fn: (prev: Household) => Household) => void;
type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

const ERROR_TEXT = 'text-[#D98C7A]';

// ---------- screen: loads, holds state, autosaves ----------

export default function HouseholdScreen() {
  const [h, setH] = useState<Household | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  // Only user edits trigger a save. Loading the document does not.
  const edited = useRef(false);
  const seq = useRef(0);

  useEffect(() => {
    let alive = true;
    getHousehold()
      .then((d) => {
        if (alive) setH(d);
      })
      .catch((e: unknown) => {
        if (alive) setLoadError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!h || !edited.current) return;
    const mine = ++seq.current;

    const parsed = HouseholdSchema.safeParse(h);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setSave({ kind: 'error', message: first ? first.message : 'Check the fields' });
      return;
    }

    setSave({ kind: 'saving' });
    const timer = window.setTimeout(() => {
      saveHousehold(parsed.data)
        .then(() => {
          if (mine === seq.current) setSave({ kind: 'saved' });
        })
        .catch((e: unknown) => {
          if (mine === seq.current) setSave({ kind: 'error', message: errorMessage(e) });
        });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [h]);

  const update = useCallback<Update>((fn) => {
    edited.current = true;
    setH((prev) => (prev ? fn(prev) : prev));
  }, []);

  return (
    <Page>
      <Header title="Household" />
      <StatusLine save={save} loading={!h && !loadError} />

      {loadError && <p className={`mt-6 text-[14px] ${ERROR_TEXT}`}>Could not load: {loadError}</p>}

      {h && (
        <>
          <PeopleSection h={h} update={update} />
          <ScheduleSection h={h} update={update} />
          <FixedMealsSection h={h} update={update} />
          <AllergiesSection h={h} />
          <EquipmentSection h={h} update={update} />
          <VarietySection h={h} update={update} />
          <StoresSection h={h} update={update} />
          <ItemRulesSection h={h} update={update} />
        </>
      )}
    </Page>
  );
}

function StatusLine({ save, loading }: { save: SaveState; loading: boolean }) {
  let text: ReactNode = '';
  let tone = 'text-muted';
  if (loading) text = 'Loading…';
  else if (save.kind === 'saving') text = 'Saving…';
  else if (save.kind === 'saved') text = 'Saved';
  else if (save.kind === 'error') {
    text = `Not saved: ${save.message}`;
    tone = ERROR_TEXT;
  }
  return (
    <p className={`mt-2 min-h-[20px] text-[13px] ${tone}`} aria-live="polite">
      {text}
    </p>
  );
}

// ---------- helpers ----------

function countMeals(h: Household, personId: string): number {
  let n = 0;
  for (const d of DAYS) for (const s of SLOTS) if (h.schedule[personId]?.[d]?.[s] === true) n++;
  return n;
}

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

function allOn(): Record<string, Record<string, boolean>> {
  return Object.fromEntries(DAYS.map((d) => [d, Object.fromEntries(SLOTS.map((s) => [s, true]))]));
}

function fixedMealSummary(m: FixedMeal, people: Person[]): string {
  const names = people.filter((p) => m.personIds.includes(p.id)).map((p) => p.name);
  return [SLOT_LABEL[m.slot], formatDays(m.days), names.length ? names.join(', ') : 'No one'].join(
    ' · ',
  );
}

function readableCount(n: number): string {
  return `${n} ${n === 1 ? 'meal' : 'meals'} a week`;
}

// ---------- People ----------

function PeopleSection({ h, update }: { h: Household; update: Update }) {
  const [openId, setOpenId] = useState<string | null>(null);

  function addPerson() {
    const id = newId();
    update((prev) => ({
      ...prev,
      people: [...prev.people, { id, name: 'New person', dietTags: [], allergies: [] }],
      schedule: { ...prev.schedule, [id]: allOn() },
    }));
    setOpenId(id);
  }

  function removePerson(p: Person) {
    if (!window.confirm(`Remove ${p.name}?`)) return;
    setOpenId(null);
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
        {h.people.map((p) => {
          const open = openId === p.id;
          return (
            <li key={p.id} className="border-b border-line2">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : p.id)}
                className="flex min-h-[48px] w-full items-center justify-between gap-3 py-3 text-left"
              >
                <span className="text-[16px] text-paper">{p.name}</span>
                <span className="shrink-0 text-[13px] text-muted">{readableCount(countMeals(h, p.id))}</span>
              </button>
              {open && <PersonEditor person={p} update={update} onRemove={() => removePerson(p)} />}
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={addPerson} className={`mt-3 ${linkBtn}`}>
        + Add person
      </button>
    </Section>
  );
}

function PersonEditor({ person, update, onRemove }: { person: Person; update: Update; onRemove: () => void }) {
  const [custom, setCustom] = useState('');

  function patch(p: Partial<Person>) {
    update((prev) => ({
      ...prev,
      people: prev.people.map((x) => (x.id === person.id ? { ...x, ...p } : x)),
    }));
  }

  function toggleAllergy(a: string) {
    patch({
      allergies: person.allergies.includes(a)
        ? person.allergies.filter((x) => x !== a)
        : [...person.allergies, a],
    });
  }

  function addCustom() {
    const v = custom.trim().toLowerCase();
    setCustom('');
    if (!v || person.allergies.includes(v)) return;
    patch({ allergies: [...person.allergies, v] });
  }

  const customs = person.allergies.filter((a) => !ALLERGEN_PRESETS.includes(a));

  return (
    <div className="space-y-6 pb-5 pt-4">
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

      <button
        type="button"
        onClick={() => {
          if (window.confirm(`Remove ${person.name}?`)) onRemove();
        }}
        className={secondaryBtn}
      >
        Remove person
      </button>
    </div>
  );
}

// ---------- Schedule ----------

function ScheduleSection({ h, update }: { h: Household; update: Update }) {
  return (
    <Section title="Schedule" caption="Default for every week.">
      {h.people.length === 0 && <p className="text-[14px] text-muted">Add people first.</p>}
      {h.people.map((p) => (
        <div key={p.id} className="mb-6">
          <p className="mb-2 text-[14px] text-paper">{p.name}</p>
          <div className="grid grid-cols-[28px_repeat(7,minmax(0,1fr))] gap-1.5">
            <span />
            {DAYS.map((d) => (
              <span key={d} className="text-center text-[11px] text-muted" aria-hidden="true">
                {DAY_LETTER[d]}
              </span>
            ))}
            {SLOTS.map((slot) => (
              <Fragment key={slot}>
                <span className="flex items-center text-[11px] text-muted" aria-hidden="true">
                  {SLOT_LETTER[slot]}
                </span>
                {DAYS.map((day) => {
                  const on = isEating(h, p.id, day, slot);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      aria-label={`${p.name}, ${SLOT_LABEL[slot]}, ${DAY_SHORT[day]}`}
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
    </Section>
  );
}

// ---------- Fixed meals ----------

function FixedMealsSection({ h, update }: { h: Household; update: Update }) {
  const [openId, setOpenId] = useState<string | null>(null);

  function addMeal() {
    const id = newId();
    update((prev) => ({
      ...prev,
      fixedMeals: [
        ...prev.fixedMeals,
        { id, name: 'New meal', personIds: [], days: [], slot: 'breakfast', ingredients: [], active: true },
      ],
    }));
    setOpenId(id);
  }

  return (
    <Section title="Fixed meals">
      {h.fixedMeals.length === 0 && <p className="text-[14px] text-muted">None yet.</p>}
      <ul>
        {h.fixedMeals.map((m) => {
          const open = openId === m.id;
          return (
            <li key={m.id} className="border-b border-line2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : m.id)}
                  className="flex min-h-[48px] min-w-0 flex-1 flex-col justify-center py-2 text-left"
                >
                  <span className="text-[16px] text-paper">{m.name}</span>
                  <span className="truncate text-[13px] text-muted">{fixedMealSummary(m, h.people)}</span>
                </button>
                <label className="flex min-h-[44px] shrink-0 items-center gap-2 text-[13px] text-muted">
                  Active
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={m.active}
                    onChange={(e) =>
                      update((prev) => ({
                        ...prev,
                        fixedMeals: prev.fixedMeals.map((x) =>
                          x.id === m.id ? { ...x, active: e.target.checked } : x,
                        ),
                      }))
                    }
                  />
                </label>
              </div>
              {open && (
                <FixedMealEditor
                  meal={m}
                  people={h.people}
                  update={update}
                  onRemove={() => {
                    setOpenId(null);
                    update((prev) => ({ ...prev, fixedMeals: prev.fixedMeals.filter((x) => x.id !== m.id) }));
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={addMeal} className={`mt-3 ${linkBtn}`}>
        + Add fixed meal
      </button>
    </Section>
  );
}

function FixedMealEditor({
  meal,
  people,
  update,
  onRemove,
}: {
  meal: FixedMeal;
  people: Person[];
  update: Update;
  onRemove: () => void;
}) {
  function patchMeal(p: Partial<FixedMeal>) {
    update((prev) => ({
      ...prev,
      fixedMeals: prev.fixedMeals.map((x) => (x.id === meal.id ? { ...x, ...p } : x)),
    }));
  }

  function toggleDay(d: Day) {
    patchMeal({ days: meal.days.includes(d) ? meal.days.filter((x) => x !== d) : [...meal.days, d] });
  }

  function togglePerson(id: string) {
    patchMeal({
      personIds: meal.personIds.includes(id)
        ? meal.personIds.filter((x) => x !== id)
        : [...meal.personIds, id],
    });
  }

  function patchIngredient(i: number, p: Partial<FixedMeal['ingredients'][number]>) {
    update((prev) => ({
      ...prev,
      fixedMeals: prev.fixedMeals.map((x) =>
        x.id === meal.id
          ? { ...x, ingredients: x.ingredients.map((ing, j) => (j === i ? { ...ing, ...p } : ing)) }
          : x,
      ),
    }));
  }

  function removeIngredient(i: number) {
    patchMeal({ ingredients: meal.ingredients.filter((_, j) => j !== i) });
  }

  return (
    <div className="space-y-6 pb-5 pt-4">
      <label className="block">
        <span className={eyebrow}>Name</span>
        <input
          className={`${fieldCls} mt-2`}
          value={meal.name}
          maxLength={80}
          onChange={(e) => patchMeal({ name: e.target.value })}
        />
      </label>

      <label className="block">
        <span className={eyebrow}>Slot</span>
        <select
          className={`${fieldCls} mt-2`}
          value={meal.slot}
          onChange={(e) => patchMeal({ slot: e.target.value as Slot })}
        >
          {SLOTS.map((s) => (
            <option key={s} value={s}>
              {SLOT_LABEL[s]}
            </option>
          ))}
        </select>
      </label>

      <div>
        <span className={eyebrow}>Days</span>
        <div className="mt-2 flex gap-1.5">
          {(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as Day[]).map((d) => {
            const on = meal.days.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDay(d)}
                className={`h-11 min-w-0 flex-1 rounded-md border text-[12px] ${
                  on ? 'border-herb bg-herb font-medium text-ink' : 'border-edge text-muted'
                }`}
              >
                {DAY_SHORT[d]}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <span className={eyebrow}>Who</span>
        {people.length === 0 ? (
          <p className="mt-2 text-[14px] text-muted">Add people first.</p>
        ) : (
          <ul className="mt-2">
            {people.map((p) => (
              <li key={p.id}>
                <label className="flex min-h-[44px] cursor-pointer items-center justify-between">
                  <span className="text-[15px] text-paper">{p.name}</span>
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={meal.personIds.includes(p.id)}
                    onChange={() => togglePerson(p.id)}
                  />
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <span className={eyebrow}>Ingredients</span>
        <ul className="mt-2 space-y-4">
          {meal.ingredients.map((ing, i) => (
            <li key={i} className="space-y-2">
              <div className="flex gap-2">
                <input
                  className={fieldCls}
                  placeholder="Ingredient"
                  aria-label="Ingredient name"
                  value={ing.name}
                  maxLength={60}
                  onChange={(e) => patchIngredient(i, { name: e.target.value })}
                />
                <button
                  type="button"
                  aria-label={`Remove ${ing.name || 'ingredient'}`}
                  onClick={() => removeIngredient(i)}
                  className={removeIconBtn}
                >
                  &times;
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  aria-label="Quantity"
                  className={`${fieldCls} w-28`}
                  value={ing.qty}
                  onChange={(e) => patchIngredient(i, { qty: Number(e.target.value) })}
                />
                <select
                  aria-label="Unit"
                  className={`${fieldCls} w-28`}
                  value={ing.unit}
                  onChange={(e) => patchIngredient(i, { unit: e.target.value as Unit })}
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => patchMeal({ ingredients: [...meal.ingredients, { name: '', qty: 0, unit: 'g' }] })}
          className={`mt-3 ${linkBtn}`}
        >
          + Add ingredient
        </button>
      </div>

      <button
        type="button"
        onClick={() => {
          if (window.confirm(`Delete ${meal.name}?`)) onRemove();
        }}
        className={secondaryBtn}
      >
        Delete fixed meal
      </button>
    </div>
  );
}

// ---------- Allergies (read-only summary) ----------

function AllergiesSection({ h }: { h: Household }) {
  return (
    <Section title="Allergies" caption="Hard block. A plan with these is never shown.">
      {h.people.length === 0 && <p className="text-[14px] text-muted">Add people first.</p>}
      <ul>
        {h.people.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 border-b border-line2 py-3">
            <span className="mr-2 min-w-[72px] text-[15px] text-paper">{p.name}</span>
            {p.allergies.length === 0 ? (
              <span className="text-[13px] text-muted">None</span>
            ) : (
              p.allergies.map((a) => (
                <span key={a} className="rounded-full border border-herb px-3 py-1 text-[13px] text-herbLight">
                  {a}
                </span>
              ))
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------- Equipment ----------

function EquipmentSection({ h, update }: { h: Household; update: Update }) {
  const [text, setText] = useState('');

  function add() {
    const name = text.trim();
    setText('');
    if (!name) return;
    update((prev) => {
      if (prev.equipment.some((e) => e.name.toLowerCase() === name.toLowerCase())) return prev;
      return {
        ...prev,
        equipment: [...prev.equipment, { id: newId(), name, owned: true, builtin: false }],
      };
    });
  }

  return (
    <Section title="Equipment">
      <ul className="grid grid-cols-2 gap-x-4">
        {h.equipment.map((e) => (
          <li key={e.id} className="flex min-h-[48px] items-center justify-between gap-1 border-b border-line2">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0"
                checked={e.owned}
                onChange={(ev) =>
                  update((prev) => ({
                    ...prev,
                    equipment: prev.equipment.map((x) => (x.id === e.id ? { ...x, owned: ev.target.checked } : x)),
                  }))
                }
              />
              <span className="truncate text-[14px] text-paper">{e.name}</span>
            </label>
            <button
              type="button"
              aria-label={`Remove ${e.name}`}
              onClick={() =>
                update((prev) => ({ ...prev, equipment: prev.equipment.filter((x) => x.id !== e.id) }))
              }
              className={removeIconBtn}
            >
              &times;
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2">
        <input
          className={fieldCls}
          placeholder="Add equipment"
          aria-label="Add equipment"
          value={text}
          maxLength={40}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" onClick={add} className={addBtn}>
          Add
        </button>
      </div>
    </Section>
  );
}

// ---------- Variety rules ----------

function VarietySection({ h, update }: { h: Household; update: Update }) {
  return (
    <Section title="Variety rules" caption="All optional.">
      <ul>
        {VARIETY_RULES.map((r) => (
          <li key={r.key}>
            <label className="flex min-h-[48px] cursor-pointer items-center justify-between gap-4 border-b border-line2">
              <span className="text-[15px] text-paper">{r.label}</span>
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0"
                checked={h.varietyRules[r.key] === true}
                onChange={(e) =>
                  update((prev) => ({
                    ...prev,
                    varietyRules: { ...prev.varietyRules, [r.key]: e.target.checked },
                  }))
                }
              />
            </label>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------- Stores ----------

function StoresSection({ h, update }: { h: Household; update: Update }) {
  function setMax(n: number) {
    update((prev) => ({ ...prev, maxStores: Math.min(5, Math.max(1, n)) }));
  }

  return (
    <Section title="Stores">
      <ul>
        {h.stores.map((s) => (
          <li key={s.id}>
            <label className="flex min-h-[48px] cursor-pointer items-center justify-between gap-4 border-b border-line2">
              <span className="flex flex-col">
                <span className="text-[15px] text-paper">{s.name}</span>
                {s.priceMatches && <span className="text-[12px] text-muted">Price-matches</span>}
              </span>
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0"
                checked={s.enabled}
                onChange={(e) =>
                  update((prev) => ({
                    ...prev,
                    stores: prev.stores.map((x) => (x.id === s.id ? { ...x, enabled: e.target.checked } : x)),
                  }))
                }
              />
            </label>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex items-center justify-between">
        <span className="text-[15px] text-paper">Max stores per trip</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Fewer stores"
            disabled={h.maxStores <= 1}
            onClick={() => setMax(h.maxStores - 1)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-edge text-[18px] text-paper disabled:opacity-40"
          >
            &minus;
          </button>
          <span className="w-6 text-center font-display text-[18px] text-paper">{h.maxStores}</span>
          <button
            type="button"
            aria-label="More stores"
            disabled={h.maxStores >= 5}
            onClick={() => setMax(h.maxStores + 1)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-edge text-[18px] text-paper disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>
    </Section>
  );
}

// ---------- Always / never buy ----------

function ItemRulesSection({ h, update }: { h: Household; update: Update }) {
  return (
    <Section title="Always / never buy">
      <RuleList title="Always buy" rule="always" h={h} update={update} />
      <div className="mt-6">
        <RuleList title="Never buy" rule="never" h={h} update={update} />
      </div>
    </Section>
  );
}

function RuleList({
  title,
  rule,
  h,
  update,
}: {
  title: string;
  rule: ItemRule['rule'];
  h: Household;
  update: Update;
}) {
  const [text, setText] = useState('');
  const items = h.itemRules.filter((r) => r.rule === rule);

  function add() {
    const name = text.trim();
    setText('');
    if (!name) return;
    update((prev) => {
      if (prev.itemRules.some((r) => r.name.toLowerCase() === name.toLowerCase())) return prev;
      return { ...prev, itemRules: [...prev.itemRules, { id: newId(), name, rule }] };
    });
  }

  return (
    <div>
      <p className={eyebrow}>{title}</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item.id} className={`${chipBase} gap-1 border-edge pl-4 pr-1 text-paper`}>
            {item.name}
            <button
              type="button"
              aria-label={`Remove ${item.name}`}
              onClick={() =>
                update((prev) => ({ ...prev, itemRules: prev.itemRules.filter((r) => r.id !== item.id) }))
              }
              className={removeIconBtn}
            >
              &times;
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <input
          className={fieldCls}
          placeholder={rule === 'always' ? 'Add an always-buy item' : 'Add a never-buy item'}
          aria-label={title}
          value={text}
          maxLength={60}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" onClick={add} className={addBtn}>
          Add
        </button>
      </div>
    </div>
  );
}
