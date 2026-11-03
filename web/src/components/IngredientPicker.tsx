import { useState } from 'react';
import { INGREDIENTS, type CatalogIngredient } from '@provisions/shared';
import { eyebrow, fieldCls } from './ui';

/** Catalogue ingredients whose name or alias contains the query. At most eight. */
export function searchIngredients(query: string): CatalogIngredient[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return INGREDIENTS.filter((i) => i.name.toLowerCase().includes(q) || i.aliases.some((a) => a.includes(q))).slice(0, 8);
}

/** Search box and results for picking a catalogue ingredient. Used by the pantry form and receipt lines. */
export function IngredientPicker({ onPick, autoFocus = false }: { onPick: (i: CatalogIngredient) => void; autoFocus?: boolean }) {
  const [query, setQuery] = useState('');
  const results = searchIngredients(query);

  return (
    <div>
      <input
        className={fieldCls}
        placeholder="Search ingredients"
        aria-label="Search ingredients"
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {results.map((i) => (
            <li key={i.id}>
              <button
                type="button"
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
      {query.trim() && results.length === 0 && <p className="mt-2 text-[13px] text-muted">No ingredient matches that.</p>}
    </div>
  );
}
