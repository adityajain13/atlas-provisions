import { useState } from 'react';
import { THEMES, THEME_LABEL, readTheme, saveTheme, type Theme } from '../lib/theme';
import { eyebrow } from './ui';

/** Dark or Black for this device. Shown in the sidebar on desktop and at the foot of Household on phones. */
export function AppearanceControl({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(readTheme);

  function choose(next: Theme) {
    saveTheme(next);
    setTheme(next);
  }

  return (
    <div className={className}>
      <p className={eyebrow}>Appearance · This device</p>
      <div role="group" aria-label="Appearance" className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-edge p-1">
        {THEMES.map((t) => {
          const on = theme === t;
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              onClick={() => choose(t)}
              className={`h-9 rounded-md text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herb ${
                on ? 'bg-herb font-medium text-ink' : 'text-muted hover:text-paper'
              }`}
            >
              {THEME_LABEL[t]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
