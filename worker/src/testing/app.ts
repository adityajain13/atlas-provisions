// Route-test helpers: a real in-memory database (every migration applied), sessions written straight into it,
// and the Worker's Hono app called with a test env. No network.
import { vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { app } from '../index';
import { sha256 } from '../authCore';
import { EmailMessage } from './cloudflare-email';
import { newTestDb } from './d1';

export const API = '/provisions/api';
export const SUNDAY = '2026-11-01';
export const OWNER = 'owner@example.com';
export const PARTNER = 'partner@example.com';

/** A signed-in cookie header for `email`. The session is written to the database and lasts a year. */
export async function signIn(raw: DatabaseSync, email: string, token = `tok-${email}`): Promise<{ cookie: string }> {
  const now = Date.now();
  raw
    .prepare('INSERT INTO sessions (id_hash, email, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, NULL)')
    .run(await sha256(token), email, now, now + 365 * 86_400_000);
  return { cookie: `ap_session=${token}` };
}

export const send = vi.fn(async (_message: EmailMessage) => {});

/** The env the app is called with. ALLOWED_EMAILS defaults to the owner, so the owner gets a household on first use. */
export function testEnv(DB: D1Database, extra: Record<string, string | undefined> = {}) {
  return {
    DB,
    ALLOWED_EMAILS: OWNER,
    MAIL_FROM: 'provisions@adityajain.ca',
    EMAIL: { send },
    ASSETS: { fetch: async () => new Response('asset') },
    DEV: '0',
    ...extra,
  } as never;
}

export const call = (path: string, init: RequestInit, env: unknown) => app.request(path, init, env as never);

export const json = (method: string, body: unknown, cookie?: string): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
});

export const withCookie = (cookie: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...(init.headers as Record<string, string> | undefined), cookie },
});

/** One fresh database with the given signed-in addresses, and the env with any extra vars. */
export async function setup(emails: string[] = [OWNER], extra: Record<string, string | undefined> = {}) {
  const { raw, DB } = newTestDb();
  const cookies: Record<string, string> = {};
  for (const email of emails) cookies[email] = (await signIn(raw, email)).cookie;
  return { raw, DB, env: testEnv(DB, extra), cookies };
}

/** Rows of a query, for assertions. */
export function rows<T = Record<string, unknown>>(raw: DatabaseSync, sql: string, ...args: unknown[]): T[] {
  return raw.prepare(sql).all(...(args as never[])) as T[];
}

export function count(raw: DatabaseSync, table: string, where = '1 = 1', ...args: unknown[]): number {
  return (raw.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get(...(args as never[])) as { n: number }).n;
}

/** The household id the address works in, after its first request has created or joined one. */
export function householdOf(raw: DatabaseSync, email: string): string {
  const row = raw.prepare('SELECT household_id FROM household_members WHERE email = ?').get(email) as
    | { household_id: string }
    | undefined;
  if (!row) throw new Error(`${email} is in no household`);
  return row.household_id;
}

/**
 * Gives the address a household with the given document. The first request creates the household (for an
 * allow-listed address) and the document is then replaced in the database. Returns the household id.
 */
export async function householdWith(
  raw: DatabaseSync,
  env: unknown,
  cookie: string,
  email: string,
  doc: unknown,
): Promise<string> {
  await call(`${API}/household`, { headers: { cookie } }, env);
  const id = householdOf(raw, email);
  raw.prepare('UPDATE households SET data = ? WHERE id = ?').run(JSON.stringify(doc), id);
  return id;
}
