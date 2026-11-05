// Pure rules for the shared ticks: what the page shows, what is still being saved, and the one-time move of
// ticks saved in a browser before they synced. The hook (useChecks) does the I/O.
import { CHECK_ITEM_MAX, CHECK_KINDS, type CheckBulk, type CheckKind, type Checks } from '@provisions/shared';

/** A tick this visitor made that the server has not confirmed. seq orders the writes for one item. */
export interface PendingTick {
  checked: boolean;
  seq: number;
}
export type Pending = Record<CheckKind, Record<string, PendingTick>>;

export const NO_PENDING: Pending = { list: {}, prep: {} };

export function emptyChecks(): Checks {
  return { list: {}, prep: {}, updatedAt: null };
}

/**
 * The server's ticks with this visitor's unconfirmed ticks laid over them. A poll that lands while a tick is
 * still saving does not undo it.
 */
export function mergeChecks(server: Checks, pending: Pending): Checks {
  const over = (base: Record<string, boolean>, p: Record<string, PendingTick>) => {
    const out = { ...base };
    for (const [id, tick] of Object.entries(p)) out[id] = tick.checked;
    return out;
  };
  return {
    list: over(server.list, pending.list),
    prep: over(server.prep, pending.prep),
    updatedAt: server.updatedAt,
  };
}

export function addPending(p: Pending, kind: CheckKind, id: string, checked: boolean, seq: number): Pending {
  return { ...p, [kind]: { ...p[kind], [id]: { checked, seq } } };
}

/** Drops a pending tick once its own write is confirmed. A newer write for the same item keeps its entry. */
export function settlePending(p: Pending, kind: CheckKind, id: string, seq: number): Pending {
  const current = p[kind][id];
  if (!current || current.seq !== seq) return p;
  const next = { ...p[kind] };
  delete next[id];
  return { ...p, [kind]: next };
}

/** The server snapshot after one of this visitor's writes is confirmed. */
export function setServerTick(server: Checks, kind: CheckKind, id: string, checked: boolean): Checks {
  return { ...server, [kind]: { ...server[kind], [id]: checked } };
}

/** Ids saved in this browser by the old device-only ticks. Empty when the value is missing or unreadable. */
export function parseLegacyTicks(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids = parsed.filter(
      (x): x is string => typeof x === 'string' && x.length > 0 && x.length <= CHECK_ITEM_MAX,
    );
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

/**
 * What to upload from this browser. A kind is included only when this browser has ticks for it and the server
 * has none for it yet, so saved ticks are never overwritten. Null when there is nothing to move.
 */
export function legacyUpload(local: Record<CheckKind, string[]>, server: Checks): CheckBulk | null {
  const out: CheckBulk = {};
  for (const kind of CHECK_KINDS) {
    if (local[kind].length === 0 || Object.keys(server[kind]).length > 0) continue;
    out[kind] = Object.fromEntries(local[kind].map((id) => [id, true]));
  }
  return Object.keys(out).length > 0 ? out : null;
}
