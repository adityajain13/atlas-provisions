import { Hono } from 'hono';
import { HouseholdSchema, defaultHousehold } from '@provisions/shared';
import type { ZodError } from 'zod';

type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY?: string;
};

const API = '/provisions/api';
const app = new Hono<{ Bindings: Env }>();

function formatZod(error: ZodError): string {
  return error.issues
    .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
    .join('; ');
}

app.get(`${API}/health`, (c) => c.json({ ok: true }));

app.get(`${API}/household`, async (c) => {
  const row = await c.env.DB.prepare('SELECT data FROM household WHERE id = 1').first<{
    data: string;
  }>();
  if (!row) return c.json(defaultHousehold());

  let raw: unknown;
  try {
    raw = JSON.parse(row.data);
  } catch {
    return c.text('Stored household is not valid JSON', 500);
  }
  const parsed = HouseholdSchema.safeParse(raw);
  if (!parsed.success) return c.text(`Stored household is invalid: ${formatZod(parsed.error)}`, 500);
  return c.json(parsed.data);
});

app.put(`${API}/household`, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.text('Body must be JSON', 400);
  }

  const parsed = HouseholdSchema.safeParse(body);
  if (!parsed.success) return c.text(formatZod(parsed.error), 400);

  await c.env.DB.prepare(
    `INSERT INTO household (id, data, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  )
    .bind(JSON.stringify(parsed.data), new Date().toISOString())
    .run();

  return c.json(parsed.data);
});

// Everything else: static assets, with SPA fallback for /provisions/* routes.
app.all('*', async (c) => {
  const url = new URL(c.req.url);
  if (url.pathname.startsWith(API)) return c.json({ error: 'Not found' }, 404);

  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (
    res.status === 404 &&
    url.pathname.startsWith('/provisions') &&
    !/\.[^/]+$/.test(url.pathname)
  ) {
    return c.env.ASSETS.fetch(new Request(new URL('/provisions/', url), c.req.raw));
  }
  return res;
});

export default app;
