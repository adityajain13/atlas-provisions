// The household's sync keys for the browser sync of T&T prices: one per browser or device (and one for an iPhone
// bookmark), up to SYNC_KEY_CAP per household. A key is random, shown once when it is made, and stored only as a SHA-256
// of itself. Making a key never changes another key; revoking one deletes its row and leaves the rest working. The sync
// routes find a key by comparing its hash with every stored hash in constant time.
import { newId } from '@provisions/shared';
import { randomToken, safeEqual, sha256 } from './authCore';

export const SYNC_KEY_CAP = 10;
export const SYNC_KEY_LABEL_MAX = 40;

export interface SyncKeyRow {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Thrown when the household already has SYNC_KEY_CAP keys. The message is shown to the person as it is. */
export class SyncKeyCapError extends Error {
  constructor() {
    super(`You already have ${SYNC_KEY_CAP} sync keys. Revoke one in Devices to add another.`);
  }
}

/** A key label as the person typed it: spaces collapsed and trimmed. Null when it is empty or too long. */
export function cleanLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const label = value.trim().replace(/\s+/g, ' ');
  return label !== '' && label.length <= SYNC_KEY_LABEL_MAX ? label : null;
}

/** Makes a key for the household. Returns its id and the key itself, which is not kept anywhere else. */
export async function createSyncKey(db: D1Database, householdId: string, label: string, now: Date): Promise<{ id: string; key: string }> {
  const count = await db.prepare('SELECT COUNT(*) AS n FROM sync_keys WHERE household_id = ?').bind(householdId).first<{ n: number }>();
  if ((count?.n ?? 0) >= SYNC_KEY_CAP) throw new SyncKeyCapError();
  const id = newId();
  const key = randomToken(32);
  await db
    .prepare('INSERT INTO sync_keys (id, household_id, label, key_hash, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, NULL)')
    .bind(id, householdId, label, await sha256(key), now.toISOString())
    .run();
  return { id, key };
}

/** The household's keys, oldest first. Never the keys themselves. */
export async function listSyncKeys(db: D1Database, householdId: string): Promise<SyncKeyRow[]> {
  const { results } = await db
    .prepare('SELECT id, label, created_at, last_used_at FROM sync_keys WHERE household_id = ? ORDER BY created_at, id')
    .bind(householdId)
    .all<{ id: string; label: string; created_at: string; last_used_at: string | null }>();
  return results.map((r) => ({ id: r.id, label: r.label, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
}

/** Deletes one of the household's keys. False when there is no such key in the household. */
export async function revokeSyncKey(db: D1Database, householdId: string, id: string): Promise<boolean> {
  const got = await db.prepare('DELETE FROM sync_keys WHERE id = ? AND household_id = ?').bind(id, householdId).run();
  return (got.meta?.changes ?? 0) > 0;
}

/**
 * The key and the household a presented key belongs to, or null. Every row is compared, and nothing stops early, so the
 * time taken does not show which key matched.
 */
export async function keyHolder(db: D1Database, key: string): Promise<{ keyId: string; householdId: string } | null> {
  const presented = await sha256(key);
  const { results } = await db.prepare('SELECT id, household_id, key_hash FROM sync_keys').all<{ id: string; household_id: string; key_hash: string }>();
  let found: { keyId: string; householdId: string } | null = null;
  for (const row of results) if (safeEqual(row.key_hash, presented)) found = { keyId: row.id, householdId: row.household_id };
  return found;
}

/** The key from an `Authorization: Bearer <key>` header, or null when the header is not one. */
export function bearerKey(header: string | undefined | null): string | null {
  const m = /^Bearer\s+(\S+)\s*$/.exec(header ?? '');
  return m ? m[1]! : null;
}

/** Records that a key was used now. */
export async function touchSyncKey(db: D1Database, keyId: string, now: Date): Promise<void> {
  await db.prepare('UPDATE sync_keys SET last_used_at = ? WHERE id = ?').bind(now.toISOString(), keyId).run();
}
