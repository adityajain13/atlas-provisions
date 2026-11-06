import { useState } from 'react';
import {
  ALLERGEN_PRESETS,
  GUEST_MAX,
  SKIP_REASON_LABEL,
  STATUS_NOTE_MAX,
  normalizeAllergies,
  type GuestsInput,
  type MealStatus,
  type MealStatusInput,
  type SkipReason,
} from '@provisions/shared';
import { guestsLine, markLabel } from '../lib/mealStatus';
import { addBtn, chipBase, chipTone, fieldCls, primaryBtn, secondaryBtn } from './ui';

// The status a meal already has, at the top of its detail, with a way to clear it.
export function StatusBanner({ status, busy, onClear }: { status: MealStatus; busy: boolean; onClear: () => void }) {
  const label = markLabel(status) ?? (status.guests ? null : 'Kept as planned');
  const guests = guestsLine(status);
  return (
    <div className="mt-4 flex items-start justify-between gap-4 rounded-lg border border-edge px-4 py-3">
      <div className="min-w-0 text-[14px]">
        {label && <p className={status.status === 'skipped' ? 'text-muted' : 'text-herbLight'}>{label}</p>}
        {guests && <p className="mt-1 text-[13px] text-muted">{guests}</p>}
        {status.note && <p className="mt-1 text-[13px] text-muted">{status.note}</p>}
      </div>
      <button
        type="button"
        onClick={onClear}
        disabled={busy}
        className="h-11 shrink-0 px-2 text-[14px] text-herbLight outline-none hover:text-paper focus-visible:ring-2 focus-visible:ring-herb disabled:opacity-40"
      >
        Clear
      </button>
    </div>
  );
}

type Panel = 'skipped' | 'made' | 'guests';

const PANELS: { id: Panel; label: string }[] = [
  { id: 'skipped', label: 'Skipped' },
  { id: 'made', label: 'Made something else' },
  { id: 'guests', label: "Someone's joining" },
];

/**
 * "Didn't go to plan?": three ways to say what happened to a planned meal. Skipped (ate out, or did not eat). Made
 * something else, with its name. Someone's joining, with how many and what they cannot eat, and a note. A swap for
 * a meal that works is offered only while the meal is still to come; otherwise the note is all there is.
 */
export default function DidntGoToPlan({
  canSwap,
  busy,
  error,
  onMark,
  onSwapForGuests,
}: {
  canSwap: boolean;
  busy: boolean;
  error: string | null;
  onMark: (patch: MealStatusInput) => void;
  onSwapForGuests: (guests: GuestsInput, note: string) => void;
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [madeName, setMadeName] = useState('');
  const [count, setCount] = useState(1);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState('');

  const toggleAllergy = (name: string) =>
    setAllergies((list) => (list.includes(name) ? list.filter((x) => x !== name) : [...list, name]));
  const addCustom = () => {
    const value = custom.trim().toLowerCase();
    if (value && !allergies.includes(value)) setAllergies([...allergies, value]);
    setCustom('');
  };
  const guests: GuestsInput = { count, allergies: normalizeAllergies(allergies) };
  const customAllergies = allergies.filter((a) => !ALLERGEN_PRESETS.includes(a));
  const trimmedNote = note.trim();
  const trimmedMade = madeName.trim();

  const stepButton = (label: string, onStep: () => void, disabled: boolean) => (
    <button
      type="button"
      aria-label={label}
      disabled={disabled || busy}
      onClick={onStep}
      className="flex h-11 w-11 items-center justify-center rounded-full border border-edge text-[18px] text-paper outline-none hover:border-muted focus-visible:ring-2 focus-visible:ring-herb disabled:opacity-40"
    >
      {label === 'One fewer guest' ? '−' : '+'}
    </button>
  );

  return (
    <section className="mt-8 border-t border-line pt-4">
      <h3 className="font-display text-[20px] font-semibold tracking-[-0.01em] text-paper">Didn&apos;t go to plan?</h3>

      <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="What happened">
        {PANELS.map((p) => {
          const open = panel === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-expanded={open}
              disabled={busy}
              onClick={() => setPanel(open ? null : p.id)}
              className={`min-h-11 rounded-md border px-2 text-[13px] leading-tight outline-none focus-visible:ring-2 focus-visible:ring-herb disabled:opacity-40 ${
                open ? 'border-herb text-herbLight' : 'border-edge text-paper hover:border-muted'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {panel === 'skipped' && (
        <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Why it was skipped">
          {(Object.keys(SKIP_REASON_LABEL) as SkipReason[]).map((reason) => (
            <button
              key={reason}
              type="button"
              disabled={busy}
              onClick={() => onMark({ status: 'skipped', reason })}
              className={`${secondaryBtn} disabled:opacity-40`}
            >
              {SKIP_REASON_LABEL[reason]}
            </button>
          ))}
        </div>
      )}

      {panel === 'made' && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmedMade) onMark({ status: 'replaced', madeName: trimmedMade });
          }}
        >
          <label htmlFor="made-name" className="block text-[13px] text-muted">
            What did you make?
          </label>
          <div className="flex gap-2">
            <input
              id="made-name"
              className={fieldCls}
              value={madeName}
              maxLength={80}
              placeholder="e.g. Lentil soup"
              onChange={(e) => setMadeName(e.target.value)}
            />
            <button type="submit" disabled={!trimmedMade || busy} className={`${addBtn} disabled:opacity-40`}>
              Save
            </button>
          </div>
        </form>
      )}

      {panel === 'guests' && (
        <div className="mt-3 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[14px] text-paper">Guests</span>
            <div role="group" aria-label="Number of guests" className="flex items-center gap-3">
              {stepButton('One fewer guest', () => setCount((n) => Math.max(1, n - 1)), count <= 1)}
              <span aria-live="polite" className="min-w-[2ch] text-center text-[16px] tabular-nums text-paper">
                {count}
              </span>
              {stepButton('One more guest', () => setCount((n) => Math.min(GUEST_MAX, n + 1)), count >= GUEST_MAX)}
            </div>
          </div>

          <fieldset>
            <legend className="text-[13px] text-muted">Allergies</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {[...ALLERGEN_PRESETS, ...customAllergies].map((a) => {
                const on = allergies.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleAllergy(a)}
                    className={`${chipBase} px-3.5 outline-none focus-visible:ring-2 focus-visible:ring-herb ${chipTone(on)}`}
                  >
                    {a}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                className={fieldCls}
                aria-label="Other allergy"
                placeholder="Other allergy"
                value={custom}
                maxLength={40}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustom();
                  }
                }}
              />
              <button type="button" onClick={addCustom} disabled={!custom.trim()} className={`${addBtn} disabled:opacity-40`}>
                Add
              </button>
            </div>
          </fieldset>

          <div>
            <label htmlFor="guest-note" className="block text-[13px] text-muted">
              Note (optional)
            </label>
            <input
              id="guest-note"
              className={`${fieldCls} mt-2`}
              value={note}
              maxLength={STATUS_NOTE_MAX}
              placeholder="e.g. vegetarian"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            {canSwap && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onSwapForGuests(guests, trimmedNote)}
                className={`${primaryBtn} w-full disabled:opacity-40`}
              >
                Swap for a meal that works
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                onMark({
                  status: 'replaced',
                  guests: count,
                  guestAllergies: guests.allergies,
                  ...(trimmedNote ? { note: trimmedNote } : {}),
                })
              }
              className={`${canSwap ? secondaryBtn : primaryBtn} w-full disabled:opacity-40`}
            >
              Just note it
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-[13px] text-[#D98C7A]">{error}</p>}
    </section>
  );
}
