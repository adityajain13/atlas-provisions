import { useState } from 'react';
import { newId, type Household } from '@provisions/shared';
import { Section } from '../../components/Section';
import { addBtn, fieldCls, removeIconBtn } from '../../components/ui';

import { type Update } from './ui';

// ---------- Allergies (read-only summary) ----------

export function AllergiesSection({ h }: { h: Household }) {
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

export function EquipmentSection({ h, update }: { h: Household; update: Update }) {
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
      <ul className="grid grid-cols-2 gap-x-4 lg:grid-cols-3">
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
