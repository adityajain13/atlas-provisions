import { VARIETY_RULES, type Household } from '@provisions/shared';
import { Section } from '../../components/Section';

import { type Update } from './ui';

// ---------- Variety rules ----------

export function VarietySection({ h, update }: { h: Household; update: Update }) {
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
        <li>
          <label className="flex min-h-[48px] cursor-pointer items-center justify-between gap-4 border-b border-line2">
            <span className="text-[15px] text-paper">Prefer in-season produce</span>
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0"
              checked={h.preferSeasonal}
              onChange={(e) => update((prev) => ({ ...prev, preferSeasonal: e.target.checked }))}
            />
          </label>
        </li>
      </ul>
    </Section>
  );
}
