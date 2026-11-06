// The browser sync's routes, mounted under /provisions/api. The key routes and the status are behind sign-in like the
// rest of the app. The plan and results are called from the T&T site and the extension, with the household's sync key as
// a Bearer token and no cookies, so they answer CORS for those origins only (see corsHeaders). The middleware lets them
// through to check the key themselves (see BEARER_PATHS in authMiddleware).
import { Hono } from 'hono';
import { loadHousehold } from './db';
import type { AuthMiddlewareEnv, SessionVars } from './authMiddleware';
import { SYNC_KEY_LABEL_MAX, SyncKeyCapError, bearerKey, cleanLabel, createSyncKey, keyHolder, listSyncKeys, revokeSyncKey } from './syncKeys';
import { ingestTntResults, tntPlan, tntResultsProblem, tntStatus, TNT_BODY_BYTES, type TntResultIn } from './tntSync';

export const tntSyncRoutes = new Hono<{ Bindings: AuthMiddlewareEnv; Variables: SessionVars }>();

/** The origins allowed to call the sync: T&T's own site, and the browser extensions (Firefox and Chromium). */
export function syncOriginAllowed(origin: string | null | undefined): boolean {
  if (!origin) return false;
  return origin === 'https://www.tntsupermarket.com' || origin.startsWith('moz-extension://') || origin.startsWith('chrome-extension://');
}

/** CORS headers for a sync call: the origin is echoed only when allowed, and credentials are never allowed. */
export function corsHeaders(origin: string | null | undefined): Record<string, string> {
  const base: Record<string, string> = { Vary: 'Origin' };
  if (!syncOriginAllowed(origin)) return base;
  return {
    ...base,
    'Access-Control-Allow-Origin': origin as string,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
  };
}

// The household's sync keys: one per browser or device, and one for an iPhone bookmark. Making a key never changes
// another; revoking one leaves the rest working. The key itself is returned once, by the POST.
tntSyncRoutes.get('/sync-keys', async (c) => c.json(await listSyncKeys(c.env.DB, c.get('householdId')), 200, { 'Cache-Control': 'no-store' }));

tntSyncRoutes.post('/sync-keys', async (c) => {
  let body: unknown = null;
  try {
    body = await c.req.json();
  } catch {
    return c.text('Body must be JSON', 400);
  }
  const label = cleanLabel((body as { label?: unknown } | null)?.label);
  if (label === null) return c.text(`Give the key a label of 1 to ${SYNC_KEY_LABEL_MAX} characters.`, 400);
  try {
    const made = await createSyncKey(c.env.DB, c.get('householdId'), label, new Date());
    return c.json({ id: made.id, label, key: made.key }, 200, { 'Cache-Control': 'no-store' });
  } catch (e) {
    if (e instanceof SyncKeyCapError) return c.text(e.message, 409);
    throw e;
  }
});

tntSyncRoutes.delete('/sync-keys/:id', async (c) => {
  const removed = await revokeSyncKey(c.env.DB, c.get('householdId'), c.req.param('id'));
  return removed ? c.json({ ok: true }) : c.text('No such sync key', 404);
});

// The last browser sync of the household's T&T prices, for the Household screen.
tntSyncRoutes.get('/tnt-sync/status', async (c) => {
  const householdId = c.get('householdId');
  const household = await loadHousehold(c.env.DB, householdId);
  return c.json(await tntStatus(c.env.DB, householdId, household, new Date()));
});

tntSyncRoutes.options('/tnt-sync/plan', (c) => new Response(null, { status: 204, headers: corsHeaders(c.req.header('Origin')) }));
tntSyncRoutes.options('/tnt-sync/results', (c) => new Response(null, { status: 204, headers: corsHeaders(c.req.header('Origin')) }));

/** The household and key a Bearer sync key belongs to, or a 401 with CORS headers so the caller can read why. */
async function syncHousehold(
  c: { req: { header(name: string): string | undefined }; env: AuthMiddlewareEnv },
): Promise<{ householdId: string; keyId: string } | { response: Response }> {
  const headers = { ...corsHeaders(c.req.header('Origin')), 'Cache-Control': 'no-store' };
  const key = bearerKey(c.req.header('Authorization'));
  const holder = key ? await keyHolder(c.env.DB, key) : null;
  if (!holder) {
    return { response: new Response(JSON.stringify({ error: 'Sync key not recognised. Make a new one in Household.' }), { status: 401, headers: { ...headers, 'content-type': 'application/json' } }) };
  }
  return holder;
}

function jsonWith(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json' } });
}

tntSyncRoutes.get('/tnt-sync/plan', async (c) => {
  const auth = await syncHousehold(c);
  if ('response' in auth) return auth.response;
  const headers = { ...corsHeaders(c.req.header('Origin')), 'Cache-Control': 'no-store' };
  return jsonWith(await tntPlan(c.env.DB, auth.householdId, new Date()), 200, headers);
});

tntSyncRoutes.post('/tnt-sync/results', async (c) => {
  const auth = await syncHousehold(c);
  if ('response' in auth) return auth.response;
  const headers = { ...corsHeaders(c.req.header('Origin')), 'Cache-Control': 'no-store' };
  const text = await c.req.text();
  if (new TextEncoder().encode(text).length > TNT_BODY_BYTES) return jsonWith({ error: 'The results are too large' }, 413, headers);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return jsonWith({ error: 'Body must be JSON' }, 400, headers);
  }
  const problem = tntResultsProblem(body);
  if (problem) return jsonWith({ error: problem.message }, problem.status, headers);
  const got = await ingestTntResults(c.env.DB, auth.householdId, auth.keyId, (body as { results: TntResultIn[] }).results, new Date());
  if (!got) return jsonWith({ error: "T&T isn't one of your stores, or has no region for its postal code." }, 409, headers);
  return jsonWith(got, 200, headers);
});
