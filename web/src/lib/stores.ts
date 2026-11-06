// Pure rules for the Household Stores section: adding presets and custom stores, Flipp names and the
// per-trip limit. No React here, so the screen only wires these to state.
import {
  MAX_MIN_SAVING,
  STORE_GROUPS,
  STORE_PRESETS,
  hasLocationList,
  presetIdOfBanner,
  siteBannerOf,
  slugifyName,
  type ItemRule,
  type SiteBanner,
  type Store,
  type StoreGroup,
  type StorePreset,
} from '@provisions/shared';

export const MAX_STORES_PER_TRIP = 5;
export const MAX_FLIPP_NAMES = 10;
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

/** The store a preset chip adds: enabled, with the preset's price-match default, Flipp names and an optional address. */
export function storeFromPreset(preset: StorePreset, address?: string): Store {
  const trimmed = address?.trim() ?? '';
  return {
    id: preset.id,
    name: preset.name,
    enabled: true,
    priceMatches: preset.priceMatches,
    group: preset.group,
    ...(preset.flippNames ? { flippNames: [...preset.flippNames] } : {}),
    ...(trimmed ? { address: trimmed.slice(0, MAX_ADDRESS) } : {}),
  };
}

/** Longest address a store keeps. The schema allows the same. */
export const MAX_ADDRESS = 160;

/** The address a store row shows: the branch it is at, else the address typed for it. Undefined when there is none. */
export function addressOf(store: Store): string | undefined {
  return store.siteStore?.label ?? store.address;
}

/** The store with its address replaced. Blank text removes it. Every other field is kept. */
export function withAddress(store: Store, text: string): Store {
  const { address: _old, ...rest } = store;
  const trimmed = text.trim().slice(0, MAX_ADDRESS);
  return trimmed ? { ...rest, address: trimmed } : rest;
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
 * A store the user typed: group Other, enabled, no price match, id from the name, and an optional address. Rejected when
 * the name is blank, too long, has no letters or digits, or matches a store already in the list (name ignoring case,
 * or the same id).
 */
export function addCustomStore(stores: Store[], name: string, flippText: string, address = ''): AddStoreResult {
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
  const where = address.trim().slice(0, MAX_ADDRESS);
  return {
    ok: true,
    store: {
      id,
      name: trimmed,
      enabled: true,
      priceMatches: false,
      group: 'Other',
      ...(flippNames.length > 0 ? { flippNames } : {}),
      ...(where ? { address: where } : {}),
    },
  };
}

/** A branch the search found: its chain's banner, the store id to read prices from, and its label. */
export interface BranchChoice {
  banner: SiteBanner;
  storeId: string;
  label: string;
}

export type BranchResult = { stores: Store[]; outcome: 'added' | 'updated'; name: string };

/**
 * The list with a branch added for its chain. A chain already in the list keeps its place and flags and gets the
 * branch in place of its old one ('updated'). A new chain is added enabled, from its preset ('added'). Null when the
 * banner has no location list or preset. One branch per chain: the list never gets a second store for the same chain.
 */
export function withBranch(stores: Store[], branch: BranchChoice): BranchResult | null {
  if (!hasLocationList(branch.banner)) return null;
  const preset = STORE_PRESETS.find((p) => p.id === presetIdOfBanner(branch.banner));
  if (!preset) return null;
  const siteStore = { banner: branch.banner, storeId: branch.storeId, label: branch.label };
  const lower = preset.name.trim().toLowerCase();
  const existing = stores.find((s) => s.id === preset.id || s.name.trim().toLowerCase() === lower);
  if (existing) {
    return { stores: stores.map((s) => (s === existing ? { ...s, siteStore } : s)), outcome: 'updated', name: preset.name };
  }
  return { stores: [...stores, { ...storeFromPreset(preset), siteStore }], outcome: 'added', name: preset.name };
}

/**
 * Whether a store's regular prices are read: an enabled Loblaw-family store with a location picked, or an enabled T&T
 * store, which has no location (its prices are the same at every store). Counts the stores for the Regular prices row.
 */
export function readsSitePrices(store: Store): boolean {
  if (!store.enabled) return false;
  return siteBannerOf(store.id) === 'tandt' || store.siteStore !== undefined;
}

/** Whether a store's chain is one whose branch is searched by address (a Loblaw-family banner). */
export function takesBranch(storeId: string): boolean {
  return siteBannerOf(storeId) !== undefined;
}

/**
 * Replaces the Flipp names of one store. Blank text removes them. Every other field is kept, including the location
 * and the address (rebuilding the store used to drop them).
 */
export function withFlippNames(store: Store, text: string): Store {
  const { flippNames: _old, ...rest } = store;
  const names = parseFlippNames(text);
  return names.length > 0 ? { ...rest, flippNames: names } : rest;
}

/** The group a store shows under. A store saved before groups existed takes its preset's group, if it has one. */
export function groupOf(store: Store): StoreGroup | undefined {
  if (store.group) return store.group;
  const name = store.name.trim().toLowerCase();
  return STORE_PRESETS.find((p) => p.id === store.id || p.name.toLowerCase() === name)?.group;
}

/** Adds one Flipp name to a store. A name already there (ignoring case) is not repeated; the limit still applies. */
export function addFlippName(store: Store, text: string): Store {
  return withFlippNames(store, [...(store.flippNames ?? []), text].join(', '));
}

/** Removes one Flipp name from a store, matching ignoring case. */
export function removeFlippName(store: Store, name: string): Store {
  const key = name.toLowerCase();
  const kept = (store.flippNames ?? []).filter((n) => n.toLowerCase() !== key);
  return withFlippNames(store, kept.join(', '));
}

/** List order: stores shopped at first, then the rest. Each group is alphabetical by name. */
export function orderStores(stores: Store[]): Store[] {
  return [...stores].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
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

// ---- Ranking: the store list's order is the preference order ----

/** The list with one store moved one place up (step -1) or down (step 1). At either end nothing moves. */
export function moveStore(stores: Store[], id: string, step: -1 | 1): Store[] {
  const from = stores.findIndex((s) => s.id === id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= stores.length) return stores;
  const next = [...stores];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/**
 * The list with one store dropped before the row at position `to`, where `to` counts the rows as they are now
 * (0 is the top, the list's length is the bottom). Dropping a store where it already is changes nothing.
 */
export function moveStoreTo(stores: Store[], id: string, to: number): Store[] {
  const from = stores.findIndex((s) => s.id === id);
  if (from < 0) return stores;
  const target = Math.max(0, Math.min(stores.length, to));
  const rest = stores.filter((s) => s.id !== id);
  const at = target > from ? target - 1 : target;
  return [...rest.slice(0, at), stores[from]!, ...rest.slice(at)];
}

/**
 * The drop position for a pointer at height `y`, given the vertical middle of each row in list order: the number of
 * rows whose middle is above the pointer.
 */
export function dropIndex(middles: number[], y: number): number {
  return middles.filter((m) => m < y).length;
}

/** The store names a pin can point at: the enabled stores, in list order. */
export function pinStoreOptions(stores: Store[]): string[] {
  return stores.filter((s) => s.enabled).map((s) => s.name);
}

/**
 * An item rule with its store set, or cleared when `store` is undefined (cheapest). Every other field is kept, and
 * an unset optional field stays unset, so the saved rule looks as it did.
 */
export function withPinnedStore(rule: ItemRule, store: string | undefined): ItemRule {
  const next: ItemRule = { id: rule.id, name: rule.name, rule: rule.rule };
  if (rule.except) next.except = rule.except;
  if (rule.ingredientId) next.ingredientId = rule.ingredientId;
  if (store) next.store = store;
  return next;
}

/** A dollar amount typed for the minimum saving: a number from 0 to MAX_MIN_SAVING, to the cent. Null when it is not one. */
export function parseMinSaving(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > MAX_MIN_SAVING) return null;
  return n;
}
