// Monthly usage per household: plans, prep refreshes and receipt scans. Counted after a call succeeds, and
// checked before the next one starts. The caps come from env vars (see shared/src/households.ts).
import {
  USAGE_KINDS,
  usageLimitMessage,
  type UsageCaps,
  type UsageCounts,
  type UsageKind,
} from '@provisions/shared';

export async function readUsage(db: D1Database, householdId: string, month: string): Promise<UsageCounts> {
  const { results } = await db
    .prepare('SELECT kind, count FROM usage WHERE household_id = ? AND month = ?')
    .bind(householdId, month)
    .all<{ kind: UsageKind; count: number }>();
  const counts: UsageCounts = { plan: 0, receipt: 0, prep: 0 };
  for (const r of results) if (USAGE_KINDS.includes(r.kind)) counts[r.kind] = r.count;
  return counts;
}

/** The message to send instead of running the call, when the household has used up this month's cap. */
export async function capMessage(
  db: D1Database,
  householdId: string,
  kind: UsageKind,
  caps: UsageCaps,
  month: string,
): Promise<string | null> {
  const used = (await readUsage(db, householdId, month))[kind];
  return used >= caps[kind] ? usageLimitMessage(kind, caps[kind], month) : null;
}

export async function recordUsage(db: D1Database, householdId: string, kind: UsageKind, month: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO usage (household_id, month, kind, count) VALUES (?, ?, ?, 1)
       ON CONFLICT(household_id, month, kind) DO UPDATE SET count = count + 1`,
    )
    .bind(householdId, month, kind)
    .run();
}
