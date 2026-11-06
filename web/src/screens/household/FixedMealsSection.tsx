import { useState, type ReactNode } from 'react';
import {
  matchIngredient,
  type CatalogIngredient,
  defaultInputUnit,
  DAYS,
  SLOTS,
  UNITS,
  newId,
  type Day,
  type FixedMeal,
  type Household,
  type Person,
  type Slot,
  type Unit,
} from '@provisions/shared';
import { searchIngredients } from '../../components/IngredientPicker';
import { useConfirm } from '../../components/ConfirmDialog';
import { Disclosure } from '../../components/Disclosure';
import { Section } from '../../components/Section';
import { eyebrow, fieldCls, linkBtn, removeIconBtn } from '../../components/ui';
import { DAY_SHORT, SLOT_LABEL, formatDays } from '../../lib/labels';

import { type Update, ERROR_TEXT } from './ui';

/** The closed row's second line for a fixed meal. With nobody ticked it says so in red, since the meal is not used. */
function fixedMealDetail(m: FixedMeal, people: Person[]): ReactNode {
  const paused = m.active ? '' : 'Paused · ';
  const names = people.filter((p) => m.personIds.includes(p.id)).map((p) => p.name);
  const head = [SLOT_LABEL[m.slot], formatDays(m.days)];
  if (names.length > 0) return `${paused}${[...head, names.join(', ')].join(' · ')}`;
  return (
    <>
      {paused}
      {head.join(' · ')} · <span className={ERROR_TEXT}>No one selected: not used</span>
    </>
  );
}

// ---------- Fixed meals ----------

export function FixedMealsSection({ h, update }: { h: Household; update: Update }) {
  const confirm = useConfirm();
  const [openId, setOpenId] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);

  function toggle(id: string) {
    setFreshId(null);
    setOpenId((cur) => (cur === id ? null : id));
  }

  function addMeal() {
    const id = newId();
    update((prev) => ({
      ...prev,
      fixedMeals: [
        ...prev.fixedMeals,
        {
          id,
          name: 'New meal',
          // Everyone here eats it until they are unticked. A meal with nobody ticked is never used.
          personIds: prev.people.map((p) => p.id),
          days: [],
          slot: 'breakfast',
          ingredients: [],
          active: true,
        },
      ],
    }));
    setOpenId(id);
    setFreshId(id);
  }

  async function removeMeal(m: FixedMeal) {
    if (
      !(await confirm({
        title: `Delete ${m.name}?`,
        message: 'It stops appearing in future plans. Meals already planned for a week are not changed.',
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    setOpenId(null);
    setFreshId(null);
    update((prev) => ({ ...prev, fixedMeals: prev.fixedMeals.filter((x) => x.id !== m.id) }));
  }

  return (
    <Section title="Fixed meals">
      {h.fixedMeals.length === 0 && <p className="text-[14px] text-muted">None yet.</p>}
      <ul>
        {h.fixedMeals.map((m) => (
          <li key={m.id}>
            <Disclosure
              open={openId === m.id}
              onToggle={() => toggle(m.id)}
              title={m.name}
              detail={fixedMealDetail(m, h.people)}
              focusFirstField={freshId === m.id}
              remove={{ label: 'Delete fixed meal', onClick: () => void removeMeal(m) }}
            >
              <FixedMealFields meal={m} people={h.people} update={update} />
            </Disclosure>
          </li>
        ))}
      </ul>
      <button type="button" onClick={addMeal} className={`mt-3 ${linkBtn}`}>
        + Add fixed meal
      </button>
    </Section>
  );
}

function FixedMealFields({ meal, people, update }: { meal: FixedMeal; people: Person[]; update: Update }) {
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
    <>
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
        <span>
          <span className="block text-[15px] text-paper">Active</span>
          <span className="block text-[12px] text-muted">Turn off to leave it out of plans.</span>
        </span>
        <input
          type="checkbox"
          className="h-5 w-5 shrink-0"
          checked={meal.active}
          onChange={(e) => patchMeal({ active: e.target.checked })}
        />
      </label>

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
          {DAYS.map((d) => {
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

      {people.length > 0 && meal.personIds.length === 0 && (
        <p className={`text-[13px] ${ERROR_TEXT}`}>Tick who eats this, or it won&apos;t be used.</p>
      )}

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
              <div className="flex items-start gap-2">
                <IngredientNameField
                  value={ing.name}
                  onChange={(name) => patchIngredient(i, { name })}
                  onPick={(picked) => patchIngredient(i, { name: picked.name, unit: defaultInputUnit(picked.baseUnit) })}
                />
                <button
                  type="button"
                  aria-label={`Remove ${ing.name || 'ingredient'}`}
                  onClick={() => removeIngredient(i)}
                  className={`${removeIconBtn} mt-[6px] shrink-0`}
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

    </>
  );
}

/**
 * A fixed-meal ingredient name. Typing searches the catalogue; picking an entry sets its name. Free text is kept,
 * and a name that matches nothing is marked "Custom item": it goes on the shopping list without a price.
 */
function IngredientNameField({
  value,
  onChange,
  onPick,
}: {
  value: string;
  onChange: (name: string) => void;
  onPick: (picked: CatalogIngredient) => void;
}) {
  const [focused, setFocused] = useState(false);
  const matches = searchIngredients(value);
  const results = focused ? matches : [];
  // Custom only when the catalogue matches nothing: neither the search nor the costing match.
  const custom = value.trim() !== '' && matches.length === 0 && matchIngredient(value) === null;
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <input
          className={fieldCls}
          placeholder="Ingredient"
          aria-label="Ingredient name"
          value={value}
          maxLength={60}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => onChange(e.target.value)}
        />
        {custom && <span className="shrink-0 text-[12px] text-muted">Custom item</span>}
      </div>
      {results.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {results.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                // Keeps focus in the field, so the list stays open until the pick lands.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(i)}
                className="flex h-11 w-full items-center justify-between rounded-md border border-edge px-3 text-left"
              >
                <span className="text-[15px] text-paper">{i.name}</span>
                <span className={eyebrow}>{i.category}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
