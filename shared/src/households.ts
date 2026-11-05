// Households: who belongs to which, invites, and monthly usage caps. Shared by the Worker and the web app.

export const HOUSEHOLD_ROLES = ['owner', 'member'] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

export const USAGE_KINDS = ['plan', 'receipt', 'prep'] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

export type UsageCaps = Record<UsageKind, number>;
export type UsageCounts = Record<UsageKind, number>;

/** Monthly caps when the matching env var is unset or not a whole number. */
export const DEFAULT_USAGE_CAPS: UsageCaps = { plan: 20, receipt: 30, prep: 30 };

/** Env var names for the caps, as set on the Worker. */
export const USAGE_CAP_ENV: Record<UsageKind, string> = {
  plan: 'PLAN_CAP_MONTHLY',
  receipt: 'RECEIPT_CAP_MONTHLY',
  prep: 'PREP_CAP_MONTHLY',
};

/** A cap from an env var: a whole number of zero or more. Anything else keeps the fallback. */
export function parseCap(raw: string | undefined, fallback: number): number {
  const s = raw?.trim() ?? '';
  return /^\d+$/.test(s) ? Number(s) : fallback;
}

/** The Worker env vars that set the caps. */
export interface UsageCapEnv {
  PLAN_CAP_MONTHLY?: string;
  RECEIPT_CAP_MONTHLY?: string;
  PREP_CAP_MONTHLY?: string;
}

export function usageCapsFrom(env: UsageCapEnv): UsageCaps {
  return {
    plan: parseCap(env.PLAN_CAP_MONTHLY, DEFAULT_USAGE_CAPS.plan),
    receipt: parseCap(env.RECEIPT_CAP_MONTHLY, DEFAULT_USAGE_CAPS.receipt),
    prep: parseCap(env.PREP_CAP_MONTHLY, DEFAULT_USAGE_CAPS.prep),
  };
}

/** The month a Toronto calendar day falls in, as YYYY-MM. */
export function usageMonth(torontoDay: string): string {
  return torontoDay.slice(0, 7);
}

/** The first day of the month after `month` (YYYY-MM), as YYYY-MM-DD. */
export function nextMonthStart(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  // Date.UTC treats the month index as zero-based, so monthNumber is already the next month's index.
  return new Date(Date.UTC(year!, monthNumber!, 1)).toISOString().slice(0, 10);
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "December 1, 2026" for a YYYY-MM-DD date. */
export function longDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${MONTH_NAMES[month! - 1]} ${day}, ${year}`;
}

const USAGE_LABEL: Record<UsageKind, { one: string; many: string }> = {
  plan: { one: 'plan', many: 'plans' },
  receipt: { one: 'receipt scan', many: 'receipt scans' },
  prep: { one: 'prep refresh', many: 'prep refreshes' },
};

/** Shown when a household has used up a monthly cap. */
export function usageLimitMessage(kind: UsageKind, cap: number, month: string): string {
  const label = cap === 1 ? USAGE_LABEL[kind].one : USAGE_LABEL[kind].many;
  return `This household has used its ${cap} ${label} for this month. Resets on ${longDate(nextMonthStart(month))}.`;
}

/**
 * "This month: 3 of 20 plans · 2 of 30 receipt scans · 0 of 30 prep refreshes". A household with no caps
 * (an admin's) gets "This month: 3 plans · 2 receipt scans · 0 prep refreshes (no limits)".
 */
export function usageLine(counts: UsageCounts, caps: UsageCaps, unlimited = false): string {
  if (unlimited) {
    const parts = USAGE_KINDS.map((kind) => {
      const label = counts[kind] === 1 ? USAGE_LABEL[kind].one : USAGE_LABEL[kind].many;
      return `${counts[kind]} ${label}`;
    });
    return `This month: ${parts.join(' · ')} (no limits)`;
  }
  const parts = USAGE_KINDS.map((kind) => {
    const label = caps[kind] === 1 ? USAGE_LABEL[kind].one : USAGE_LABEL[kind].many;
    return `${counts[kind]} of ${caps[kind]} ${label}`;
  });
  return `This month: ${parts.join(' · ')}`;
}

// ---- Addresses and names ----

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const HOUSEHOLD_NAME_MAX = 60;

/** A trimmed, lower-case address, or null when it does not look like one. */
export function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  return s.length <= 254 && EMAIL_PATTERN.test(s) ? s : null;
}

/** A trimmed household name, or null when it is empty or too long. */
export function cleanHouseholdName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return s.length > 0 && s.length <= HOUSEHOLD_NAME_MAX ? s : null;
}

/** The name a new household gets for its first member: "alex's household" for alex@example.com. */
export function defaultHouseholdName(email: string): string {
  const local = email.split('@')[0] || 'my';
  return `${local}'s household`.slice(0, HOUSEHOLD_NAME_MAX);
}

// ---- Shapes the members, invites and usage routes return ----

export interface MembersView {
  household: { id: string; name: string };
  me: { email: string; role: HouseholdRole };
  members: { email: string; role: HouseholdRole; joinedAt: string }[];
  invites: { email: string; createdAt: string }[];
}

export interface UsageView {
  month: string;
  resetsOn: string;
  caps: UsageCaps;
  counts: UsageCounts;
  /** True for a household with an admin member: its calls are counted but never refused. */
  unlimited: boolean;
}

export interface InviteSummary {
  householdId: string;
  householdName: string;
  invitedBy: string;
  createdAt: string;
}

export interface MyInvitesView {
  current: { householdId: string; name: string; role: HouseholdRole; memberCount: number };
  invites: InviteSummary[];
}

// ---- App access: who may sign in (admins only) ----

/** Where an approved address comes from: added in the app, listed in Worker settings, or an admin. */
export type AccessSource = 'app' | 'settings' | 'admin';

export interface AccessEntry {
  email: string;
  source: AccessSource;
  addedAt?: string;
  addedBy?: string;
  /** The household this address is a member of, if any. soleOwner: it owns that household and no one else does. */
  household?: { id: string; name: string; role: HouseholdRole; soleOwner: boolean };
}

export interface AccessView {
  entries: AccessEntry[];
  isAdmin: true;
}

/** The signed-in address and whether it is an admin. */
export interface MeView {
  email: string;
  isAdmin: boolean;
}
