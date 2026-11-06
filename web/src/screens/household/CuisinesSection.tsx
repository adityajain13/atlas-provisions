import { useState } from 'react';
import {
  CUISINES,
  CUISINE_GROUPS,
  CUISINE_LEVELS,
  CUISINE_LEVEL_LABEL,
  cuisineLevel,
  type CuisineLevel,
  type Household,
} from '@provisions/shared';
import { Disclosure } from '../../components/Disclosure';
import { Section } from '../../components/Section';

import { type Update } from './ui';

// ---------- Cuisines ----------

/** How often the household eats each cuisine. Plans lean on 'often' cuisines and mix in the rest. */
export function CuisinesSection({ h, update }: { h: Household; update: Update }) {
  function set(key: string, level: CuisineLevel) {
    update((prev) => ({ ...prev, cuisines: { ...prev.cuisines, [key]: level } }));
  }
  // Every region starts closed; its summary shows what is set.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());

  function toggleOpen(group: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  return (
    <Section title="Cuisines" caption="Plans lean on 'Often' cuisines and mix in the rest.">
      <ul>
        {CUISINE_GROUPS.map((group) => {
          const members = CUISINES.filter((c) => c.group === group);
          const levels = members.map((c) => cuisineLevel(h.cuisines, c.key));
          const often = members.filter((_, i) => levels[i] === 'often').map((c) => c.label);
          const sometimes = levels.filter((l) => l === 'sometimes').length;
          const rarely = levels.filter((l) => l === 'rarely').length;
          const summary = [
            often.length > 0 ? `${often.join(', ')} often` : '',
            sometimes > 0 ? `${sometimes} sometimes` : '',
            rarely > 0 ? `${rarely} rarely` : '',
          ]
            .filter(Boolean)
            .join(' · ') || 'All never';
          return (
            <li key={group}>
              <Disclosure
                open={openGroups.has(group)}
                onToggle={() => toggleOpen(group)}
                title={group}
                summary={summary}
                noFooter
              >
                <ul>
                  {members.map((c) => {
                    const level = cuisineLevel(h.cuisines, c.key);
                    return (
                      <li
                        key={c.key}
                        className="grid grid-cols-1 items-center gap-2 border-b border-line2 py-2 sm:min-h-[44px] sm:grid-cols-[minmax(0,1fr)_304px] sm:gap-x-4 sm:py-1"
                      >
                        <span className="min-w-0 text-[15px] text-paper">{c.label}</span>
                        <div
                          role="group"
                          aria-label={`${c.label}: how often`}
                          className="grid h-9 grid-cols-4 gap-0.5 rounded-lg border border-edge p-0.5"
                        >
                          {CUISINE_LEVELS.map((l) => {
                            const on = level === l;
                            return (
                              <button
                                key={l}
                                type="button"
                                aria-pressed={on}
                                onClick={() => set(c.key, l)}
                                className={`h-full rounded-md px-0.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herb ${
                                  on ? 'bg-herb font-medium text-ink' : 'text-muted'
                                }`}
                              >
                                {CUISINE_LEVEL_LABEL[l]}
                              </button>
                            );
                          })}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Disclosure>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
