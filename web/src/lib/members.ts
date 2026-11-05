// Wording and decisions for the household members UI. Pure: no DOM, no requests.
import type { HouseholdRole } from '@provisions/shared';

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
