// Wording and decisions for the household members UI. Pure: no DOM, no requests.
import type { AccessSource, HouseholdRole } from '@provisions/shared';

export const roleLabel = (role: HouseholdRole): string => (role === 'owner' ? 'Owner' : 'Member');

/** The line under the invite form after an invite is sent. */
export function inviteOutcome(email: string, emailed: boolean): string {
  return emailed ? `Invited ${email}.` : 'Invited (email not sent; tell them to sign in).';
}

export interface LeaveCopy {
  title: string;
  message: string;
  confirmLabel: string;
}

/**
 * What leaving says. The household is deleted only when its owner leaves and no one else is in it, and then
 * the confirm says so.
 */
export function leaveCopy(name: string, role: HouseholdRole, memberCount: number): LeaveCopy {
  if (role === 'owner' && memberCount <= 1) {
    return {
      title: `Delete ${name}?`,
      message: 'You are the only member, so the household and everything in it (pantry, plans, ratings, ticks) will be deleted.',
      confirmLabel: 'Delete household',
    };
  }
  return {
    title: `Leave ${name}?`,
    message: 'You will lose access to this household. Someone in it can invite you back.',
    confirmLabel: 'Leave household',
  };
}

export interface JoinDecision {
  /** False when the current household cannot be left (its owner has others in it). */
  canJoin: boolean;
  /** Why the join is refused, when it is. */
  blocked?: string;
  title: string;
  message: string;
  confirmLabel: string;
  /** Red confirm: the current household and its data will be deleted. */
  danger: boolean;
}

/** The banner's join decision: what happens to the household this address is in now. */
export function joinDecision(
  current: { name: string; role: HouseholdRole; memberCount: number },
  target: { name: string },
): JoinDecision {
  if (current.role === 'owner' && current.memberCount > 1) {
    return {
      canJoin: false,
      blocked: `You own ${current.name}, and others are in it. Remove them first, then you can join.`,
      title: `Join ${target.name}?`,
      message: '',
      confirmLabel: 'Join',
      danger: false,
    };
  }
  if (current.memberCount <= 1) {
    return {
      canJoin: true,
      title: `Join ${target.name}?`,
      message: `${current.name} has only you in it, so it and everything in it (pantry, plans, ratings, ticks) will be deleted.`,
      confirmLabel: 'Join and delete',
      danger: true,
    };
  }
  return {
    canJoin: true,
    title: `Join ${target.name}?`,
    message: `You will leave ${current.name}. The others in it keep it.`,
    confirmLabel: 'Join',
    danger: false,
  };
}

// ---- App access (admins) ----

const ACCESS_SOURCE_LABEL: Record<AccessSource, string> = {
  app: 'Added in app',
  settings: 'From Worker settings',
  admin: 'Admin',
};

/** Where an approved address's access comes from, in a small label under its address. */
export const accessSourceLabel = (source: AccessSource): string => ACCESS_SOURCE_LABEL[source];

/** The line under the add form after access is given. `asked` is whether the person ticked "Send them an email". */
export function accessOutcome(email: string, asked: boolean, emailed: boolean): string {
  if (!asked) return `Gave access to ${email}.`;
  return emailed
    ? `Gave access to ${email}. Sent them an email.`
    : `Gave access to ${email}. The email wasn't sent; tell them to sign in.`;
}

export interface RemoveAccessCopy {
  title: string;
  message: string;
  confirmLabel: string;
  /** The tick box, shown only when the address owns a household of its own. Unticked by default. */
  checkbox?: string;
}

/** What removing an address's app access says. The household box appears only when they own one alone. */
export function removeAccessCopy(email: string, ownsHousehold: boolean): RemoveAccessCopy {
  return {
    title: `Remove ${email}?`,
    message: "They're signed out right away. They can only get back in if someone invites them to their household.",
    confirmLabel: 'Remove',
    ...(ownsHousehold ? { checkbox: 'Also delete their household and its data' } : {}),
  };
}
