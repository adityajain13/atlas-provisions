import { useState } from 'react';
import { type Household } from '@provisions/shared';
import { Section } from '../../components/Section';
import { eyebrow, fieldCls } from '../../components/ui';

import { type Update, ERROR_TEXT } from './ui';

// ---------- Weekly budget ----------

/** The budget a new week starts with. Plans take the same limits as the budget field on Plan (1 to 2000). */
export function BudgetSection({ h, update }: { h: Household; update: Update }) {
  const [text, setText] = useState(String(h.defaultBudget));
  const amount = Number(text);
  const invalid = text.trim() === '' || !Number.isFinite(amount) || amount < 1 || amount > 2000;

  function onChange(value: string) {
    setText(value);
    const next = Number(value);
    if (value.trim() !== '' && Number.isFinite(next) && next >= 1 && next <= 2000) {
      update((prev) => (prev.defaultBudget === next ? prev : { ...prev, defaultBudget: next }));
    }
  }

  return (
    <Section title="Weekly budget" caption="Each new plan starts with this. You can change it for any one week on Plan.">
      <label className="block">
        <span className={eyebrow}>Budget per week</span>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[15px] text-muted" aria-hidden="true">
            $
          </span>
          <input
            type="number"
            min={1}
            max={2000}
            step={5}
            inputMode="decimal"
            className={fieldCls}
            value={text}
            aria-invalid={invalid}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
        {invalid && <span className={`mt-1 block text-[12px] ${ERROR_TEXT}`}>Enter an amount from $1 to $2,000.</span>}
      </label>
    </Section>
  );
}
