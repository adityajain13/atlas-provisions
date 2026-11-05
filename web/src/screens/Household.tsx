import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  ALLERGEN_PRESETS,
  type AccessEntry,
  type AccessView,
  type MeView,
  DAYS,
  DAY_LONG,
  HouseholdSchema,
  SLOTS,
  STORE_PRESETS,
  UNITS,
  VARIETY_RULES,
  newId,
  normalizePostalCode,
  usageLine,
  type Day,
  type FixedMeal,
  type Household,
  type ItemRule,
  type MembersView,
  type Person,
  type Slot,
  type Store,
  type StorePreset,
  type Unit,
  type UsageView,
} from '@provisions/shared';
import {
  cancelInvite,
  errorMessage,
  getAccess,
  getHousehold,
  getMe,
  getMembers,
  getUsage,
  giveAccess,
  inviteMember,
  leaveHousehold,
  removeMember,
  renameHousehold,
  revokeAccess,
  saveHousehold,
} from '../api';
import { accessOutcome, accessSourceLabel, inviteOutcome, leaveCopy, removeAccessCopy, roleLabel } from '../lib/members';
import {
  EMPTY_EXPANSION_TEXT,
  NO_MATCH_TEXT,
  alwaysMatchName,
  exceptAfter,
  neverChipLabel,
  neverExpansion,
} from '../lib/itemRules';
import { FlyerRefresh } from '../components/FlyerRefresh';
import { SaveStatus, useSaveScope, useSaveStatus } from '../components/SaveStatus';
import { Header } from '../components/Header';
import { Page } from '../components/Page';
import { useConfirm, useConfirmChoice } from '../components/ConfirmDialog';
import { Disclosure } from '../components/Disclosure';
import { Section } from '../components/Section';
import {
  addBtn,
  chipBase,
  chipTone,
  eyebrow,
  fieldCls,
  linkBtn,
  removeIconBtn,
  secondaryBtn,
} from '../components/ui';
import { DAY_SHORT, SLOT_LABEL, formatDays } from '../lib/labels';
import { TimeCapGrid } from '../components/TimeCapGrid';
import {
  MAX_FLIPP_NAMES,
  addCustomStore,
  addFlippName,
  clampMaxStores,
  enabledCount,
  groupPresets,
  maxStoresLimit,
  groupOf,
  orderStores,
  presetsNotInList,
  removeFlippName,
  storeFromPreset,
} from '../lib/stores';
import { useSession } from '../session';

type Update = (fn: (prev: Household) => Household) => void;

const ERROR_TEXT = 'text-[#D98C7A]';

// ---------- screen: loads, holds state, autosaves ----------

export default function HouseholdScreen() {
  const [h, setH] = useState<Household | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { track, setPending, setFailure, setFlush } = useSaveStatus();
  useSaveScope('sync', h !== null);
  // Only user edits trigger a save. Loading the document does not.
  const edited = useRef(false);
  const latest = useRef<Household | null>(null);
  const pending = useRef<Household | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    getHousehold()
      .then((d) => {
        if (alive) setH(d);
      })
      .catch((e: unknown) => {
        if (alive) setLoadError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  // Sends the pending edit now. Also used by the leave guard and on unmount, so an edit is not lost.
  const saveNow = useCallback(() => {
    window.clearTimeout(timer.current);
    const data = pending.current;
    if (!data) return;
    pending.current = null;
    const retry = () => saveHousehold(HouseholdSchema.parse(latest.current));
    void track(saveHousehold(data), retry).catch(() => {});
  }, [track]);

  useEffect(() => {
    setFlush(saveNow);
    return () => {
      setFlush(null);
      saveNow();
    };
  }, [saveNow, setFlush]);

  // Every edit shows Saving at once, then sends after a short pause.
  useEffect(() => {
    if (!h || !edited.current) return;
    latest.current = h;
    const parsed = HouseholdSchema.safeParse(h);
    if (!parsed.success) {
      window.clearTimeout(timer.current);
      pending.current = null;
      const first = parsed.error.issues[0];
      setFailure(first ? first.message : 'Check the fields');
      return;
    }
    pending.current = parsed.data;
    setPending();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(saveNow, 600);
  }, [h, saveNow, setPending, setFailure]);

  const update = useCallback<Update>((fn) => {
    edited.current = true;
    setH((prev) => (prev ? fn(prev) : prev));
  }, []);

  return (
    <Page>
      <Header title="Household" status={<SaveStatus />} />

      {loadError && <p className={`mt-6 text-[14px] ${ERROR_TEXT}`}>Could not load: {loadError}</p>}
      {!h && !loadError && <p className="mt-10 text-[14px] text-muted">Loading&hellip;</p>}

      {h && (
        <div className="lg:mt-10 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-12">
          <div className="lg:flex lg:flex-col lg:gap-12">
            <MembersSection />
            <AccessSection />
            <PeopleSection h={h} update={update} />
            <ScheduleSection h={h} update={update} />
            <PrepSection h={h} update={update} />
            <FixedMealsSection h={h} update={update} />
            <ItemRulesSection h={h} update={update} />
          </div>
          <div className="lg:flex lg:flex-col lg:gap-12">
            <AllergiesSection h={h} />
            <EquipmentSection h={h} update={update} />
            <VarietySection h={h} update={update} />
            <StoresSection h={h} update={update} />
          </div>
        </div>
      )}

      <SessionRow />
    </Page>
  );
}

/** Who is signed in on this device, with sign out. */
function SessionRow() {
  const { state, signOut } = useSession();
  if (state.status !== 'in') return null;
  return (
    <p className="mt-10 border-t border-line pt-4 text-[13px] text-muted lg:hidden">
      Signed in as {state.email} ·{' '}
      <button type="button" onClick={() => void signOut()} className="text-herb">
        Sign out
      </button>
    </p>
  );
}

// ---------- members ----------

/**
 * Who is in this household, and the invites out. The owner renames it, invites, cancels invites and removes
 * members. A member sees the same list read only, and can leave. Usage this month is shown at the bottom.
 */
function MembersSection() {
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

// ---------- app access ----------

const ACCESS_CAPTION = "Who can sign in and get their own household. Members you invite to a household don't need to be here.";

/**
 * Who may sign in. Only admins see it. Lists every approved address, where its access comes from, and the household
 * each is in. Giving access can send the sign-in email; removing it signs the address out at once.
 */
function AccessSection() {
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

// ---------- helpers ----------

function countMeals(h: Household, personId: string): number {
  let n = 0;
  for (const d of DAYS) for (const s of SLOTS) if (h.schedule[personId]?.[d]?.[s] === true) n++;
  return n;
}

function isEating(h: Household, personId: string, day: Day, slot: Slot): boolean {
  return h.schedule[personId]?.[day]?.[slot] === true;
}

function setEating(h: Household, personId: string, day: Day, slot: Slot, value: boolean): Household {
  const person = h.schedule[personId] ?? {};
  const dayMap = person[day] ?? {};
  return {
    ...h,
    schedule: { ...h.schedule, [personId]: { ...person, [day]: { ...dayMap, [slot]: value } } },
  };
}

function allOn(): Record<string, Record<string, boolean>> {
  return Object.fromEntries(DAYS.map((d) => [d, Object.fromEntries(SLOTS.map((s) => [s, true]))]));
}

function fixedMealSummary(m: FixedMeal, people: Person[]): string {
  const names = people.filter((p) => m.personIds.includes(p.id)).map((p) => p.name);
  return [SLOT_LABEL[m.slot], formatDays(m.days), names.length ? names.join(', ') : 'No one'].join(
    ' · ',
  );
}

function readableCount(n: number): string {
  return `${n} ${n === 1 ? 'meal' : 'meals'} a week`;
}

// ---------- People ----------

function PeopleSection({ h, update }: { h: Household; update: Update }) {
  const confirm = useConfirm();
  const [openId, setOpenId] = useState<string | null>(null);
  // The row added last, so its name field takes focus when it opens. Cleared on any toggle.
  const [freshId, setFreshId] = useState<string | null>(null);

  function toggle(id: string) {
    setFreshId(null);
    setOpenId((cur) => (cur === id ? null : id));
  }

  function addPerson() {
    const id = newId();
    update((prev) => ({
      ...prev,
      people: [...prev.people, { id, name: 'New person', dietTags: [], allergies: [] }],
      schedule: { ...prev.schedule, [id]: allOn() },
    }));
    setOpenId(id);
    setFreshId(id);
  }

  async function removePerson(p: Person) {
    if (
      !(await confirm({
        title: `Remove ${p.name}?`,
        message: 'Their schedule, allergies and fixed-meal assignments are removed too.',
        confirmLabel: 'Remove',
        danger: true,
      }))
    )
      return;
    setOpenId(null);
    setFreshId(null);
    update((prev) => {
      const schedule = { ...prev.schedule };
      delete schedule[p.id];
      return {
        ...prev,
        people: prev.people.filter((x) => x.id !== p.id),
        schedule,
        fixedMeals: prev.fixedMeals.map((m) => ({
          ...m,
          personIds: m.personIds.filter((id) => id !== p.id),
        })),
      };
    });
  }

  return (
    <Section title="People">
      {h.people.length === 0 && <p className="text-[14px] text-muted">No one yet.</p>}
      <ul>
        {h.people.map((p) => (
          <li key={p.id}>
            <Disclosure
              open={openId === p.id}
              onToggle={() => toggle(p.id)}
              title={p.name}
              summary={readableCount(countMeals(h, p.id))}
              focusFirstField={freshId === p.id}
              remove={{ label: 'Remove person', onClick: () => void removePerson(p) }}
            >
              <PersonFields person={p} update={update} />
            </Disclosure>
          </li>
        ))}
      </ul>
      <button type="button" onClick={addPerson} className={`mt-3 ${linkBtn}`}>
        + Add person
      </button>
    </Section>
  );
}

function PersonFields({ person, update }: { person: Person; update: Update }) {
  const [custom, setCustom] = useState('');

  function patch(p: Partial<Person>) {
    update((prev) => ({
      ...prev,
      people: prev.people.map((x) => (x.id === person.id ? { ...x, ...p } : x)),
    }));
  }

  function toggleAllergy(a: string) {
    patch({
      allergies: person.allergies.includes(a)
        ? person.allergies.filter((x) => x !== a)
        : [...person.allergies, a],
    });
  }

  function addCustom() {
    const v = custom.trim().toLowerCase();
    setCustom('');
    if (!v || person.allergies.includes(v)) return;
    patch({ allergies: [...person.allergies, v] });
  }

  const customs = person.allergies.filter((a) => !ALLERGEN_PRESETS.includes(a));

  return (
    <>
      <label className="block">
        <span className={eyebrow}>Name</span>
        <input
          className={`${fieldCls} mt-2`}
          value={person.name}
          maxLength={40}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </label>

      <label className="block">
        <span className={eyebrow}>Protein target (g/day, optional)</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          className={`${fieldCls} mt-2`}
          value={person.proteinTargetG ?? ''}
          onChange={(e) =>
            patch({ proteinTargetG: e.target.value === '' ? undefined : Number(e.target.value) })
          }
        />
      </label>

      <div>
        <span className={eyebrow}>Allergies</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {ALLERGEN_PRESETS.map((a) => {
            const on = person.allergies.includes(a);
            return (
              <button
                key={a}
                type="button"
                aria-pressed={on}
                onClick={() => toggleAllergy(a)}
                className={`${chipBase} px-4 ${chipTone(on)}`}
              >
                {a}
              </button>
            );
          })}
          {customs.map((a) => (
            <span key={a} className={`${chipBase} gap-1 border-herb pl-4 pr-1 text-herbLight`}>
              {a}
              <button
                type="button"
                aria-label={`Remove ${a}`}
                onClick={() => toggleAllergy(a)}
                className={removeIconBtn}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            className={fieldCls}
            placeholder="Other allergen"
            value={custom}
            maxLength={40}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustom();
              }
            }}
          />
          <button type="button" onClick={addCustom} className={addBtn}>
            Add
          </button>
        </div>
      </div>

    </>
  );
}

// ---------- Schedule ----------

function ScheduleSection({ h, update }: { h: Household; update: Update }) {
  return (
    <Section title="Schedule" caption="Default for every week.">
      {h.people.length === 0 && <p className="text-[14px] text-muted">Add people first.</p>}
      {h.people.map((p) => (
        <div key={p.id} className="mb-6">
          <p className="mb-2 text-[14px] text-paper">{p.name}</p>
          <div className="grid grid-cols-[76px_repeat(7,minmax(0,1fr))] gap-1.5">
            <span />
            {DAYS.map((d) => (
              <span key={d} className="text-center text-[11px] text-muted" aria-hidden="true">
                {DAY_SHORT[d]}
              </span>
            ))}
            {SLOTS.map((slot) => (
              <Fragment key={slot}>
                <span className="flex items-center text-[12px] text-muted" aria-hidden="true">
                  {SLOT_LABEL[slot]}
                </span>
                {DAYS.map((day) => {
                  const on = isEating(h, p.id, day, slot);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      aria-label={`${p.name}, ${DAY_LONG[day]} ${SLOT_LABEL[slot].toLowerCase()}`}
                      onClick={() =>
                        update((prev) => setEating(prev, p.id, day, slot, !isEating(prev, p.id, day, slot)))
                      }
                      className={`flex h-10 items-center justify-center rounded-md border ${
                        on ? 'border-chip bg-chip' : 'border-edge'
                      }`}
                    >
                      {on && <span className="h-1.5 w-1.5 rounded-full bg-herb" />}
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      ))}
      <TimeCaps h={h} update={update} />
    </Section>
  );
}

// ---------- Batch prep ----------

function PrepSection({ h, update }: { h: Household; update: Update }) {
  return (
    <Section title="Batch prep" caption="Each new plan gets a prep list for this day.">
      <label className="flex items-center justify-between gap-4">
        <span className="text-[15px] text-paper">Prep day</span>
        <select
          className={`${fieldCls} w-40`}
          value={h.prepDay ?? 'none'}
          onChange={(e) =>
            update((prev) => ({ ...prev, prepDay: e.target.value === 'none' ? null : (e.target.value as Day) }))
          }
        >
          <option value="none">None</option>
          {DAYS.map((d) => (
            <option key={d} value={d}>
              {DAY_LONG[d]}
            </option>
          ))}
        </select>
      </label>
    </Section>
  );
}

function TimeCaps({ h, update }: { h: Household; update: Update }) {
  return (
    <div className="mt-8 border-t border-line2 pt-4">
      <p className="text-[14px] text-paper">Time caps</p>
      <p className="mt-1 text-[13px] text-muted">
        Busy nights: meals in capped slots stay under that many minutes. Tap a meal, a row or a day to set it.
      </p>
      <TimeCapGrid h={h} update={update} />
    </div>
  );
}

// ---------- Fixed meals ----------

function FixedMealsSection({ h, update }: { h: Household; update: Update }) {
  const confirm = useConfirm();
  const [openId, setOpenId] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);

  function toggle(id: string) {
    setFreshId(null);
    setOpenId((cur) => (cur === id ? null : id));
  }

  function addMeal() {
    const id = newId();
    update((prev) => ({
      ...prev,
      fixedMeals: [
        ...prev.fixedMeals,
        { id, name: 'New meal', personIds: [], days: [], slot: 'breakfast', ingredients: [], active: true },
      ],
    }));
    setOpenId(id);
    setFreshId(id);
  }

  async function removeMeal(m: FixedMeal) {
    if (
      !(await confirm({
        title: `Delete ${m.name}?`,
        message: 'It stops appearing in future plans. Meals already planned for a week are not changed.',
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    setOpenId(null);
    setFreshId(null);
    update((prev) => ({ ...prev, fixedMeals: prev.fixedMeals.filter((x) => x.id !== m.id) }));
  }

  return (
    <Section title="Fixed meals">
      {h.fixedMeals.length === 0 && <p className="text-[14px] text-muted">None yet.</p>}
      <ul>
        {h.fixedMeals.map((m) => (
          <li key={m.id}>
            <Disclosure
              open={openId === m.id}
              onToggle={() => toggle(m.id)}
              title={m.name}
              detail={`${m.active ? '' : 'Paused · '}${fixedMealSummary(m, h.people)}`}
              focusFirstField={freshId === m.id}
              remove={{ label: 'Delete fixed meal', onClick: () => void removeMeal(m) }}
            >
              <FixedMealFields meal={m} people={h.people} update={update} />
            </Disclosure>
          </li>
        ))}
      </ul>
      <button type="button" onClick={addMeal} className={`mt-3 ${linkBtn}`}>
        + Add fixed meal
      </button>
    </Section>
  );
}

function FixedMealFields({ meal, people, update }: { meal: FixedMeal; people: Person[]; update: Update }) {
  function patchMeal(p: Partial<FixedMeal>) {
    update((prev) => ({
      ...prev,
      fixedMeals: prev.fixedMeals.map((x) => (x.id === meal.id ? { ...x, ...p } : x)),
    }));
  }

  function toggleDay(d: Day) {
    patchMeal({ days: meal.days.includes(d) ? meal.days.filter((x) => x !== d) : [...meal.days, d] });
  }

  function togglePerson(id: string) {
    patchMeal({
      personIds: meal.personIds.includes(id)
        ? meal.personIds.filter((x) => x !== id)
        : [...meal.personIds, id],
    });
  }

  function patchIngredient(i: number, p: Partial<FixedMeal['ingredients'][number]>) {
    update((prev) => ({
      ...prev,
      fixedMeals: prev.fixedMeals.map((x) =>
        x.id === meal.id
          ? { ...x, ingredients: x.ingredients.map((ing, j) => (j === i ? { ...ing, ...p } : ing)) }
          : x,
      ),
    }));
  }

  function removeIngredient(i: number) {
    patchMeal({ ingredients: meal.ingredients.filter((_, j) => j !== i) });
  }

  return (
    <>
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
        <span>
          <span className="block text-[15px] text-paper">Active</span>
          <span className="block text-[12px] text-muted">Turn off to leave it out of plans.</span>
        </span>
        <input
          type="checkbox"
          className="h-5 w-5 shrink-0"
          checked={meal.active}
          onChange={(e) => patchMeal({ active: e.target.checked })}
        />
      </label>

      <label className="block">
        <span className={eyebrow}>Name</span>
        <input
          className={`${fieldCls} mt-2`}
          value={meal.name}
          maxLength={80}
          onChange={(e) => patchMeal({ name: e.target.value })}
        />
      </label>

      <label className="block">
        <span className={eyebrow}>Slot</span>
        <select
          className={`${fieldCls} mt-2`}
          value={meal.slot}
          onChange={(e) => patchMeal({ slot: e.target.value as Slot })}
        >
          {SLOTS.map((s) => (
            <option key={s} value={s}>
              {SLOT_LABEL[s]}
            </option>
          ))}
        </select>
      </label>

      <div>
        <span className={eyebrow}>Days</span>
        <div className="mt-2 flex gap-1.5">
          {DAYS.map((d) => {
            const on = meal.days.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDay(d)}
                className={`h-11 min-w-0 flex-1 rounded-md border text-[12px] ${
                  on ? 'border-herb bg-herb font-medium text-ink' : 'border-edge text-muted'
                }`}
              >
                {DAY_SHORT[d]}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <span className={eyebrow}>Who</span>
        {people.length === 0 ? (
          <p className="mt-2 text-[14px] text-muted">Add people first.</p>
        ) : (
          <ul className="mt-2">
            {people.map((p) => (
              <li key={p.id}>
                <label className="flex min-h-[44px] cursor-pointer items-center justify-between">
                  <span className="text-[15px] text-paper">{p.name}</span>
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={meal.personIds.includes(p.id)}
                    onChange={() => togglePerson(p.id)}
                  />
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <span className={eyebrow}>Ingredients</span>
        <ul className="mt-2 space-y-4">
          {meal.ingredients.map((ing, i) => (
            <li key={i} className="space-y-2">
              <div className="flex gap-2">
                <input
                  className={fieldCls}
                  placeholder="Ingredient"
                  aria-label="Ingredient name"
                  value={ing.name}
                  maxLength={60}
                  onChange={(e) => patchIngredient(i, { name: e.target.value })}
                />
                <button
                  type="button"
                  aria-label={`Remove ${ing.name || 'ingredient'}`}
                  onClick={() => removeIngredient(i)}
                  className={removeIconBtn}
                >
                  &times;
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  aria-label="Quantity"
                  className={`${fieldCls} w-28`}
                  value={ing.qty}
                  onChange={(e) => patchIngredient(i, { qty: Number(e.target.value) })}
                />
                <select
                  aria-label="Unit"
                  className={`${fieldCls} w-28`}
                  value={ing.unit}
                  onChange={(e) => patchIngredient(i, { unit: e.target.value as Unit })}
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => patchMeal({ ingredients: [...meal.ingredients, { name: '', qty: 0, unit: 'g' }] })}
          className={`mt-3 ${linkBtn}`}
        >
          + Add ingredient
        </button>
      </div>

    </>
  );
}

// ---------- Allergies (read-only summary) ----------

function AllergiesSection({ h }: { h: Household }) {
  return (
    <Section title="Allergies" caption="Hard block. A plan with these is never shown.">
      {h.people.length === 0 && <p className="text-[14px] text-muted">Add people first.</p>}
      <ul>
        {h.people.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 border-b border-line2 py-3">
            <span className="mr-2 min-w-[72px] text-[15px] text-paper">{p.name}</span>
            {p.allergies.length === 0 ? (
              <span className="text-[13px] text-muted">None</span>
            ) : (
              p.allergies.map((a) => (
                <span key={a} className="rounded-full border border-herb px-3 py-1 text-[13px] text-herbLight">
                  {a}
                </span>
              ))
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------- Equipment ----------

function EquipmentSection({ h, update }: { h: Household; update: Update }) {
  const [text, setText] = useState('');

  function add() {
    const name = text.trim();
    setText('');
    if (!name) return;
    update((prev) => {
      if (prev.equipment.some((e) => e.name.toLowerCase() === name.toLowerCase())) return prev;
      return {
        ...prev,
        equipment: [...prev.equipment, { id: newId(), name, owned: true, builtin: false }],
      };
    });
  }

  return (
    <Section title="Equipment">
      <ul className="grid grid-cols-2 gap-x-4 lg:grid-cols-3">
        {h.equipment.map((e) => (
          <li key={e.id} className="flex min-h-[48px] items-center justify-between gap-1 border-b border-line2">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0"
                checked={e.owned}
                onChange={(ev) =>
                  update((prev) => ({
                    ...prev,
                    equipment: prev.equipment.map((x) => (x.id === e.id ? { ...x, owned: ev.target.checked } : x)),
                  }))
                }
              />
              <span className="truncate text-[14px] text-paper">{e.name}</span>
            </label>
            <button
              type="button"
              aria-label={`Remove ${e.name}`}
              onClick={() =>
                update((prev) => ({ ...prev, equipment: prev.equipment.filter((x) => x.id !== e.id) }))
              }
              className={removeIconBtn}
            >
              &times;
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2">
        <input
          className={fieldCls}
          placeholder="Add equipment"
          aria-label="Add equipment"
          value={text}
          maxLength={40}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" onClick={add} className={addBtn}>
          Add
        </button>
      </div>
    </Section>
  );
}

// ---------- Variety rules ----------

function VarietySection({ h, update }: { h: Household; update: Update }) {
  return (
    <Section title="Variety rules" caption="All optional.">
      <ul>
        {VARIETY_RULES.map((r) => (
          <li key={r.key}>
            <label className="flex min-h-[48px] cursor-pointer items-center justify-between gap-4 border-b border-line2">
              <span className="text-[15px] text-paper">{r.label}</span>
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0"
                checked={h.varietyRules[r.key] === true}
                onChange={(e) =>
                  update((prev) => ({
                    ...prev,
                    varietyRules: { ...prev.varietyRules, [r.key]: e.target.checked },
                  }))
                }
              />
            </label>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------- Stores ----------

type StoresUpdate = (fn: (stores: Store[]) => Store[]) => void;

function StoresSection({ h, update }: { h: Household; update: Update }) {
  // Every change to the list goes through here, so the per-trip count stays within the enabled stores.
  const changeStores = useCallback<StoresUpdate>(
    (fn) =>
      update((prev) => {
        const stores = fn(prev.stores);
        return { ...prev, stores, maxStores: clampMaxStores(prev.maxStores, stores) };
      }),
    [update],
  );
  // One store row open at a time, and the add-store picker.
  const [openId, setOpenId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const limit = maxStoresLimit(h.stores);
  const perTrip = clampMaxStores(h.maxStores, h.stores);
  const rows = orderStores(h.stores);

  function setMax(n: number) {
    update((prev) => ({ ...prev, maxStores: clampMaxStores(n, prev.stores) }));
  }

  return (
    <Section title="Stores">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
        <div className="lg:w-64 lg:shrink-0">
          <PostalCodeField h={h} update={update} />
        </div>
        <div className="min-w-0 flex-1 border-t border-line2 pt-4 lg:border-t-0 lg:pt-0">
          <FlyerRefresh />
        </div>
      </div>

      <div className="mt-8">
        <p className={eyebrow}>Your stores</p>
        {rows.length === 0 ? (
          <p className="mt-2 text-[14px] text-muted">No stores yet. Add one below.</p>
        ) : (
          <>
            <ul className="mt-2">
              {rows.map((s) => (
                <li key={s.id}>
                  <StoreRow
                    store={s}
                    open={openId === s.id}
                    onToggle={() => setOpenId((cur) => (cur === s.id ? null : s.id))}
                    change={changeStores}
                  />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[13px] text-muted">
              {`${enabledCount(h.stores)} of ${h.stores.length} stores enabled.`}
            </p>
          </>
        )}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          aria-haspopup="dialog"
          className={`mt-3 ${linkBtn}`}
        >
          + Add store
        </button>
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <span className="text-[15px] text-paper">Max stores per trip</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Fewer stores"
              disabled={perTrip <= 1}
              onClick={() => setMax(perTrip - 1)}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-edge text-[18px] text-paper disabled:opacity-40"
            >
              &minus;
            </button>
            <span className="w-6 text-center text-[18px] font-semibold tabular-nums text-paper">{perTrip}</span>
            <button
              type="button"
              aria-label="More stores"
              disabled={perTrip >= limit}
              onClick={() => setMax(perTrip + 1)}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-edge text-[18px] text-paper disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>
        <p className="mt-2 text-[13px] text-muted">
          {`We'll pick the cheapest combination of up to ${perTrip} of your enabled stores.`}
        </p>
      </div>

      <StorePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        stores={h.stores}
        change={changeStores}
      />
    </Section>
  );
}

/** One store: a shop-here switch, the name and chain, a price-match pill, and an expandable editor. */
function StoreRow({
  store: s,
  open,
  onToggle,
  change,
}: {
  store: Store;
  open: boolean;
  onToggle: () => void;
  change: StoresUpdate;
}) {
  const confirm = useConfirm();
  const shopping = s.enabled;
  const group = groupOf(s);

  function patch(p: Partial<Store>) {
    change((list) => list.map((x) => (x.id === s.id ? { ...x, ...p } : x)));
  }

  async function remove() {
    if (
      !(await confirm({
        title: `Remove ${s.name}?`,
        message: "Its flyer prices won't be used. Past price history is kept.",
        confirmLabel: 'Remove',
        danger: true,
      }))
    )
      return;
    if (open) onToggle();
    change((list) => list.filter((x) => x.id !== s.id));
  }

  return (
    <Disclosure
      open={open}
      onToggle={onToggle}
      lead={
        <button
          type="button"
          role="switch"
          aria-checked={shopping}
          aria-label={`Shop at ${s.name}`}
          onClick={() => patch({ enabled: !shopping })}
          className="flex h-12 w-11 shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herb"
        >
          <span
            aria-hidden="true"
            className={`relative inline-block h-5 w-9 rounded-full transition-colors motion-reduce:transition-none ${
              shopping ? 'bg-herb' : 'bg-edge'
            }`}
          >
            <span
              className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-paper transition-transform motion-reduce:transition-none ${
                shopping ? 'translate-x-[18px]' : 'translate-x-0.5'
              }`}
            />
          </span>
        </button>
      }
      title={
        <>
          <span className={shopping ? 'text-paper' : 'text-muted'}>{s.name}</span>
          {group && <span className="ml-2 text-[12px] text-muted">{group}</span>}
        </>
      }
      summary={
        s.priceMatches ? (
          <span className="inline-block rounded-full border border-herb/40 px-2 py-0.5 text-[11px] text-herbLight">
            Price-matches
          </span>
        ) : undefined
      }
      remove={{ label: 'Remove store', onClick: () => void remove() }}
    >
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
        <span className="min-w-0">
          <span className="block text-[15px] text-paper">Price-matches</span>
          <span className="block text-[12px] text-muted">Show price-match hints for this store.</span>
        </span>
        <input
          type="checkbox"
          className="h-5 w-5 shrink-0"
          checked={s.priceMatches}
          onChange={(e) => patch({ priceMatches: e.target.checked })}
        />
      </label>

      <FlippNames store={s} change={change} />
    </Disclosure>
  );
}

/** The other names a store uses on Flipp: chips to remove, and an input to add one. */
function FlippNames({ store: s, change }: { store: Store; change: StoresUpdate }) {
  const [text, setText] = useState('');
  const names = s.flippNames ?? [];
  const full = names.length >= MAX_FLIPP_NAMES;

  function edit(fn: (x: Store) => Store) {
    change((list) => list.map((x) => (x.id === s.id ? fn(x) : x)));
  }

  function add() {
    const name = text.trim();
    setText('');
    if (name) edit((x) => addFlippName(x, name));
  }

  return (
    <div>
      <span className={eyebrow}>Names on Flipp</span>
      <p className="mt-1 text-[12px] text-muted">Other names this store uses in flyers.</p>
      {names.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {names.map((n) => (
            <li key={n} className={`${chipBase} gap-1 border-edge pl-4 pr-1 text-paper`}>
              {n}
              <button
                type="button"
                aria-label={`Remove ${n}`}
                onClick={() => edit((x) => removeFlippName(x, n))}
                className={removeIconBtn}
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        <input
          className={fieldCls}
          placeholder={full ? `Up to ${MAX_FLIPP_NAMES} names` : 'Add a name'}
          aria-label={`Add a Flipp name for ${s.name}`}
          value={text}
          maxLength={40}
          disabled={full}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" onClick={add} disabled={full} className={`${addBtn} disabled:opacity-40`}>
          Add
        </button>
      </div>
    </div>
  );
}

/** Native dialog: a bottom sheet on a phone, a centred card on desktop. Presets to add, search, and a custom store. */
function StorePicker({
  open,
  onClose,
  stores,
  change,
}: {
  open: boolean;
  onClose: () => void;
  stores: Store[];
  change: StoresUpdate;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [added, setAdded] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
    } else if (!open && d.open) {
      d.close();
      setQuery('');
      setAdded(null);
    }
  }, [open]);

  // The "Added" line is brief.
  useEffect(() => {
    if (!added) return;
    const t = window.setTimeout(() => setAdded(null), 2500);
    return () => window.clearTimeout(t);
  }, [added]);

  const notListed = presetsNotInList(stores, STORE_PRESETS);
  const q = query.trim().toLowerCase();
  const groups = groupPresets(q ? notListed.filter((p) => p.name.toLowerCase().includes(q)) : notListed);

  function addPreset(p: StorePreset) {
    change((list) => (list.some((x) => x.id === p.id) ? list : [...list, storeFromPreset(p)]));
    setAdded(p.name);
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="store-picker-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-0 inset-x-0 bottom-0 top-auto h-fit w-full max-w-none bg-transparent p-0 backdrop:bg-black/60 lg:m-auto lg:inset-0 lg:h-fit lg:w-[calc(100%-32px)] lg:max-w-[480px] [&_input:not([type=checkbox])]:bg-ink"
    >
      <div className="flex max-h-[85vh] flex-col rounded-t-2xl border border-b-0 border-edge bg-field lg:max-h-[80vh] lg:rounded-xl lg:border-b">
        <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-edge lg:hidden" />
        <div className="flex shrink-0 items-center justify-between gap-4 px-5 pt-3 lg:pt-5">
          <h2
            id="store-picker-title"
            className="font-display text-[20px] font-semibold tracking-[-0.01em] text-paper"
          >
            Add a store
          </h2>
          <button type="button" onClick={onClose} className={linkBtn}>
            Close
          </button>
        </div>
        <div className="shrink-0 px-5 pt-4">
          <input
            type="text"
            className={fieldCls}
            placeholder="Search stores"
            aria-label="Search stores"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6">
          <p role="status" aria-live="polite" className="h-5 pt-2 text-[13px] text-herbLight">
            {added ? `Added ${added}` : ''}
          </p>
          {groups.length === 0 && (
            <p className="text-[14px] text-muted">
              {notListed.length === 0
                ? 'Every store we know about is already in your list.'
                : `No stores match "${query.trim()}".`}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.group} className="mt-5 first:mt-0">
              <p className={eyebrow}>{g.group}</p>
              <ul className="mt-2">
                {g.presets.map((p) => (
                  <li key={p.id} className="flex min-h-12 items-center justify-between gap-3 border-b border-line2">
                    <span className="min-w-0 truncate text-[15px] text-paper">{p.name}</span>
                    <button
                      type="button"
                      aria-label={`Add ${p.name}`}
                      onClick={() => addPreset(p)}
                      className="h-11 shrink-0 rounded-lg border border-herb px-4 text-[14px] text-herbLight"
                    >
                      Add
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="mt-6 border-t border-line2 pt-4">
            <p className={eyebrow}>Not listed?</p>
            <AddCustomStore stores={stores} change={change} onAdded={setAdded} />
          </div>
        </div>
      </div>
    </dialog>
  );
}

function AddCustomStore({
  stores,
  change,
  onAdded,
}: {
  stores: Store[];
  change: StoresUpdate;
  onAdded: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [flipp, setFlipp] = useState('');
  const [error, setError] = useState<string | null>(null);

  function add(e: FormEvent) {
    e.preventDefault();
    const result = addCustomStore(stores, name, flipp);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const store = result.store;
    change((list) => {
      const again = addCustomStore(list, name, flipp);
      return again.ok && again.store.id === store.id ? [...list, again.store] : list;
    });
    onAdded(store.name);
    setName('');
    setFlipp('');
    setError(null);
  }

  return (
    <form onSubmit={add} noValidate className="mt-3">
      <div className="flex flex-col gap-2">
        <input
          className={fieldCls}
          placeholder="Store name"
          aria-label="Store name"
          value={name}
          maxLength={40}
          aria-invalid={error !== null}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
        <input
          className={fieldCls}
          placeholder="Name on Flipp (optional)"
          aria-label="Name on Flipp (optional)"
          value={flipp}
          maxLength={200}
          onChange={(e) => setFlipp(e.target.value)}
        />
        <div>
          <button type="submit" className={addBtn}>
            Add
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className={`mt-2 text-[13px] ${ERROR_TEXT}`}>
          {error}
        </p>
      )}
    </form>
  );
}

/** Postal code for finding flyers. Only a complete code is saved; the stored form is uppercase, no space. */
function PostalCodeField({ h, update }: { h: Household; update: Update }) {
  const [text, setText] = useState(h.postalCode ?? '');
  const invalid = text.trim() !== '' && normalizePostalCode(text) === null;

  function onChange(value: string) {
    setText(value);
    const code = normalizePostalCode(value);
    if (code) {
      update((prev) => (prev.postalCode === code ? prev : { ...prev, postalCode: code }));
    } else if (value.trim() === '') {
      update((prev) => {
        const next = { ...prev };
        delete next.postalCode;
        return next;
      });
    }
  }

  return (
    <label className="block">
      <span className={eyebrow}>Postal code</span>
      <input
        className={`${fieldCls} mt-2`}
        value={text}
        maxLength={7}
        autoComplete="postal-code"
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="mt-2 block text-[12px] text-muted">Used to find flyers near you.</span>
      {invalid && <span className={`mt-1 block text-[12px] ${ERROR_TEXT}`}>Enter a Canadian postal code, like M5V 2T6.</span>}
    </label>
  );
}

// ---------- Always / never buy ----------

function ItemRulesSection({ h, update }: { h: Household; update: Update }) {
  return (
    <Section title="Always / never buy">
      <RuleList title="Always buy" rule="always" h={h} update={update} />
      <div className="mt-6">
        <RuleList title="Never buy" rule="never" h={h} update={update} />
      </div>
    </Section>
  );
}

/** The rule with its except list replaced. An empty list is left off, so the stored rule stays as it was. */
function withExcept(rule: ItemRule, except: string[] | undefined): ItemRule {
  const next: ItemRule = { id: rule.id, name: rule.name, rule: rule.rule };
  if (except) next.except = except;
  return next;
}

function RuleList({
  title,
  rule,
  h,
  update,
}: {
  title: string;
  rule: ItemRule['rule'];
  h: Household;
  update: Update;
}) {
  const [text, setText] = useState('');
  // Never-buy names open one at a time, to show the ingredients they cover.
  const [openId, setOpenId] = useState<string | null>(null);
  const items = h.itemRules.filter((r) => r.rule === rule);

  function removeRule(id: string) {
    update((prev) => ({ ...prev, itemRules: prev.itemRules.filter((r) => r.id !== id) }));
  }

  function add() {
    const name = text.trim();
    setText('');
    if (!name) return;
    update((prev) => {
      if (prev.itemRules.some((r) => r.name.toLowerCase() === name.toLowerCase())) return prev;
      return { ...prev, itemRules: [...prev.itemRules, { id: newId(), name, rule }] };
    });
  }

  return (
    <div>
      <p className={eyebrow}>{title}</p>
      {rule === 'never' ? (
        <ul className="mt-2 space-y-2">
          {items.map((item) => {
            const expansion = neverExpansion(item);
            const blocked = expansion.filter((e) => e.blocked).length;
            const isOpen = openId === item.id;
            return (
              <li key={item.id}>
                <Disclosure
                  variant="compact"
                  open={isOpen}
                  onToggle={() => setOpenId(isOpen ? null : item.id)}
                  title={<span className={`${chipBase} border-edge px-4 text-paper`}>{neverChipLabel(item.name, blocked)}</span>}
                >
                  {expansion.length === 0 ? (
                    <p className="text-[13px] text-muted">{EMPTY_EXPANSION_TEXT}</p>
                  ) : (
                    <>
                      <p className="mb-1 text-[12px] text-muted">Ticked ingredients are blocked. Untick one to allow it.</p>
                      <ul>
                        {expansion.map((e) => (
                          <li key={e.id}>
                            <label className="flex min-h-11 items-center gap-3 text-[15px] text-paper">
                              <input
                                type="checkbox"
                                checked={e.blocked}
                                onChange={(ev) => {
                                  const nowBlocked = ev.target.checked;
                                  update((prev) => ({
                                    ...prev,
                                    itemRules: prev.itemRules.map((r) =>
                                      r.id === item.id ? withExcept(r, exceptAfter(r.except, e.id, nowBlocked)) : r,
                                    ),
                                  }));
                                }}
                                className="h-5 w-5 accent-herb"
                              />
                              {e.name}
                            </label>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setOpenId(null);
                        removeRule(item.id);
                      }}
                      className="min-h-11 text-[14px] text-[#D98C7A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-herb"
                    >
                      Remove {item.name}
                    </button>
                  </div>
                </Disclosure>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-2">
          {items.map((item) => {
            const matched = alwaysMatchName(item.name);
            return (
              <li key={item.id} className={`${chipBase} gap-1 border-edge pl-4 pr-1 text-paper`}>
                {item.name}
                {matched ? (
                  <span className="text-muted">&rarr; {matched}</span>
                ) : (
                  <span className={ERROR_TEXT}>{NO_MATCH_TEXT}</span>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${item.name}`}
                  onClick={() => removeRule(item.id)}
                  className={removeIconBtn}
                >
                  &times;
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        <input
          className={fieldCls}
          placeholder={rule === 'always' ? 'Add an always-buy item' : 'Add a never-buy item'}
          aria-label={title}
          value={text}
          maxLength={60}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" onClick={add} className={addBtn}>
          Add
        </button>
      </div>
    </div>
  );
}
