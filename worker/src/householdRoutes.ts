// Members, invites, leaving, and the monthly usage view. Mounted under /provisions/api, behind sign-in.
// Owners manage the household; members can read it and leave.
import { Hono } from 'hono';
import {
  cleanEmail,
  cleanHouseholdName,
  nextMonthStart,
  torontoDate,
  usageCapsFrom,
  usageMonth,
  type HouseholdRole,
  type MembersView,
  type MyInvitesView,
  type UsageView,
} from '@provisions/shared';
import { householdDeleteStatements } from './access';
import { sendMail, type MailEnv } from './mail';
import { BASE, normEmail } from './authCore';
import type { AuthMiddlewareEnv, SessionVars } from './authMiddleware';
import { readUsage } from './usage';
import type { UsageCapEnv } from '@provisions/shared';

export type HouseholdEnv = MailEnv & AuthMiddlewareEnv & UsageCapEnv;

export const householdRoutes = new Hono<{ Bindings: HouseholdEnv; Variables: SessionVars }>();

const NOT_OWNER = 'Only the owner can do that.';

const emailParam = (raw: string | undefined) => normEmail(raw ?? '');

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body: unknown = await req.json().catch(() => null);
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

householdRoutes.get('/members', async (c) => {
  const db = c.env.DB;
  const hh = c.get('householdId');
  const household = await db.prepare('SELECT id, name FROM households WHERE id = ?').bind(hh).first<{ id: string; name: string }>();
  if (!household) return c.text('Household not found', 404);

  const members = await db
    .prepare(
      `SELECT email, role, joined_at FROM household_members WHERE household_id = ?
       ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, joined_at, email`,
    )
    .bind(hh)
    .all<{ email: string; role: HouseholdRole; joined_at: string }>();
  const invites = await db
    .prepare('SELECT email, created_at FROM household_invites WHERE household_id = ? ORDER BY created_at, email')
    .bind(hh)
    .all<{ email: string; created_at: string }>();

  const view: MembersView = {
    household: { id: household.id, name: household.name },
    me: { email: c.get('email'), role: c.get('role') },
    members: members.results.map((m) => ({ email: m.email, role: m.role, joinedAt: m.joined_at })),
    invites: invites.results.map((i) => ({ email: i.email, createdAt: i.created_at })),
  };
  return c.json(view);
});

// The household's usage this month, against the caps.
householdRoutes.get('/usage', async (c) => {
  const today = torontoDate();
  const month = usageMonth(today);
  const view: UsageView = {
    month,
    resetsOn: nextMonthStart(month),
    caps: usageCapsFrom(c.env),
    counts: await readUsage(c.env.DB, c.get('householdId'), month),
  };
  return c.json(view);
});

householdRoutes.patch('/household-name', async (c) => {
  if (c.get('role') !== 'owner') return c.text(NOT_OWNER, 403);
  const name = cleanHouseholdName((await readJson(c.req.raw)).name);
  if (!name) return c.text('Name must be 1 to 60 characters', 400);
  await c.env.DB.prepare('UPDATE households SET name = ?, updated_at = ? WHERE id = ?')
    .bind(name, new Date().toISOString(), c.get('householdId'))
    .run();
  return c.json({ name });
});

// Invites an address to this household. The address joins when it signs in. A sign-in email is sent only
// when RESEND_API_KEY is set; if it cannot be sent, the invite still stands and the response says so.
householdRoutes.post('/invites', async (c) => {
  if (c.get('role') !== 'owner') return c.text(NOT_OWNER, 403);
  const db = c.env.DB;
  const hh = c.get('householdId');
  const me = c.get('email');
  const email = cleanEmail((await readJson(c.req.raw)).email);
  if (!email) return c.text('Enter a valid email address', 400);
  if (email === me) return c.text("That's you. You're already in this household.", 409);

  const member = await db
    .prepare('SELECT 1 AS found FROM household_members WHERE household_id = ? AND email = ?')
    .bind(hh, email)
    .first();
  if (member) return c.text("They're already in this household.", 409);

  const createdAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO household_invites (household_id, email, invited_by, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(household_id, email) DO UPDATE SET created_at = excluded.created_at`,
    )
    .bind(hh, email, me, createdAt)
    .run();

  let emailed = false;
  if (c.env.RESEND_API_KEY) {
    const household = await db.prepare('SELECT name FROM households WHERE id = ?').bind(hh).first<{ name: string }>();
    const name = household?.name ?? 'our household';
    const signIn = `${new URL(c.req.url).origin}${BASE}/login`;
    try {
      await sendMail(c.env, {
        fromName: 'Atlas Provisions',
        to: email,
        subject: `You're invited to ${name} on Atlas Provisions`,
        text: `${me} invited you to ${name} on Atlas Provisions.\n\nSign in with this email address to join: ${signIn}\n`,
      });
      emailed = true;
    } catch (e) {
      console.error('invite email failed', e);
    }
  }
  return c.json({ invite: { email, createdAt }, emailed }, 201);
});

householdRoutes.delete('/invites/:email', async (c) => {
  if (c.get('role') !== 'owner') return c.text(NOT_OWNER, 403);
  const res = await c.env.DB.prepare('DELETE FROM household_invites WHERE household_id = ? AND email = ?')
    .bind(c.get('householdId'), emailParam(c.req.param('email')))
    .run();
  if ((res.meta.changes ?? 0) === 0) return c.text('No invite for that address', 404);
  return c.json({ ok: true });
});

/** Leaving: a member just goes. The owner can leave only when no one else is in the household. */
async function leave(db: D1Database, householdId: string, email: string, role: HouseholdRole): Promise<Response | 'left' | 'deleted'> {
  if (role === 'owner') {
    const others = await db
      .prepare('SELECT count(*) AS n FROM household_members WHERE household_id = ? AND email <> ?')
      .bind(householdId, email)
      .first<{ n: number }>();
    if ((others?.n ?? 0) > 0) return new Response('Remove the other members first. You are the owner.', { status: 409 });
    await db.batch(householdDeleteStatements(db, householdId));
    return 'deleted';
  }
  await db.prepare('DELETE FROM household_members WHERE household_id = ? AND email = ?').bind(householdId, email).run();
  return 'left';
}

// Owner removes a member. Removing your own address is leaving.
householdRoutes.delete('/members/:email', async (c) => {
  const db = c.env.DB;
  const hh = c.get('householdId');
  const email = emailParam(c.req.param('email'));
  if (email === c.get('email')) {
    const result = await leave(db, hh, email, c.get('role'));
    if (result instanceof Response) return result;
    return c.json({ ok: true, deleted: result === 'deleted' });
  }
  if (c.get('role') !== 'owner') return c.text(NOT_OWNER, 403);
  const res = await db.prepare('DELETE FROM household_members WHERE household_id = ? AND email = ?').bind(hh, email).run();
  if ((res.meta.changes ?? 0) === 0) return c.text('No member with that address', 404);
  return c.json({ ok: true });
});

householdRoutes.post('/leave', async (c) => {
  const result = await leave(c.env.DB, c.get('householdId'), c.get('email'), c.get('role'));
  if (result instanceof Response) return result;
  return c.json({ ok: true, deleted: result === 'deleted' });
});

// Households this address has been invited to, other than the one it is in now.
householdRoutes.get('/my-invites', async (c) => {
  const db = c.env.DB;
  const hh = c.get('householdId');
  const me = c.get('email');
  const current = await db
    .prepare(
      `SELECT h.id, h.name, m.role, (SELECT count(*) FROM household_members x WHERE x.household_id = h.id) AS member_count
       FROM households h JOIN household_members m ON m.household_id = h.id WHERE m.email = ?`,
    )
    .bind(me)
    .first<{ id: string; name: string; role: HouseholdRole; member_count: number }>();
  if (!current) return c.text('Household not found', 404);
  const invites = await db
    .prepare(
      `SELECT i.household_id, h.name, i.invited_by, i.created_at
       FROM household_invites i JOIN households h ON h.id = i.household_id
       WHERE i.email = ? AND i.household_id <> ? ORDER BY i.created_at, i.household_id`,
    )
    .bind(me, hh)
    .all<{ household_id: string; name: string; invited_by: string; created_at: string }>();
  const view: MyInvitesView = {
    current: { householdId: current.id, name: current.name, role: current.role, memberCount: current.member_count },
    invites: invites.results.map((i) => ({
      householdId: i.household_id,
      householdName: i.name,
      invitedBy: i.invited_by,
      createdAt: i.created_at,
    })),
  };
  return c.json(view);
});

// Joins an invited household. The current household is left; when this address was its only member, it is
// deleted with its data. An owner with others in the household cannot leave it.
householdRoutes.post('/invites/accept', async (c) => {
  const db = c.env.DB;
  const me = c.get('email');
  const current = c.get('householdId');
  const target = (await readJson(c.req.raw)).householdId;
  if (typeof target !== 'string' || target.length === 0) return c.text('Choose a household to join', 400);
  if (target === current) return c.text("You're already in that household.", 400);

  const invite = await db
    .prepare(
      `SELECT h.name FROM household_invites i JOIN households h ON h.id = i.household_id
       WHERE i.household_id = ? AND i.email = ?`,
    )
    .bind(target, me)
    .first<{ name: string }>();
  if (!invite) return c.text('No invite for that household', 404);

  const size = await db
    .prepare('SELECT count(*) AS n FROM household_members WHERE household_id = ?')
    .bind(current)
    .first<{ n: number }>();
  const soleMember = (size?.n ?? 0) <= 1;
  const currentName = await db.prepare('SELECT name FROM households WHERE id = ?').bind(current).first<{ name: string }>();
  if (c.get('role') === 'owner' && !soleMember) {
    return c.text(
      `You own ${currentName?.name ?? 'your household'}, and others are in it. Remove them first, then you can join another household.`,
      409,
    );
  }

  const statements = soleMember
    ? householdDeleteStatements(db, current)
    : [db.prepare('DELETE FROM household_members WHERE household_id = ? AND email = ?').bind(current, me)];
  statements.push(
    db
      .prepare(`INSERT INTO household_members (household_id, email, role, joined_at) VALUES (?, ?, 'member', ?)`)
      .bind(target, me, new Date().toISOString()),
    db.prepare('DELETE FROM household_invites WHERE household_id = ? AND email = ?').bind(target, me),
  );
  await db.batch(statements);
  return c.json({ householdId: target, name: invite.name, deleted: soleMember });
});
