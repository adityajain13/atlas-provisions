import { useEffect, useState } from 'react';
import { acceptInvite, errorMessage, getMyInvites } from '../api';
import { useConfirm } from './ConfirmDialog';
import { joinDecision } from '../lib/members';
import type { MyInvitesView } from '@provisions/shared';

const ERROR_TEXT = 'text-[#D98C7A]';

/**
 * Shown at the top of every signed-in page while an address has an invite to another household. Joining asks
 * first, and says what happens to the household this address is in now.
 */
export function InviteBanner() {
  const confirm = useConfirm();
  const [view, setView] = useState<MyInvitesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getMyInvites()
      .then((v) => {
        if (alive) setView(v);
      })
      .catch(() => {
        // The banner is an extra: a failed check shows nothing rather than an error on every page.
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!view || view.invites.length === 0) return null;
  const invite = view.invites[0]!;
  const decision = joinDecision(view.current, { name: invite.householdName });

  async function join() {
    const ok = await confirm({
      title: decision.title,
      message: decision.message,
      confirmLabel: decision.confirmLabel,
      danger: decision.danger,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await acceptInvite(invite.householdId);
      // Everything on the page belongs to the old household, so reload into the new one.
      window.location.assign('/provisions/');
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div role="status" className="border-b border-line bg-field px-4 py-3 lg:px-8">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-paper">
          You&rsquo;re invited to join <span className="font-medium">{invite.householdName}</span>.
          {!decision.canJoin && <span className={`block text-[13px] ${ERROR_TEXT}`}>{decision.blocked}</span>}
          {error && <span className={`block text-[13px] ${ERROR_TEXT}`}>{error}</span>}
        </p>
        {decision.canJoin && (
          <button
            type="button"
            onClick={() => void join()}
            disabled={busy}
            className="h-11 shrink-0 rounded-lg bg-herb px-4 text-[14px] font-medium text-ink disabled:opacity-40"
          >
            {busy ? 'Joining…' : 'Join'}
          </button>
        )}
      </div>
    </div>
  );
}
