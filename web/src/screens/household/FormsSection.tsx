import {
  CONTAINER_LABEL,
  CONTAINER_LEVELS,
  FORM_GROUPS,
  FORM_LABEL,
  allowedForms,
  type FormGroupKey,
  type FoodForm,
  type Household,
  type Storage as HouseholdStorage,
} from '@provisions/shared';
import { Section } from '../../components/Section';
import { chipBase, chipTone, eyebrow } from '../../components/ui';

import { type Update } from './ui';

// ---------- Storage I have ----------

export function StorageSection({ h, update }: { h: Household; update: Update }) {
  const storage = h.storage;

  function patch(p: Partial<HouseholdStorage>) {
    update((prev) => ({ ...prev, storage: { ...prev.storage, ...p } }));
  }

  return (
    <Section title="Storage I have" caption="Prep plans only use what you have.">
      <div>
        <span className={eyebrow}>Containers</span>
        <div role="group" aria-label="Containers" className="mt-2 grid grid-cols-4 gap-1 rounded-lg border border-edge p-1">
          {CONTAINER_LEVELS.map((level) => {
            const on = storage.containers === level;
            return (
              <button
                key={level}
                type="button"
                aria-pressed={on}
                onClick={() => patch({ containers: level })}
                className={`h-11 rounded-md text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herb ${
                  on ? 'bg-herb font-medium text-ink' : 'text-muted'
                }`}
              >
                {CONTAINER_LABEL[level]}
              </button>
            );
          })}
        </div>
      </div>

      <ul className="mt-4">
        <li>
          <label className="flex min-h-[48px] cursor-pointer items-center justify-between gap-4 border-b border-line2">
            <span className="text-[15px] text-paper">Freezer space</span>
            <input
              type="checkbox"
              role="switch"
              className="h-5 w-5 shrink-0"
              checked={storage.freezer}
              onChange={(e) => patch({ freezer: e.target.checked })}
            />
          </label>
        </li>
        <li>
          <label className="flex min-h-[48px] cursor-pointer items-center justify-between gap-4 border-b border-line2">
            <span className="text-[15px] text-paper">Ziplock bags</span>
            <input
              type="checkbox"
              role="switch"
              className="h-5 w-5 shrink-0"
              checked={storage.zipBags}
              onChange={(e) => patch({ zipBags: e.target.checked })}
            />
          </label>
        </li>
        <li>
          <label className="flex min-h-[48px] cursor-pointer items-center justify-between gap-4 border-b border-line2">
            <span className="text-[15px] text-paper">Freezer ziplock bags</span>
            <input
              type="checkbox"
              role="switch"
              className="h-5 w-5 shrink-0"
              checked={storage.freezerBags}
              onChange={(e) => patch({ freezerBags: e.target.checked })}
            />
          </label>
        </li>
      </ul>
    </Section>
  );
}

// ---------- Fresh, frozen or canned ----------

export function FormsSection({ h, update }: { h: Household; update: Update }) {
  function toggle(key: FormGroupKey, form: FoodForm) {
    update((prev) => {
      const group = FORM_GROUPS.find((g) => g.key === key);
      if (!group) return prev;
      const current = allowedForms(prev.forms, key);
      const next = current.includes(form) ? current.filter((f) => f !== form) : [...current, form];
      if (next.length === 0) return prev; // at least one form stays on
      return { ...prev, forms: { ...prev.forms, [key]: group.forms.filter((f) => next.includes(f)) } };
    });
  }

  return (
    <Section
      title="Fresh, frozen or canned"
      caption="Foods in a form you don't keep are not planned or bought. At least one form stays on."
    >
      <ul>
        {FORM_GROUPS.map((g) => {
          const kept = allowedForms(h.forms, g.key);
          return (
            <li
              key={g.key}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line2 py-3"
            >
              <span className="text-[15px] text-paper">{g.label}</span>
              <div className="flex flex-wrap gap-2">
                {g.forms.map((f) => {
                  const on = kept.includes(f);
                  return (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={on}
                      aria-label={`${g.label}: ${FORM_LABEL[f]}`}
                      disabled={on && kept.length === 1}
                      onClick={() => toggle(g.key, f)}
                      className={`${chipBase} px-4 ${chipTone(on)} disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      {FORM_LABEL[f]}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
