// Who may use the app, and which household they work in. Checked on every signed-in request.
//
// An address may use the app when it is on ALLOWED_EMAILS, belongs to a household, or has an invite. On each
// request, an address with no household joins the household it was invited to (the oldest invite), or, when
// it is on ALLOWED_EMAILS, gets a household of its own. Membership is the only thing a removal changes: a
// removed member is blocked, or lands in a new household of their own when they are on ALLOWED_EMAILS.
import { defaultHousehold, defaultHouseholdName, type HouseholdRole } from '@provisions/shared';
import { isAllowed, randomToken } from './authCore';

export interface Access {
  householdId: string;
  role: HouseholdRole;
}

const memberOf = async (db: D1Database, email: string): Promise<Access | null> => {
  const row = await db
    .prepare('SELECT household_id, role FROM household_members WHERE email = ?')
    .bind(email)
    .first<{ household_id: string; role: HouseholdRole }>();
  return row ? { householdId: row.household_id, role: row.role } : null;
};

/** Whether the address may sign in at all: allow-listed, a member of a household, or invited to one. */
export async function mayUseApp(db: D1Database, allowList: string | undefined, email: string): Promise<boolean> {
  if (isAllowed(allowList, email)) return true;
  if ((await memberOf(db, email)) !== null) return true;
  const invite = await db.prepare('SELECT 1 AS found FROM household_invites WHERE email = ? LIMIT 1').bind(email).first();
  return invite !== null;
}

/**
 * The household an address works in, joining it first when that is due. Null when the address may not use
 * the app. Order: an existing membership; else the oldest invite (joined as a member); else, when on
 * ALLOWED_EMAILS, a new household with the address as owner.
 */
export async function resolveAccess(
  db: D1Database,
  allowList: string | undefined,
  email: string,
  now: Date = new Date(),
): Promise<Access | null> {
  const existing = await memberOf(db, email);
  if (existing) return existing;

  const joinedAt = now.toISOString();
  const invite = await db
    .prepare('SELECT household_id FROM household_invites WHERE email = ? ORDER BY created_at, household_id LIMIT 1')
    .bind(email)
    .first<{ household_id: string }>();
  if (invite) {
    await db.batch([
      db
        .prepare(
          `INSERT OR IGNORE INTO household_members (household_id, email, role, joined_at) VALUES (?, ?, 'member', ?)`,
        )
        .bind(invite.household_id, email, joinedAt),
      db.prepare('DELETE FROM household_invites WHERE household_id = ? AND email = ?').bind(invite.household_id, email),
    ]);
    return (await memberOf(db, email)) ?? null;
  }

  if (!isAllowed(allowList, email)) return null;

  const householdId = `h_${randomToken(12)}`;
  await db.batch([
    db
      .prepare('INSERT INTO households (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(householdId, defaultHouseholdName(email), JSON.stringify(defaultHousehold()), joinedAt, joinedAt),
    db
      .prepare(`INSERT OR IGNORE INTO household_members (household_id, email, role, joined_at) VALUES (?, ?, 'owner', ?)`)
      .bind(householdId, email, joinedAt),
  ]);
  const after = await memberOf(db, email);
  if (after && after.householdId !== householdId) {
    // Another request made this address's household first. Drop the one this request made.
    await db.prepare('DELETE FROM households WHERE id = ?').bind(householdId).run();
  }
  return after;
}

/**
 * The statements that delete a household and every row scoped to it. Used when its last member leaves, or when
 * its only member joins another household. Run them in one batch.
 */
export function householdDeleteStatements(db: D1Database, householdId: string): D1PreparedStatement[] {
  return [
    db.prepare('DELETE FROM pantry_items WHERE household_id = ?').bind(householdId),
    db.prepare('DELETE FROM meal_ratings WHERE household_id = ?').bind(householdId),
    db.prepare('DELETE FROM meal_plans WHERE household_id = ?').bind(householdId),
    db.prepare('DELETE FROM checks WHERE household_id = ?').bind(householdId),
    db.prepare('DELETE FROM usage WHERE household_id = ?').bind(householdId),
    db.prepare('DELETE FROM household_invites WHERE household_id = ?').bind(householdId),
    db.prepare('DELETE FROM household_members WHERE household_id = ?').bind(householdId),
    db.prepare('DELETE FROM households WHERE id = ?').bind(householdId),
  ];
}
