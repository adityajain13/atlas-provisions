// Who may use the app, which household they work in, and who may manage that. Checked on every signed-in request.
//
// Admins: the addresses in ADMIN_EMAILS (comma list). When ADMIN_EMAILS is unset or blank, the admins are the owners
// of household 'h1', the household that existing data moved into (migration 0008).
//
// Approved: on ALLOWED_EMAILS, in the allowed_emails table (managed in the app under Household > App access), or an admin.
//
// An address may use the app when it is approved; or it is a member of a household with at least one approved owner;
// or, with no household yet, it has an invite from a household with at least one approved owner. So removing an
// owner's approval blocks the owner, and the members of their household too, unless a member is approved themselves.
//
// An address with no household joins the household it was invited to (the oldest usable invite), or, when it is
// approved, gets a household of its own. A household membership decides on its own: an address in a household with
// no approved owner is blocked even if it has an invite elsewhere, so the sign-in check and the per-request check agree.
import { defaultHousehold, defaultHouseholdName, type HouseholdRole } from '@provisions/shared';
import { isAllowed, normEmail, parseAllowList, randomToken } from './authCore';

export interface Access {
  householdId: string;
  role: HouseholdRole;
}

/** The Worker settings that decide who may use the app. Both are optional. */
export interface AccessEnv {
  /** Fallback: comma-separated addresses that are approved. The app's own list works without it. */
  ALLOWED_EMAILS?: string;
  /** Comma-separated admins. Unset or blank: the owners of household h1 are the admins. */
  ADMIN_EMAILS?: string;
}

/** The household that existing data moved into (migration 0008). Its owners are the admins when ADMIN_EMAILS is unset. */
export const HOUSEHOLD_H1 = 'h1';

const memberOf = async (db: D1Database, email: string): Promise<Access | null> => {
  const row = await db
    .prepare('SELECT household_id, role FROM household_members WHERE email = ?')
    .bind(email)
    .first<{ household_id: string; role: HouseholdRole }>();
  return row ? { householdId: row.household_id, role: row.role } : null;
};

/** The households this address has been invited to, oldest first. */
const invitesFor = async (db: D1Database, email: string): Promise<string[]> => {
  const { results } = await db
    .prepare('SELECT household_id FROM household_invites WHERE email = ? ORDER BY created_at, household_id')
    .bind(email)
    .all<{ household_id: string }>();
  return results.map((r) => r.household_id);
};

const inAppList = async (db: D1Database, email: string): Promise<boolean> =>
  (await db.prepare('SELECT 1 AS found FROM allowed_emails WHERE email = ?').bind(email).first()) !== null;

/** The addresses that are admins: ADMIN_EMAILS when it lists any, else the owners of h1. */
export async function adminEmails(db: D1Database, env: AccessEnv): Promise<string[]> {
  const listed = parseAllowList(env.ADMIN_EMAILS);
  if (listed.size > 0) return [...listed];
  const { results } = await db
    .prepare(`SELECT email FROM household_members WHERE household_id = ? AND role = 'owner' ORDER BY joined_at, email`)
    .bind(HOUSEHOLD_H1)
    .all<{ email: string }>();
  return results.map((r) => r.email);
}

/** Whether the address is an admin. */
export async function isAdmin(db: D1Database, env: AccessEnv, email: string): Promise<boolean> {
  const e = normEmail(email);
  if (parseAllowList(env.ADMIN_EMAILS).size > 0) return isAllowed(env.ADMIN_EMAILS, e);
  const row = await db
    .prepare(`SELECT 1 AS found FROM household_members WHERE household_id = ? AND role = 'owner' AND email = ?`)
    .bind(HOUSEHOLD_H1, e)
    .first();
  return row !== null;
}

/** Whether any member of the household is an admin. Such a household has no usage caps. */
export async function householdHasAdmin(db: D1Database, env: AccessEnv, householdId: string): Promise<boolean> {
  const { results } = await db
    .prepare('SELECT email FROM household_members WHERE household_id = ?')
    .bind(householdId)
    .all<{ email: string }>();
  for (const m of results) if (await isAdmin(db, env, m.email)) return true;
  return false;
}

/** Whether the address is approved: on ALLOWED_EMAILS, in the app's list, or an admin. */
export async function isApproved(db: D1Database, env: AccessEnv, email: string): Promise<boolean> {
  const e = normEmail(email);
  if (isAllowed(env.ALLOWED_EMAILS, e)) return true;
  if (await inAppList(db, e)) return true;
  return isAdmin(db, env, e);
}

/** Whether the household has at least one owner who is approved. */
export async function hasApprovedOwner(db: D1Database, env: AccessEnv, householdId: string): Promise<boolean> {
  const { results } = await db
    .prepare(`SELECT email FROM household_members WHERE household_id = ? AND role = 'owner' ORDER BY joined_at, email`)
    .bind(householdId)
    .all<{ email: string }>();
  for (const owner of results) if (await isApproved(db, env, owner.email)) return true;
  return false;
}

type Plan =
  | { kind: 'member'; access: Access }
  | { kind: 'join'; householdId: string }
  | { kind: 'create' }
  | { kind: 'none' };

/** What the rules say for this address, without changing anything. */
async function planAccess(db: D1Database, env: AccessEnv, email: string): Promise<Plan> {
  const e = normEmail(email);
  const approved = await isApproved(db, env, e);
  const member = await memberOf(db, e);
  if (member) {
    const usable = approved || (await hasApprovedOwner(db, env, member.householdId));
    return usable ? { kind: 'member', access: member } : { kind: 'none' };
  }
  for (const householdId of await invitesFor(db, e)) {
    if (await hasApprovedOwner(db, env, householdId)) return { kind: 'join', householdId };
  }
  return approved ? { kind: 'create' } : { kind: 'none' };
}

/** Whether the address may sign in at all. Used before a session exists (sign-in) and matches resolveAccess. */
export async function mayUseApp(db: D1Database, env: AccessEnv, email: string): Promise<boolean> {
  return (await planAccess(db, env, email)).kind !== 'none';
}

/**
 * The household an address works in, joining or creating it first when the rules say so. Null when the address may
 * not use the app. Order: an existing membership; else the oldest usable invite (joined as a member); else, when
 * approved, a new household with the address as owner.
 */
export async function resolveAccess(
  db: D1Database,
  env: AccessEnv,
  email: string,
  now: Date = new Date(),
): Promise<Access | null> {
  const e = normEmail(email);
  const plan = await planAccess(db, env, e);
  if (plan.kind === 'member') return plan.access;
  if (plan.kind === 'none') return null;

  const joinedAt = now.toISOString();
  if (plan.kind === 'join') {
    await db.batch([
      db
        .prepare(
          `INSERT OR IGNORE INTO household_members (household_id, email, role, joined_at) VALUES (?, ?, 'member', ?)`,
        )
        .bind(plan.householdId, e, joinedAt),
      db
        .prepare('DELETE FROM household_invites WHERE household_id = ? AND email = ?')
        .bind(plan.householdId, e),
    ]);
    return (await memberOf(db, e)) ?? null;
  }

  const householdId = `h_${randomToken(12)}`;
  await db.batch([
    db
      .prepare('INSERT INTO households (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(householdId, defaultHouseholdName(e), JSON.stringify({ ...defaultHousehold(), setupDone: false }), joinedAt, joinedAt),
    db
      .prepare(`INSERT OR IGNORE INTO household_members (household_id, email, role, joined_at) VALUES (?, ?, 'owner', ?)`)
      .bind(householdId, e, joinedAt),
  ]);
  const after = await memberOf(db, e);
  if (after && after.householdId !== householdId) {
    // Another request made this address's household first. Drop the one this request made.
    await db.prepare('DELETE FROM households WHERE id = ?').bind(householdId).run();
  }
  return after;
}

/**
 * The statements that delete a household and every row scoped to it. Used when its last member leaves, when
 * its only member joins another household, or when an admin removes an owner's access with its household. Run them in one batch.
 */
export function householdDeleteStatements(db: D1Database, householdId: string): D1PreparedStatement[] {
  return [
    db.prepare('DELETE FROM pantry_items WHERE household_id = ?').bind(householdId),
    db.prepare('DELETE FROM meal_ratings WHERE household_id = ?').bind(householdId),
    db.prepare('DELETE FROM ingredient_feedback WHERE household_id = ?').bind(householdId),
    db.prepare('DELETE FROM meal_plans WHERE household_id = ?').bind(householdId),
    db.prepare('DELETE FROM checks WHERE household_id = ?').bind(householdId),
    db.prepare('DELETE FROM usage WHERE household_id = ?').bind(householdId),
    db.prepare('DELETE FROM household_invites WHERE household_id = ?').bind(householdId),
    db.prepare('DELETE FROM household_members WHERE household_id = ?').bind(householdId),
    db.prepare('DELETE FROM households WHERE id = ?').bind(householdId),
  ];
}
