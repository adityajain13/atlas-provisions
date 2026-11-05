import { describe, expect, it } from 'vitest';
import { accessOutcome, accessSourceLabel, inviteOutcome, joinDecision, leaveCopy, removeAccessCopy, roleLabel } from './members';

describe('roleLabel', () => {
  it('names the two roles', () => {
    expect(roleLabel('owner')).toBe('Owner');
    expect(roleLabel('member')).toBe('Member');
  });
});

describe('inviteOutcome', () => {
  it('confirms the invite, and says when no email went out', () => {
    expect(inviteOutcome('partner@example.com', true)).toBe('Invited partner@example.com.');
    expect(inviteOutcome('partner@example.com', false)).toBe('Invited (email not sent; tell them to sign in).');
  });
});

describe('leaveCopy', () => {
  it('warns that the household is deleted when its owner is its only member', () => {
    expect(leaveCopy('Home', 'owner', 1)).toMatchObject({ title: 'Delete Home?', confirmLabel: 'Delete household' });
    expect(leaveCopy('Home', 'owner', 1).message).toMatch(/deleted/);
  });

  it('says only that the leaver loses access for a member, or an owner with others', () => {
    expect(leaveCopy('Home', 'member', 3)).toMatchObject({ title: 'Leave Home?', confirmLabel: 'Leave household' });
    expect(leaveCopy('Home', 'member', 3).message).not.toMatch(/deleted/);
  });
});

describe('joinDecision', () => {
  const target = { name: 'The Smiths' };

  it('refuses an owner who has others in its household', () => {
    const d = joinDecision({ name: 'Home', role: 'owner', memberCount: 2 }, target);
    expect(d.canJoin).toBe(false);
    expect(d.blocked).toBe('You own Home, and others are in it. Remove them first, then you can join.');
  });

  it('warns that a household with only the joiner in it is deleted, with a red confirm', () => {
    const d = joinDecision({ name: "alex's household", role: 'owner', memberCount: 1 }, target);
    expect(d).toMatchObject({ canJoin: true, danger: true, confirmLabel: 'Join and delete' });
    expect(d.message).toMatch(/only you in it/);
  });

  it('says a member simply leaves its household, and keeps the confirm plain', () => {
    const d = joinDecision({ name: 'Home', role: 'member', memberCount: 3 }, target);
    expect(d).toMatchObject({ canJoin: true, danger: false, confirmLabel: 'Join' });
    expect(d.message).toBe('You will leave Home. The others in it keep it.');
  });
});

describe('accessSourceLabel', () => {
  it('says where each kind of access comes from', () => {
    expect(accessSourceLabel('app')).toBe('Added in app');
    expect(accessSourceLabel('settings')).toBe('From Worker settings');
    expect(accessSourceLabel('admin')).toBe('Admin');
  });
});

describe('accessOutcome', () => {
  it('confirms the access, and says when an asked-for email did not go out', () => {
    expect(accessOutcome('new@example.com', true, true)).toBe('Gave access to new@example.com. Sent them an email.');
    expect(accessOutcome('new@example.com', true, false)).toBe(
      "Gave access to new@example.com. The email wasn't sent; tell them to sign in.",
    );
  });

  it('does not mention email when none was asked for', () => {
    expect(accessOutcome('new@example.com', false, false)).toBe('Gave access to new@example.com.');
  });
});

describe('removeAccessCopy', () => {
  it('asks to remove the address, and says they are signed out', () => {
    expect(removeAccessCopy('new@example.com', false)).toEqual({
      title: 'Remove new@example.com?',
      message: "They're signed out right away. They can only get back in if someone invites them to their household.",
      confirmLabel: 'Remove',
    });
  });

  it('offers to delete their household only when they own one', () => {
    expect(removeAccessCopy('new@example.com', true).checkbox).toBe('Also delete their household and its data');
    expect(removeAccessCopy('new@example.com', false)).not.toHaveProperty('checkbox');
  });
});
