import { useState } from 'react';
import { INGREDIENTS, type CatalogIngredient } from '@provisions/shared';
import { eyebrow, fieldCls } from './ui';

/** Catalogue ingredients whose name or alias contains the query. At most eight. */
export function searchIngredients(query: string): CatalogIngredient[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return INGREDIENTS.filter((i) => i.name.toLowerCase().includes(q) || i.aliases.some((a) => a.includes(q))).slice(0, 8);
}

/** Whether the query is exactly a catalogue name or alias, so no free-text choice is needed. */
function isExactMatch(query: string): boolean {
  const q = query.trim().toLowerCase();
  return INGREDIENTS.some((i) => i.name.toLowerCase() === q || i.aliases.includes(q));
}

/**
 * Search box and results for picking a catalogue ingredient. Used by the pantry form, receipt lines, the never and
 * always lists, and the spice rack. A caller that can hold a plain name passes onFreeText, so a name the catalogue
 * lacks can be used as typed; any other caller is told the item is not in the catalogue yet.
 */
export function IngredientPicker({
  onPick,
  onFreeText,
  autoFocus = false,
}: {
  onPick: (i: CatalogIngredient) => void;
  onFreeText?: (name: string) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const results = searchIngredients(query);
  const typed = query.trim();
  const offerFreeText = onFreeText !== undefined && typed !== '' && !isExactMatch(typed);

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
      {offerFreeText && (
        <button
          type="button"
          onClick={() => {
            onFreeText(typed);
            setQuery('');
          }}
          className="mt-2 min-h-11 text-left text-[13px] text-muted underline underline-offset-2 outline-none hover:text-paper focus-visible:ring-2 focus-visible:ring-herb"
        >
          Not in the list? Use &ldquo;{typed}&rdquo; as-is
        </button>
      )}
      {typed && results.length === 0 && !onFreeText && <p className="mt-2 text-[13px] text-muted">Not in the catalogue yet.</p>}
    </div>
  );
}
