import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  DAYS,
  DAY_LONG,
  SLOTS,
  WEEKS_AHEAD,
  addDaysIso,
  addWeeks,
  type Day,
  type FixedMeal,
  type Household,
  type Slot,
  type WeekOverride,
} from '@provisions/shared';
import { errorMessage, generatePlan, getHousehold, getPlan } from '../api';
import { Header } from '../components/Header';
import { Page } from '../components/Page';
import { SaveStatus, useSaveScope, useSaveStatus } from '../components/SaveStatus';
import { Section } from '../components/Section';
import WeekSwitcher from '../components/WeekSwitcher';
import { useConfirm } from '../components/ConfirmDialog';
import { FixedMealMenu, type FixedChoice } from '../components/FixedMealMenu';
import { QUICK, SlotGrid, type SlotCellView, type SlotHeaderView } from '../components/SlotGrid';
import { Spinner } from '../components/Spinner';
import { addBtn, chipBase, ctaBtn, eyebrow, fieldCls, removeIconBtn, secondaryBtn } from '../components/ui';
import { DAY_SHORT, SLOT_LABEL } from '../lib/labels';
import { formatTimeCap, spokenCap } from '../lib/timeCaps';
import { cellKey, type Cell } from '../lib/cells';
import {
  MORE_MAX,
  MORE_MIN,
  applyKey,
  attendanceMenu,
  changeMessage,
  headcountText,
  parseMore,
  type AttendanceCell,
  type AttendanceState,
} from '../lib/attendance';
import { WAITING_TEXT, progressText } from '../lib/planProgress';
import { existingNote, planTitle, replaceTitle, useViewedWeek, weekOffset } from '../lib/week';

const EMPTY: AttendanceState = { overrides: {}, choices: {} };
const PLURAL: Record<Slot, string> = { breakfast: 'breakfasts', lunch: 'lunches', dinner: 'dinners' };

export default function Plan() {
  const [household, setHousehold] = useState<Household | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [budget, setBudget] = useState<string | null>(null);
  const [cravings, setCravings] = useState<string[]>([]);
  const [cravingText, setCravingText] = useState('');
  // Who's eating this week, kept per week: headcounts (against each cell's default) and fixed-meal choices.
  const [attendance, setAttendance] = useState<Record<string, AttendanceState>>({});
  const [useItUp, setUseItUp] = useState(true);
  const [fixedMenu, setFixedMenu] = useState<{
    cell: Cell;
    fixed: FixedMeal;
    anchor: HTMLElement;
    desktop: boolean;
  } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const { track } = useSaveStatus();
  // Inputs are not saved until the plan is generated, so the pill says so.
  useSaveScope('plan', household !== null);
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { weekOf, current, go } = useViewedWeek();
  // Whether the viewed week already has a saved plan. Null while it is being read.
  const [hasPlan, setHasPlan] = useState<boolean | null>(null);
  const past = weekOffset(weekOf, current) < 0;
  const range = { first: current, last: addWeeks(current, WEEKS_AHEAD) };
  const week: AttendanceState = attendance[weekOf] ?? EMPTY;

  useEffect(() => {
    getHousehold()
      .then(setHousehold)
      .catch((e: unknown) => setLoadError(errorMessage(e)));
  }, []);

  useEffect(() => {
    let alive = true;
    setHasPlan(null);
    getPlan(weekOf)
      .then((plan) => {
        if (alive) setHasPlan(plan !== null);
      })
      .catch(() => {
        if (alive) setHasPlan(false);
      });
    return () => {
      alive = false;
    };
  }, [weekOf]);

  const budgetValue = budget ?? (household ? String(household.defaultBudget) : '');

  function setWeek(next: AttendanceState) {
    setAttendance((prev) => ({ ...prev, [weekOf]: next }));
  }

  function defaultCount(day: Day, slot: Slot): number {
    if (!household) return 0;
    const people = household.people;
    return people.filter((p) => household.schedule[p.id]?.[day]?.[slot] === true).length;
  }

  function fixedMealAt(day: Day, slot: Slot): FixedMeal | undefined {
    return household?.fixedMeals.find((m) => m.active && m.slot === slot && m.days.includes(day));
  }

  /** A cell as the who's-eating menu sees it: its headcount now and by default, or its fixed-meal choice. */
  function attendanceCell(cell: Cell): AttendanceCell {
    const key = cellKey(cell);
    return {
      cell,
      fixed: fixedMealAt(cell.day, cell.slot) !== undefined,
      value: week.overrides[key] ?? defaultCount(cell.day, cell.slot),
      def: defaultCount(cell.day, cell.slot),
      choice: week.choices[key] ?? 'keep',
    };
  }

  function openFixedMenu(cell: Cell, fixed: FixedMeal, anchor: HTMLElement) {
    setFixedMenu({ cell, fixed, anchor, desktop: window.matchMedia('(min-width: 1024px)').matches });
  }

  const closeFixedMenu = useCallback(
    (returnFocus: boolean) => {
      if (returnFocus && fixedMenu?.anchor.isConnected) fixedMenu.anchor.focus();
      setFixedMenu(null);
    },
    [fixedMenu],
  );

  function pickFixedChoice(value: FixedChoice) {
    if (!fixedMenu) return;
    setWeek(applyKey(week, [attendanceCell(fixedMenu.cell)], value));
    closeFixedMenu(true);
  }

  // Fixed cells send skipFixed or eatingOut when changed. Other cells send only a headcount that differs
  // from the default. Out (0) becomes eatingOut.
  function buildOverrides(): WeekOverride[] {
    const out: WeekOverride[] = [];
    for (const day of DAYS) {
      for (const slot of SLOTS) {
        const key = `${day}-${slot}`;
        if (fixedMealAt(day, slot)) {
          const choice = week.choices[key] ?? 'keep';
          if (choice === 'plan') out.push({ day, slot, skipFixed: true });
          if (choice === 'out') out.push({ day, slot, eatingOut: true });
          continue;
        }
        const value = week.overrides[key];
        if (value === undefined || value === defaultCount(day, slot)) continue;
        out.push(value === 0 ? { day, slot, eatingOut: true } : { day, slot, headcount: value });
      }
    }
    return out;
  }

  async function generate() {
    const budgetNumber = Number(budgetValue);
    if (!Number.isFinite(budgetNumber) || budgetNumber < 1 || budgetNumber > 2000) {
      setGenerateError('Budget must be between $1 and $2,000.');
      return;
    }
    if (hasPlan) {
      const replace = await confirm({
        title: replaceTitle(weekOf, current),
        message: 'The saved meals and shopping list for that week are replaced.',
        confirmLabel: 'Replace',
        cancelLabel: 'Keep it',
        danger: true,
      });
      if (!replace) return;
    }
    setGenerating(true);
    setGenerateError(null);
    const request = {
      weekOf,
      budget: budgetNumber,
      cravings,
      overrides: buildOverrides(),
      useItUp,
    };
    const run = () => generatePlan(request, (e) => setProgress(progressText(e)));
    try {
      await track(run(), run, { busy: 'Planning…' });
      navigate(`/?week=${weekOf}`);
    } catch (e) {
      setGenerateError(errorMessage(e));
      setGenerating(false);
    } finally {
      setProgress(null);
    }
  }

  async function resetWeek() {
    const ok = await confirm({
      title: 'Reset this week?',
      message: 'Everyone goes back to the household schedule, and fixed meals go back to being kept.',
      confirmLabel: 'Reset',
      danger: true,
    });
    if (ok) setWeek(EMPTY);
  }

  function addCraving() {
    const v = cravingText.trim();
    setCravingText('');
    if (!v || cravings.some((c) => c.toLowerCase() === v.toLowerCase())) return;
    setCravings([...cravings, v]);
  }

  function onCravingKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCraving();
    }
  }

  if (past) {
    return (
      <Page>
        <Header title={planTitle(weekOf, current)} status={<SaveStatus />} />
        <div className="mt-6">
          <WeekSwitcher weekOf={weekOf} current={current} first={range.first} last={range.last} onChange={go} />
        </div>
        <section className="mt-10 border-t border-line pt-6">
          <h2 className="font-display text-[24px] font-semibold tracking-[-0.01em] text-paper">Past weeks can&apos;t be planned</h2>
          <p className="mt-2 text-[14px] text-muted">
            That week has already passed. You can still see what was planned for it.
          </p>
          <Link to={`/?week=${weekOf}`} className={`mt-6 ${secondaryBtn}`}>
            View that week
          </Link>
        </section>
      </Page>
    );
  }

  const changedCount = Object.keys(week.overrides).length + Object.keys(week.choices).length;

  return (
    <Page>
      <Header title={planTitle(weekOf, current)} status={<SaveStatus />} />
      <div className="mt-6">
        <WeekSwitcher weekOf={weekOf} current={current} first={range.first} last={range.last} onChange={go} />
      </div>
      {hasPlan && (
        <p className="mt-6 text-[13px] text-muted">
          {existingNote(weekOf, current)} Generating replaces it.
        </p>
      )}

      {fixedMenu && (
        <FixedMealMenu
          key={`${weekOf}|${cellKey(fixedMenu.cell)}`}
          title={`${DAY_LONG[fixedMenu.cell.day]} ${SLOT_LABEL[fixedMenu.cell.slot].toLowerCase()} · ${fixedMenu.fixed.name}`}
          anchor={fixedMenu.anchor}
          desktop={fixedMenu.desktop}
          value={week.choices[cellKey(fixedMenu.cell)] ?? 'keep'}
          onPick={pickFixedChoice}
          onClose={closeFixedMenu}
        />
      )}

      {/* Phone: one column in this order. Desktop: budget, cravings and options on the left, who's eating on the right. */}
      <div className="lg:mt-12 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:items-start lg:gap-x-12 lg:gap-y-12">
      <Section title="Budget" className="lg:col-start-1 lg:row-start-1">
        <label className="block">
          <div className="flex items-baseline gap-1 border-b border-line pb-2">
            <span className="text-[32px] font-semibold tabular-nums text-muted">$</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              aria-label="Weekly budget"
              className="w-full bg-transparent text-[32px] font-semibold tabular-nums text-paper focus:outline-none"
              value={budgetValue}
              onChange={(e) => setBudget(e.target.value)}
            />
          </div>
        </label>
      </Section>

      <Section title="Cravings" className="lg:col-start-1 lg:row-start-2">
        <div className="flex flex-wrap gap-2">
          {cravings.map((c) => (
            <span key={c} className={`${chipBase} gap-1 border-herb pl-4 pr-1 text-herbLight`}>
              {c}
              <button
                type="button"
                aria-label={`Remove ${c}`}
                onClick={() => setCravings(cravings.filter((x) => x !== c))}
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
            placeholder="Add a craving"
            value={cravingText}
            maxLength={60}
            onChange={(e) => setCravingText(e.target.value)}
            onKeyDown={onCravingKey}
          />
          <button type="button" onClick={addCraving} className={addBtn}>
            Add
          </button>
        </div>
      </Section>

      <Section
        title="Who's eating"
        caption="Outlined in green: changed from your default this week. Tap a meal for its options."
        className="lg:col-start-2 lg:row-span-3 lg:row-start-1"
      >
        {loadError && <p className="text-[14px] text-[#D98C7A]">Could not load household: {loadError}</p>}
        {!household && !loadError && <p className="text-[14px] text-muted">Loading&hellip;</p>}
        {household && (
          <SlotGrid
            label="Who's eating by day and meal"
            menuLabel={(title) => `Who's eating, ${title}`}
            toolbar={() => (
              <button type="button" className={QUICK} disabled={changedCount === 0} onClick={() => void resetWeek()}>
                Reset to default
              </button>
            )}
            cellView={(cell): SlotCellView => {
              const a = attendanceCell(cell);
              const dayName = `${DAY_LONG[cell.day]} ${SLOT_LABEL[cell.slot].toLowerCase()}`;
              const fixed = fixedMealAt(cell.day, cell.slot);
              if (fixed) {
                const changed = a.choice !== 'keep';
                // Short words: a cell is about 30px wide on a phone.
                const word = a.choice === 'plan' ? 'Plan' : a.choice === 'out' ? 'Out' : 'Fixed';
                return {
                  label: `${dayName}, fixed meal: ${fixed.name}${
                    changed ? (a.choice === 'plan' ? ', planned instead' : ', out') : ''
                  }`,
                  content: <span className="text-center leading-[1.1]">{word}</span>,
                  className: `h-11 overflow-hidden lg:h-12 ${
                    changed ? 'border-herb text-[10px] tracking-tight text-herbLight' : 'border-edge text-[11px] text-muted'
                  }`,
                };
              }
              const cap = household.timeCaps[cell.day]?.[cell.slot];
              const changed = week.overrides[cellKey(cell)] !== undefined;
              return {
                label: `${dayName}, ${headcountText(a.value)}${cap ? `, ${spokenCap(cap)}` : ''}`,
                content: (
                  <>
                    {a.value === 0 ? <span className="text-[13px] text-muted">Out</span> : a.value}
                    {cap !== undefined && <span className="whitespace-nowrap text-[10px] leading-none text-muted">{formatTimeCap(cap)}</span>}
                  </>
                ),
                className: `h-11 flex-col text-[15px] lg:h-12 ${changed ? 'border-herb text-herbLight' : 'border-edge text-paper'}`,
              };
            }}
            dayHeader={(day): SlotHeaderView => {
              const date = Number(addDaysIso(weekOf, DAYS.indexOf(day)).slice(8));
              return {
                label: `Set all of ${DAY_LONG[day]}`,
                content: (
                  <>
                    <span>{DAY_SHORT[day]}</span>
                    <span className="text-[12px] text-paper">{date}</span>
                  </>
                ),
                className: 'flex flex-col items-center rounded text-[11px] leading-tight text-muted hover:text-paper',
              };
            }}
            slotHeader={(slot): SlotHeaderView => ({
              label: `Set all ${PLURAL[slot]}`,
              content: SLOT_LABEL[slot],
              className: 'flex items-center rounded text-left text-[12px] text-muted hover:text-paper',
            })}
            menu={(cells) => {
              const items = cells.map(attendanceCell);
              const m = attendanceMenu(items);
              return {
                subtitle: m.subtitle,
                items: m.items,
                custom: m.custom
                  ? { label: 'More…', hint: `People eating, guests included (${MORE_MIN} to ${MORE_MAX})`, min: MORE_MIN, max: MORE_MAX, step: 1, parse: parseMore }
                  : undefined,
                apply: (key) => {
                  const before = week;
                  setWeek(applyKey(week, items, key));
                  return { text: changeMessage(key, items), run: () => setWeek(before) };
                },
              };
            }}
            selectionNote={(cells) => {
              const fixedCount = cells.filter((c) => fixedMealAt(c.day, c.slot)).length;
              if (fixedCount === 0 || fixedCount === cells.length) return null;
              return (
                <span className="text-[13px] text-muted">
                  {fixedCount} fixed {fixedCount === 1 ? 'meal' : 'meals'} skipped
                </span>
              );
            }}
            onCellClick={(cell, anchor) => {
              const fixed = fixedMealAt(cell.day, cell.slot);
              if (!fixed) return false;
              openFixedMenu(cell, fixed, anchor);
              return true;
            }}
          />
        )}
      </Section>

      <Section title="Options" className="lg:col-start-1 lg:row-start-3">
        <label className="flex min-h-[48px] cursor-pointer items-center justify-between border-b border-line2">
          <span className="text-[15px] text-paper">Use it up</span>
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={useItUp}
            onChange={(e) => setUseItUp(e.target.checked)}
          />
        </label>
        <Link
          to="/household"
          className="flex min-h-[48px] items-center justify-between border-b border-line2"
        >
          <span className="text-[15px] text-paper">Variety rules</span>
          <span className={eyebrow}>Edit in Household</span>
        </Link>
      </Section>

      </div>

      <div className="mt-10 lg:mt-12 lg:flex lg:flex-col lg:items-end">
        <button
          type="button"
          disabled={generating || household === null}
          onClick={generate}
          className={`${ctaBtn} w-auto min-w-[240px]`}
        >
          {generating ? (
            <span className="inline-flex items-center justify-center gap-2">
              <Spinner />
              Planning…
            </span>
          ) : (
            'Generate plan'
          )}
        </button>
        {/* What the planner is doing. Empty when no plan is being made. */}
        <p aria-live="polite" className="mt-2 min-h-[20px] text-[13px] text-muted lg:text-right">
          {generating ? (progress ?? WAITING_TEXT) : ''}
        </p>
        {generateError && (
          <p className="mt-3 rounded-md border border-herb px-4 py-3 text-[14px] text-muted">{generateError}</p>
        )}
      </div>
    </Page>
  );
}

