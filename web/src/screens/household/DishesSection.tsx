import { useState } from 'react';
import { type Household } from '@provisions/shared';
import { Section } from '../../components/Section';
import { addBtn, chipBase, fieldCls, removeIconBtn } from '../../components/ui';

import { type Update } from './ui';

// ---------- Dishes I don't want ----------

export function DishesSection({ h, update }: { h: Household; update: Update }) {
  const [text, setText] = useState('');

  function add() {
    const word = text.trim();
    setText('');
    if (!word) return;
    update((prev) => {
      if (prev.avoidDishes.some((d) => d.toLowerCase() === word.toLowerCase())) return prev;
      return { ...prev, avoidDishes: [...prev.avoidDishes, word] };
    });
  }

  function remove(word: string) {
    update((prev) => ({ ...prev, avoidDishes: prev.avoidDishes.filter((d) => d !== word) }));
  }

  return (
    <Section title="Dishes I don't want" caption="Meals like these won't be planned, whatever they're called.">
      {h.avoidDishes.length === 0 ? (
        <p className="text-[14px] text-muted">None yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {h.avoidDishes.map((d) => (
            <li key={d} className={`${chipBase} gap-1 border-edge pl-4 pr-1 text-paper`}>
              {d}
              <button type="button" aria-label={`Remove ${d}`} onClick={() => remove(d)} className={removeIconBtn}>
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        <input
          className={fieldCls}
          placeholder="Add a dish, e.g. slaw"
          aria-label="Add a dish I don't want"
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
