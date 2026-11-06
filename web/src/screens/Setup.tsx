import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Household } from '@provisions/shared';
import { Logo } from '../components/Logo';
import { SaveStatus } from '../components/SaveStatus';
import { Section } from '../components/Section';
import { linkBtn, primaryBtn, secondaryBtn } from '../components/ui';
import { useHouseholdDoc, type HouseholdUpdate } from '../lib/useHouseholdDoc';
import { SETUP_STEPS, SETUP_STEP_COUNT, canAdvance, clampStep, stepDone } from '../lib/setupSteps';
import { useSetupGate } from '../setupGate';

/** Steps a plan cannot be made without: someone to plan for and a store to price from. */
const REQUIRED_STEPS = new Set([2, 4]);
import {
  AllergyFields,
  BudgetSection,
  CuisinesSection,
  DishesSection,
  EquipmentSection,
  FixedMealsSection,
  ItemRulesSection,
  PeopleSection,
  PrepSection,
  ScheduleSection,
  SpiceRackSection,
  StorageSection,
  StoresSection,
} from './Household';

const STEP_KEY = 'ap.setupStep';

// The saved step survives a reload. Browsers that block storage just start at step 1.
function readSavedStep(): number {
  try {
    return clampStep(localStorage.getItem(STEP_KEY));
  } catch {
    return 1;
  }
}

function saveStep(step: number) {
  try {
    localStorage.setItem(STEP_KEY, String(step));
  } catch {
    // Nothing to do: the wizard still works without it.
  }
}

function clearSavedStep() {
  try {
    localStorage.removeItem(STEP_KEY);
  } catch {
    // Same as above.
  }
}

/**
 * First-time setup, as a stepper. Each step reuses the Household page's own sections, and every edit autosaves
 * through the same hook and save pill. Finishing sets setupDone, so the app opens normally from then on.
 */
export default function Setup() {
  const { h, update, loadError, flush } = useHouseholdDoc();
  const { markSetupDone } = useSetupGate();
  const navigate = useNavigate();
  const [step, setStep] = useState(readSavedStep);
  // Set when the user finishes. The destination is navigated to once the done flag is in the document and sent.
  const [leaving, setLeaving] = useState<string | null>(null);
  const finished = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const ready = h !== null;

  useEffect(() => {
    saveStep(step);
  }, [step]);

  // A new step starts at the top, with its heading focused so a screen reader announces it.
  useEffect(() => {
    if (!ready) return;
    window.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [step, ready]);

  useEffect(() => {
    if (leaving === null || h?.setupDone !== true || finished.current) return;
    finished.current = true;
    flush();
    markSetupDone();
    clearSavedStep();
    navigate(leaving);
  }, [leaving, h, flush, markSetupDone, navigate]);

  function finish(dest: string) {
    update((prev) => ({ ...prev, setupDone: true }));
    setLeaving(dest);
  }

  const shell = (children: ReactNode) => (
    <div className="flex min-h-screen flex-col bg-ink font-sans text-paper">
      <div className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-8">{children}</div>
    </div>
  );

  if (loadError) {
    return shell(
      <p className="mt-10 text-[14px] text-[#D98C7A]">Could not load your household: {loadError}</p>,
    );
  }
  if (!h) {
    return shell(<p className="mt-10 text-[14px] text-muted">Loading&hellip;</p>);
  }

  const info = SETUP_STEPS[step - 1]!;
  const last = step === SETUP_STEP_COUNT;
  const busy = leaving !== null;
  const canNext = canAdvance(h, step);
  const canPlan = stepDone(h, 2) && stepDone(h, 4);

  return (
    <div className="flex min-h-screen flex-col bg-ink font-sans text-paper">
      <div className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-6">
        <header className="flex items-center justify-between gap-4 pt-6 lg:pt-10">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo size={20} className="shrink-0 text-herb" />
            <span className="truncate text-[12px] uppercase tracking-[0.18em] text-muted">Set up your household</span>
          </div>
          <button type="button" disabled={busy} onClick={() => finish('/')} className={`${linkBtn} shrink-0 disabled:opacity-40`}>
            Finish later
          </button>
        </header>

        <div className="mt-6">
          <div className="flex items-center justify-between gap-4">
            <p className="text-[13px] text-muted">
              Step {step} of {SETUP_STEP_COUNT}
            </p>
            <SaveStatus />
          </div>
          <div
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={1}
            aria-valuemax={SETUP_STEP_COUNT}
            aria-valuenow={step}
            aria-valuetext={`Step ${step} of ${SETUP_STEP_COUNT}`}
            className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line2"
          >
            <div
              className="h-full rounded-full bg-herb transition-[width] duration-300"
              style={{ width: `${(step / SETUP_STEP_COUNT) * 100}%` }}
            />
          </div>
        </div>

        <div className="mt-10">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] text-paper outline-none lg:text-[40px]"
          >
            {info.title}
          </h1>
          <p className="mt-3 text-[15px] text-muted">{info.why}</p>
          <div className="mt-8 [&>section]:mt-10 [&>section:first-child]:mt-0">
            <StepBody step={step} h={h} update={update} onOpen={setStep} />
          </div>
        </div>
      </div>

      <footer className="sticky bottom-0 z-10 border-t border-line bg-ink">
        <div className="mx-auto w-full max-w-[720px] px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
          {last ? (
            <div className="flex flex-col gap-2">
              {!canPlan && (
                <p className="text-[13px] text-muted">Add at least one person and one store to plan a week.</p>
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <BackButton disabled={busy} onClick={() => setStep(step - 1)} />
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
                  <button type="button" disabled={busy} onClick={() => finish('/')} className={`${secondaryBtn} disabled:opacity-40`}>
                    Go to my week
                  </button>
                  <button
                    type="button"
                    disabled={busy || !canPlan}
                    onClick={() => finish('/plan')}
                    className={`${primaryBtn} disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    Plan my first week
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              {step > 1 ? <BackButton disabled={busy} onClick={() => setStep(step - 1)} /> : <span />}
              <div className="flex items-center gap-2">
                {step > 2 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setStep(step + 1)}
                    className="min-h-11 px-2 text-[14px] text-muted hover:text-paper disabled:opacity-40"
                  >
                    Skip this step
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy || !canNext}
                  onClick={() => setStep(step + 1)}
                  className={`${primaryBtn} disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  {step === 1 ? 'Get started' : 'Next'}
                </button>
              </div>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}

function BackButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`${secondaryBtn} disabled:opacity-40`}>
      Back
    </button>
  );
}

/** The sections of one step. Step 8 is the summary, with a way back to every step that is not done. */
function StepBody({
  step,
  h,
  update,
  onOpen,
}: {
  step: number;
  h: Household;
  update: HouseholdUpdate;
  onOpen: (step: number) => void;
}) {
  switch (step) {
    case 1:
      return (
        <>
          <ul className="space-y-4">
            {[
              'Reads local flyers and store prices.',
              'Plans a week of meals within your budget.',
              'Builds the shopping list and a prep plan.',
            ].map((line) => (
              <li key={line} className="flex gap-3 text-[16px] text-paper">
                <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-herb" aria-hidden="true" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <p className="mt-10 text-[14px] text-muted">Takes about 5 minutes. Everything can be changed later in Household.</p>
        </>
      );

    case 2:
      return (
        <>
          {h.people.length === 0 && <p className="mb-2 text-[14px] text-herbLight">Add at least one person to continue.</p>}
          <PeopleSection h={h} update={update} />
        </>
      );

    case 3:
      return (
        <>
          <ScheduleSection h={h} update={update} />
          <div>
            <p className="mt-10 text-[13px] text-muted">Meals that never change, like a weekday breakfast.</p>
            <FixedMealsSection h={h} update={update} />
          </div>
          <PrepSection h={h} update={update} />
        </>
      );

    case 4:
      return (
        <>
          <p className="text-[13px] text-muted">
            T&amp;T prices need the browser extension &mdash; you can set that up later on Household.
          </p>
          <StoresSection h={h} update={update} />
        </>
      );

    case 5:
      return <BudgetSection h={h} update={update} />;

    case 6:
      return (
        <>
          <CuisinesSection h={h} update={update} />
          <DishesSection h={h} update={update} />
          <ItemRulesSection h={h} update={update} />
        </>
      );

    case 7:
      return (
        <>
          <Section title="Allergies" caption="Hard block. A plan with these is never shown.">
            {h.people.length === 0 && <p className="text-[14px] text-muted">Add people in step 2 first.</p>}
            {h.people.map((p) => (
              <div key={p.id} className="mb-6">
                <p className="mb-2 text-[15px] text-paper">{p.name}</p>
                <AllergyFields person={p} update={update} />
              </div>
            ))}
          </Section>
          <EquipmentSection h={h} update={update} />
          <StorageSection h={h} update={update} />
          <SpiceRackSection h={h} update={update} />
        </>
      );

    default:
      return <Summary h={h} onOpen={onOpen} />;
  }
}

function Summary({ h, onOpen }: { h: Household; onOpen: (step: number) => void }) {
  const rows = SETUP_STEPS.filter((s) => s.step >= 2 && s.step <= 7);
  return (
    <ul>
      {rows.map((s) => {
        const done = stepDone(h, s.step);
        return (
          <li key={s.step} className="flex items-center justify-between gap-4 border-b border-line2 py-3.5">
            <div className="flex min-w-0 items-center gap-3">
              {done ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-herbLight" aria-hidden="true">
                  <path d="M2.5 7.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-edge" aria-hidden="true" />
              )}
              <div className="min-w-0">
                <p className="text-[15px] text-paper">{s.short}</p>
                <p className={`text-[13px] ${done ? 'text-herbLight' : REQUIRED_STEPS.has(s.step) ? 'text-[#D98C7A]' : 'text-muted'}`}>
                  {done ? 'Done' : REQUIRED_STEPS.has(s.step) ? 'Needed before your first plan' : 'Using defaults'}
                </p>
              </div>
            </div>
            <button type="button" onClick={() => onOpen(s.step)} className={`${linkBtn} shrink-0`}>
              Open
            </button>
          </li>
        );
      })}
    </ul>
  );
}
