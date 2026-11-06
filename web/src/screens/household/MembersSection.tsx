import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { usageLine, type MembersView, type UsageView } from '@provisions/shared';
import {
  cancelInvite,
  errorMessage,
  getMembers,
  getUsage,
  inviteMember,
  leaveHousehold,
  removeMember,
  renameHousehold,
} from '../../api';
import { inviteOutcome, leaveCopy, roleLabel } from '../../lib/members';
import { useConfirm } from '../../components/ConfirmDialog';
import { Section } from '../../components/Section';
import { addBtn, eyebrow, fieldCls, linkBtn, removeIconBtn } from '../../components/ui';

import { ERROR_TEXT } from './ui';

// ---------- members ----------

/**
 * Who is in this household, and the invites out. The owner renames it, invites, cancels invites and removes
 * members. A member sees the same list read only, and can leave. Usage this month is shown at the bottom.
 */
export function MembersSection() {
  const confirm = useConfirm();
  const [view, setView] = useState<MembersView | null>(null);
  const [usage, setUsage] = useState<UsageView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [inviteText, setInviteText] = useState('');
  const [inviteNote, setInviteNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    getMembers()
      .then((v) => {
        setView(v);
        setName(v.household.name);
        setLoadError(null);
      })
      .catch((e: unknown) => setLoadError(errorMessage(e)));
    getUsage()
      .then(setUsage)
      .catch(() => setUsage(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loadError) {
    return (
      <Section title="Members">
        <p className={`text-[14px] ${ERROR_TEXT}`}>Could not load: {loadError}</p>
      </Section>
    );
  }
  if (!view) {
    return (
      <Section title="Members">
        <p className="text-[14px] text-muted">Loading&hellip;</p>
      </Section>
    );
  }

  const owner = view.me.role === 'owner';
  const alone = view.members.length <= 1;

  async function rename() {
    const next = name.trim();
    if (next === view!.household.name) return;
    if (next.length === 0 || next.length > 60) {
      setNameError('Use 1 to 60 characters');
      return;
    }
    try {
      await renameHousehold(next);
      setNameError(null);
      setView((v) => (v ? { ...v, household: { ...v.household, name: next } } : v));
    } catch (e) {
      setNameError(errorMessage(e));
    }
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    const email = inviteText.trim();
    if (!email) return;
    setActionError(null);
    try {
      const result = await inviteMember(email);
      setInviteNote(inviteOutcome(result.invite.email, result.emailed));
      setInviteText('');
      load();
    } catch (err) {
      setInviteNote(null);
      setActionError(errorMessage(err));
    }
  }

  async function cancel(email: string) {
    setActionError(null);
    try {
      await cancelInvite(email);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function remove(email: string) {
    const ok = await confirm({
      title: `Remove ${email}?`,
      message: 'They lose access to this household. An invite brings them back.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    setActionError(null);
    try {
      await removeMember(email);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function leave() {
    const copy = leaveCopy(view!.household.name, view!.me.role, view!.members.length);
    const ok = await confirm({ title: copy.title, message: copy.message, confirmLabel: copy.confirmLabel, danger: true });
    if (!ok) return;
    setActionError(null);
    try {
      await leaveHousehold();
      // Signing in again finds the household this address now belongs to, or sends it to sign in.
      window.location.assign('/provisions/');
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  return (
    <Section title="Members" caption="Everyone here shares the pantry, plans and ticks.">
      <label className="block">
        <span className={eyebrow}>Household name</span>
        {owner ? (
          <input
            className={`${fieldCls} mt-2`}
            value={name}
            maxLength={60}
            aria-invalid={nameError !== null}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void rename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        ) : (
          <p className="mt-2 text-[15px] text-paper">{view.household.name}</p>
        )}
        {nameError && <span className={`mt-1 block text-[12px] ${ERROR_TEXT}`}>{nameError}</span>}
      </label>

      <ul className="mt-6 divide-y divide-line">
        {view.members.map((m) => {
          const you = m.email === view.me.email;
          return (
            <li key={m.email} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-[15px] text-paper">
                {m.email}
                {you && <span className="ml-2 text-[12px] text-muted">You</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[12px] text-muted">
                {roleLabel(m.role)}
                {owner && !you && (
                  <button
                    type="button"
                    aria-label={`Remove ${m.email}`}
                    onClick={() => void remove(m.email)}
                    className={removeIconBtn}
                  >
                    &times;
                  </button>
                )}
              </span>
            </li>
          );
        })}
        {view.invites.map((i) => (
          <li key={`invite-${i.email}`} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 truncate text-[15px] text-muted">{i.email}</span>
            <span className="flex shrink-0 items-center gap-2 text-[12px] text-muted">
              Invited
              {owner && (
                <button
                  type="button"
                  aria-label={`Cancel invite for ${i.email}`}
                  onClick={() => void cancel(i.email)}
                  className={removeIconBtn}
                >
                  &times;
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>

      {owner && (
        <form onSubmit={invite} noValidate className="mt-6">
          <label className="block">
            <span className={eyebrow}>Invite someone</span>
            <span className="mt-2 flex gap-2">
              <input
                type="email"
                className={fieldCls}
                placeholder="name@example.com"
                aria-label="Email to invite"
                value={inviteText}
                onChange={(e) => {
                  setInviteText(e.target.value);
                  setInviteNote(null);
                }}
              />
              <button type="submit" className={addBtn} disabled={inviteText.trim() === ''}>
                Invite
              </button>
            </span>
          </label>
          <span className="mt-2 block text-[12px] text-muted">They sign in with this email at adityajain.ca/provisions.</span>
          {inviteNote && <span className="mt-2 block text-[13px] text-paper">{inviteNote}</span>}
        </form>
      )}

      {actionError && <p className={`mt-3 text-[13px] ${ERROR_TEXT}`}>{actionError}</p>}
      {usage && <p className="mt-6 text-[13px] text-muted">{usageLine(usage.counts, usage.caps, usage.unlimited)}</p>}

      <div className="mt-6 border-t border-line pt-4">
        <button type="button" onClick={() => void leave()} className={linkBtn}>
          {owner && alone ? 'Delete household' : 'Leave household'}
        </button>
      </div>
    </Section>
  );
}
