import { useState } from 'react';
import { CUISINES, INGREDIENT_BY_ID, cuisineLevel, type CuisineLevel, type Household } from '@provisions/shared';
import { IngredientPicker } from '../../components/IngredientPicker';
import { Disclosure } from '../../components/Disclosure';
import { Section } from '../../components/Section';
import { chipBase, eyebrow, removeIconBtn } from '../../components/ui';

import { type Update } from './ui';

// ---------- Spice rack & staples I keep ----------

/** The staples the household keeps stocked, grouped by cuisine, and any other catalogue item it adds. Free in plans. */
export function SpiceRackSection({ h, update }: { h: Household; update: Update }) {
  const kept = new Set(h.onHand);
  const pantryIds = new Set(CUISINES.flatMap((c) => c.pantry));
  const others = h.onHand.filter((id) => !pantryIds.has(id) && INGREDIENT_BY_ID[id]);
  // Cuisines the household eats often are listed first. All start closed.
  const order = [...CUISINES].sort((a, b) => LEVEL_RANK[cuisineLevel(h.cuisines, a.key)] - LEVEL_RANK[cuisineLevel(h.cuisines, b.key)]);
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());

  function toggleOpen(key: string) {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setKept(id: string, on: boolean) {
    update((prev) => {
      if (on === prev.onHand.includes(id)) return prev;
      return { ...prev, onHand: on ? [...prev.onHand, id] : prev.onHand.filter((x) => x !== id) };
    });
  }

  function addCustom(name: string) {
    update((prev) => {
      if (prev.onHandCustom.some((x) => x.toLowerCase() === name.toLowerCase())) return prev;
      return { ...prev, onHandCustom: [...prev.onHandCustom, name] };
    });
  }

  function removeCustom(name: string) {
    update((prev) => ({ ...prev, onHandCustom: prev.onHandCustom.filter((x) => x !== name) }));
  }

  return (
    <Section title="Spice rack & staples I keep" caption="Things you keep stocked. Plans can use them freely and they never go on the shopping list.">
      <ul>
        {order.map((c) => {
          const keptHere = c.pantry.filter((id) => kept.has(id)).length;
          const open = openKeys.has(c.key);
          return (
            <li key={c.key}>
              <Disclosure
                open={open}
                onToggle={() => toggleOpen(c.key)}
                title={c.label}
                summary={`${keptHere} of ${c.pantry.length} kept`}
              >
                <ul className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  {c.pantry.map((id) => (
                    <li key={id}>
                      <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          className="h-5 w-5 shrink-0"
                          checked={kept.has(id)}
                          onChange={(e) => setKept(id, e.target.checked)}
                        />
                        <span className="text-[15px] text-paper">{INGREDIENT_BY_ID[id]?.name ?? id}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            </li>
          );
        })}
      </ul>

      <div className="mt-6">
        <p className={eyebrow}>Add anything else</p>
        <div className="mt-2">
          <IngredientPicker onPick={(i) => setKept(i.id, true)} onFreeText={addCustom} />
        </div>
        {(others.length > 0 || h.onHandCustom.length > 0) && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {others.map((id) => (
              <li key={id} className={`${chipBase} gap-1 border-edge pl-4 pr-1 text-paper`}>
                {INGREDIENT_BY_ID[id]?.name ?? id}
                <button
                  type="button"
                  aria-label={`Remove ${INGREDIENT_BY_ID[id]?.name ?? id}`}
                  onClick={() => setKept(id, false)}
                  className={removeIconBtn}
                >
                  &times;
                </button>
              </li>
            ))}
            {h.onHandCustom.map((name) => (
              <li key={`custom-${name}`} className={`${chipBase} gap-1 border-edge pl-4 pr-1 text-paper`}>
                {name}
                <button type="button" aria-label={`Remove ${name}`} onClick={() => removeCustom(name)} className={removeIconBtn}>
                  &times;
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

const LEVEL_RANK: Record<CuisineLevel, number> = { often: 0, sometimes: 1, rarely: 2, never: 3 };
