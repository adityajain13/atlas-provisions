import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { type AccessEntry, type AccessView, type MeView } from '@provisions/shared';
import { errorMessage, getAccess, getMe, giveAccess, revokeAccess } from '../../api';
import { accessOutcome, accessSourceLabel, removeAccessCopy, roleLabel } from '../../lib/members';
import { useSaveStatus } from '../../components/SaveStatus';
import { useConfirmChoice } from '../../components/ConfirmDialog';
import { Section } from '../../components/Section';
import { addBtn, eyebrow, fieldCls, removeIconBtn } from '../../components/ui';

import { ERROR_TEXT } from './ui';

// ---------- app access ----------

const ACCESS_CAPTION = "Who can sign in and get their own household. Members you invite to a household don't need to be here.";

/**
 * Who may sign in. Only admins see it. Lists every approved address, where its access comes from, and the household
 * each is in. Giving access can send the sign-in email; removing it signs the address out at once.
 */
export function AccessSection() {
  const ask = useConfirmChoice();
  const { track } = useSaveStatus();
  const [me, setMe] = useState<MeView | null>(null);
  const [view, setView] = useState<AccessView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addText, setAddText] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    getAccess()
      .then((v) => {
        setView(v);
        setLoadError(null);
      })
      .catch((e: unknown) => setLoadError(errorMessage(e)));
  }, []);

  useEffect(() => {
    let alive = true;
    getMe()
      .then((m) => {
        if (!alive) return;
        setMe(m);
        if (m.isAdmin) load();
      })
      .catch(() => {
        if (alive) setMe({ email: '', isAdmin: false });
      });
    return () => {
      alive = false;
    };
  }, [load]);

  if (!me?.isAdmin) return null;

  async function give(e: FormEvent) {
    e.preventDefault();
    const email = addText.trim();
    if (!email) return;
    setActionError(null);
    setNote(null);
    try {
      const result = await track(giveAccess(email, sendEmail));
      setNote(accessOutcome(result.entry.email, sendEmail, result.emailed));
      setAddText('');
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function revoke(entry: AccessEntry) {
    const ownsHousehold = entry.household?.role === 'owner' && entry.household.soleOwner;
    const copy = removeAccessCopy(entry.email, ownsHousehold);
    const answer = await ask({
      title: copy.title,
      message: copy.message,
      confirmLabel: copy.confirmLabel,
      danger: true,
      checkbox: copy.checkbox ? { label: copy.checkbox, checked: false } : undefined,
    });
    if (!answer.ok) return;
    setActionError(null);
    setNote(null);
    try {
      await track(revokeAccess(entry.email, ownsHousehold && answer.checked));
      setNote(`Removed ${entry.email}.`);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  if (loadError) {
    return (
      <Section title="App access" caption={ACCESS_CAPTION}>
        <p className={`text-[14px] ${ERROR_TEXT}`}>Could not load: {loadError}</p>
      </Section>
    );
  }
  if (!view) {
    return (
      <Section title="App access" caption={ACCESS_CAPTION}>
        <p className="text-[14px] text-muted">Loading&hellip;</p>
      </Section>
    );
  }

  return (
    <Section title="App access" caption={ACCESS_CAPTION}>
      <ul className="divide-y divide-line">
        {view.entries.map((entry) => {
          const you = entry.email === me.email;
          return (
            <li key={entry.email} className="flex items-start justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-[15px] text-paper">
                  {entry.email}
                  {you && <span className="ml-2 text-[12px] text-muted">You</span>}
                </span>
                <span className="block text-[12px] text-muted">{accessSourceLabel(entry.source)}</span>
                {entry.household && (
                  <span className="block truncate text-[12px] text-muted">
                    {entry.household.name} · {roleLabel(entry.household.role)}
                  </span>
                )}
              </span>
              {entry.source === 'app' && !you && (
                <button
                  type="button"
                  aria-label={`Remove access for ${entry.email}`}
                  onClick={() => void revoke(entry)}
                  className={removeIconBtn}
                >
                  &times;
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <form onSubmit={give} noValidate className="mt-6">
        <label className="block">
          <span className={eyebrow}>Add an address</span>
          <span className="mt-2 flex gap-2">
            <input
              type="email"
              className={fieldCls}
              placeholder="name@example.com"
              aria-label="Email to give access"
              value={addText}
              onChange={(e) => {
                setAddText(e.target.value);
                setNote(null);
              }}
            />
            <button type="submit" className={addBtn} disabled={addText.trim() === ''}>
              Give access
            </button>
          </span>
        </label>
        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-[14px] text-paper">
          <input
            type="checkbox"
            className="h-5 w-5 shrink-0"
            checked={sendEmail}
            onChange={(e) => setSendEmail(e.target.checked)}
          />
          Send them an email
        </label>
      </form>

      {note && <p className="mt-3 text-[13px] text-paper">{note}</p>}
      {actionError && <p className={`mt-3 text-[13px] ${ERROR_TEXT}`}>{actionError}</p>}
    </Section>
  );
}
