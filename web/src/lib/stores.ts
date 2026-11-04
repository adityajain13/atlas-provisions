// Pure rules for the Household Stores section: adding presets and custom stores, Flipp names and the
// per-trip limit. No React here, so the screen only wires these to state.
import { STORE_GROUPS, STORE_PRESETS, slugifyName, type Store, type StoreGroup, type StorePreset } from '@provisions/shared';

export const MAX_STORES_PER_TRIP = 5;
const MAX_FLIPP_NAMES = 10;
const MAX_NAME = 40;

/** Presets that are not in the list yet. A preset counts as present when its id or its name (any case) is. */
export function presetsNotInList(stores: Store[], presets: StorePreset[]): StorePreset[] {
  const ids = new Set(stores.map((s) => s.id));
  const names = new Set(stores.map((s) => s.name.trim().toLowerCase()));
  return presets.filter((p) => !ids.has(p.id) && !names.has(p.name.trim().toLowerCase()));
}

/** Presets under their group headings, in STORE_GROUPS order. Groups with no presets are left out. */
export function groupPresets(presets: StorePreset[]): { group: StoreGroup; presets: StorePreset[] }[] {
  return STORE_GROUPS.map((group) => ({ group, presets: presets.filter((p) => p.group === group) })).filter(
    (g) => g.presets.length > 0,
  );
}

/** The store a preset chip adds: enabled, with the preset's price-match default and Flipp names. */
export function storeFromPreset(preset: StorePreset): Store {
  return {
    id: preset.id,
    name: preset.name,
    enabled: true,
    priceMatches: preset.priceMatches,
    group: preset.group,
    ...(preset.flippNames ? { flippNames: [...preset.flippNames] } : {}),
  };
}

/** Comma-separated Flipp names as typed: trimmed, no empties, no repeats ignoring case, at most 10. */
export function parseFlippNames(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(',')) {
    const name = raw.trim().slice(0, MAX_NAME);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.slice(0, MAX_FLIPP_NAMES);
}

export type AddStoreResult = { ok: true; store: Store } | { ok: false; error: string };

/**
 * A store the user typed: group Other, enabled, no price match, id from the name. Rejected when the name is
 * blank, too long, has no letters or digits, or matches a store already in the list (name ignoring case,
 * or the same id).
 */
export function addCustomStore(stores: Store[], name: string, flippText: string): AddStoreResult {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Type a store name.' };
  if (trimmed.length > MAX_NAME) return { ok: false, error: `Store names are ${MAX_NAME} characters or fewer.` };
  const id = slugifyName(trimmed);
  if (!id) return { ok: false, error: 'Use letters or numbers in the store name.' };

  const lower = trimmed.toLowerCase();
  const same = stores.find((s) => s.name.trim().toLowerCase() === lower);
  if (same) return { ok: false, error: `"${same.name}" is already in your list.` };
  if (stores.some((s) => s.id === id)) return { ok: false, error: 'A store with a similar name is already in your list.' };

  const flippNames = parseFlippNames(flippText);
  return {
    ok: true,
    store: {
      id,
      name: trimmed,
      enabled: true,
      priceMatches: false,
      group: 'Other',
      ...(flippNames.length > 0 ? { flippNames } : {}),
    },
  };
}

/** Replaces the Flipp names of one store. Blank text removes them. */
export function withFlippNames(store: Store, text: string): Store {
  const { id, name, enabled, priceMatches, group } = store;
  const names = parseFlippNames(text);
  return {
    id,
    name,
    enabled,
    priceMatches,
    ...(group ? { group } : {}),
    ...(names.length > 0 ? { flippNames: names } : {}),
  };
}

/** The group a store shows under. A store saved before groups existed takes its preset's group, if it has one. */
export function groupOf(store: Store): StoreGroup | undefined {
  if (store.group) return store.group;
  const name = store.name.trim().toLowerCase();
  return STORE_PRESETS.find((p) => p.id === store.id || p.name.toLowerCase() === name)?.group;
}

export function enabledCount(stores: Store[]): number {
  return stores.filter((s) => s.enabled).length;
}

/** The most stores a trip may use: the number of enabled stores, at most 5. With none enabled, 5. */
export function maxStoresLimit(stores: Store[]): number {
  const n = enabledCount(stores);
  return Math.min(MAX_STORES_PER_TRIP, n > 0 ? n : MAX_STORES_PER_TRIP);
}

/** A per-trip count kept within 1 and maxStoresLimit. */
export function clampMaxStores(value: number, stores: Store[]): number {
  return Math.min(maxStoresLimit(stores), Math.max(1, Math.round(value)));
}
