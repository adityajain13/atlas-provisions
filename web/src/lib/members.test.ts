import { describe, expect, it } from 'vitest';
import { inviteOutcome, joinDecision, leaveCopy, roleLabel } from './members';

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
