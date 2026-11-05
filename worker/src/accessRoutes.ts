// Who may sign in, managed by admins under Household > App access. Mounted under /provisions/api, behind sign-in.
//   GET    /me                          {email, isAdmin}, for any signed-in address
//   GET    /access                      every approved address and where its access comes from (admins)
//   POST   /access {email, sendEmail?}  gives an address access (admins)
//   DELETE /access/:email               removes access from the app's list, ends its sessions (admins)
// Addresses from ALLOWED_EMAILS or ADMIN_EMAILS are set in Worker settings and cannot be removed here.
import { Hono } from 'hono';
import { cleanEmail, type AccessEntry, type AccessView, type MeView } from '@provisions/shared';
import { adminEmails, householdDeleteStatements, isAdmin, isApproved } from './access';
import { BASE, isAllowed, normEmail, parseAllowList } from './authCore';
import type { AuthMiddlewareEnv, SessionVars } from './authMiddleware';
import { sendMail, type MailEnv } from './mail';

export type AccessRouteEnv = MailEnv & AuthMiddlewareEnv;

export const accessRoutes = new Hono<{ Bindings: AccessRouteEnv; Variables: SessionVars }>();

const NOT_ADMIN = 'Only admins can manage access.';

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body: unknown = await req.json().catch(() => null);
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

/**
 * Every approved address, admins first, then Worker settings, then the app's list. An address in more than one
 * source is listed once, under the first. Each carries the household it is a member of.
 */
async function listAccess(db: D1Database, env: AccessRouteEnv): Promise<AccessEntry[]> {
  const entries = new Map<string, AccessEntry>();
  for (const email of await adminEmails(db, env)) entries.set(email, { email, source: 'admin' });
  for (const email of parseAllowList(env.ALLOWED_EMAILS)) {
    if (!entries.has(email)) entries.set(email, { email, source: 'settings' });
  }
  const { results: rows } = await db
    .prepare('SELECT email, added_by, added_at FROM allowed_emails ORDER BY added_at, email')
    .all<{ email: string; added_by: string; added_at: string }>();
  for (const r of rows) {
    if (!entries.has(r.email)) entries.set(r.email, { email: r.email, source: 'app', addedAt: r.added_at, addedBy: r.added_by });
  }

  const { results: memberships } = await db
    .prepare(
      `SELECT m.email, m.role, h.id, h.name,
         (SELECT count(*) FROM household_members o WHERE o.household_id = m.household_id AND o.role = 'owner') AS owners
       FROM household_members m JOIN households h ON h.id = m.household_id`,
    )
    .all<{ email: string; role: 'owner' | 'member'; id: string; name: string; owners: number }>();
  const byEmail = new Map(memberships.map((m) => [m.email, m]));

  return [...entries.values()].map((entry) => {
    const m = byEmail.get(entry.email);
    if (!m) return entry;
    return {
      ...entry,
      household: { id: m.id, name: m.name, role: m.role, soleOwner: m.role === 'owner' && m.owners === 1 },
    };
  });
}

accessRoutes.get('/me', async (c) => {
  const email = c.get('email');
  const view: MeView = { email, isAdmin: await isAdmin(c.env.DB, c.env, email) };
  return c.json(view);
});

accessRoutes.get('/access', async (c) => {
  if (!(await isAdmin(c.env.DB, c.env, c.get('email')))) return c.text(NOT_ADMIN, 403);
  const view: AccessView = { entries: await listAccess(c.env.DB, c.env), isAdmin: true };
  return c.json(view);
});

// Gives an address access. Mail is sent only when asked and RESEND_API_KEY is set; if it cannot be sent, the
// access still stands and `emailed` says so.
accessRoutes.post('/access', async (c) => {
  const db = c.env.DB;
  const me = c.get('email');
  if (!(await isAdmin(db, c.env, me))) return c.text(NOT_ADMIN, 403);
  const body = await readJson(c.req.raw);
  const email = cleanEmail(body.email);
  if (!email) return c.text('Enter a valid email address', 400);
  if (await isApproved(db, c.env, email)) return c.text('They already have access.', 409);

  const addedAt = new Date().toISOString();
  const res = await db
    .prepare('INSERT INTO allowed_emails (email, added_by, added_at, note) VALUES (?, ?, ?, NULL) ON CONFLICT(email) DO NOTHING')
    .bind(email, me, addedAt)
    .run();
  if ((res.meta.changes ?? 0) === 0) return c.text('They already have access.', 409);

  let emailed = false;
  if (body.sendEmail === true && c.env.RESEND_API_KEY) {
    const signIn = `${new URL(c.req.url).origin}${BASE}/login`;
    try {
      await sendMail(c.env, {
        fromName: 'Atlas Provisions',
        to: email,
        subject: "You've been given access to Atlas Provisions",
        text: `${me} gave you access to Atlas Provisions.\n\nSign in with this email address: ${signIn}\n`,
      });
      emailed = true;
    } catch (e) {
      console.error('access email failed', e);
    }
  }
  const entry: AccessEntry = { email, source: 'app', addedAt, addedBy: me };
  return c.json({ entry, emailed }, 201);
});

// Removes access from the app's list and signs the address out everywhere, at once. With deleteHousehold=1 and the
// address the sole owner of its household, that household and its data are deleted too. Its members then lose
// access unless they are approved themselves.
accessRoutes.delete('/access/:email', async (c) => {
  const db = c.env.DB;
  const me = c.get('email');
  if (!(await isAdmin(db, c.env, me))) return c.text(NOT_ADMIN, 403);
  const email = normEmail(c.req.param('email'));
  if (email === me) return c.text("You can't remove your own access.", 400);
  if (isAllowed(c.env.ALLOWED_EMAILS, email)) return c.text('This address is set in Worker settings.', 400);
  if (await isAdmin(db, c.env, email)) return c.text('This address is an admin, so its access is not removed here.', 400);

  const listed = await db.prepare('SELECT 1 AS found FROM allowed_emails WHERE email = ?').bind(email).first();
  if (!listed) return c.text('No app access for that address', 404);

  const statements = [
    db.prepare('DELETE FROM allowed_emails WHERE email = ?').bind(email),
    db.prepare('DELETE FROM sessions WHERE lower(trim(email)) = ?').bind(email),
  ];
  let householdDeleted = false;
  if (c.req.query('deleteHousehold') === '1') {
    const membership = await db
      .prepare('SELECT household_id, role FROM household_members WHERE email = ?')
      .bind(email)
      .first<{ household_id: string; role: string }>();
    if (membership?.role === 'owner') {
      const others = await db
        .prepare(`SELECT count(*) AS n FROM household_members WHERE household_id = ? AND role = 'owner' AND email <> ?`)
        .bind(membership.household_id, email)
        .first<{ n: number }>();
      if ((others?.n ?? 0) === 0) {
        statements.push(...householdDeleteStatements(db, membership.household_id));
        householdDeleted = true;
      }
    }
  }
  await db.batch(statements);
  return c.json({ ok: true, householdDeleted });
});
