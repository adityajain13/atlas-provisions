import { Fragment, useEffect, useState, type KeyboardEvent } from 'react';
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
import { addBtn, chipBase, ctaBtn, eyebrow, fieldCls, removeIconBtn, secondaryBtn } from '../components/ui';
import { DAY_SHORT, SLOT_LABEL } from '../lib/labels';
import { formatTimeCap, spokenCap } from '../lib/timeCaps';
import { existingNote, planTitle, replaceTitle, useViewedWeek, weekOffset } from '../lib/week';

export default function Plan() {
  const [household, setHousehold] = useState<Household | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [budget, setBudget] = useState<string | null>(null);
  const [cravings, setCravings] = useState<string[]>([]);
  const [cravingText, setCravingText] = useState('');
  // Headcount overrides per cell, keyed `${slot}-${day}`. Absent means default.
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [useItUp, setUseItUp] = useState(true);
  const [generating, setGenerating] = useState(false);
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

  const people = household?.people ?? [];
  const maxCount = people.length + 2;
  const budgetValue = budget ?? (household ? String(household.defaultBudget) : '');

  function defaultCount(day: Day, slot: Slot): number {
    if (!household) return 0;
    return people.filter((p) => household.schedule[p.id]?.[day]?.[slot] === true).length;
  }

  function fixedMealAt(day: Day, slot: Slot): FixedMeal | undefined {
    return household?.fixedMeals.find((m) => m.active && m.slot === slot && m.days.includes(day));
  }

  function isFixed(day: Day, slot: Slot): boolean {
    return fixedMealAt(day, slot) !== undefined;
  }

  // 0, 1, 2 ... up to people + 2, then back to the default (no override).
  function cycle(key: string) {
    setOverrides((prev) => {
      const next = { ...prev };
      const current = prev[key];
      if (current === undefined) next[key] = 0;
      else if (current < maxCount) next[key] = current + 1;
      else delete next[key];
      return next;
    });
  }

  // Only cells that differ from the default headcount. Out (0) becomes eatingOut.
  function buildOverrides(): WeekOverride[] {
    const out: WeekOverride[] = [];
    for (const day of DAYS) {
      for (const slot of SLOTS) {
        if (isFixed(day, slot)) continue;
        const value = overrides[`${slot}-${day}`];
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
    try {
      const request = {
        weekOf,
        budget: budgetNumber,
        cravings,
        overrides: buildOverrides(),
        useItUp,
      };
      await track(generatePlan(request), () => generatePlan(request), { busy: 'Planning…' });
      navigate(`/?week=${weekOf}`);
    } catch (e) {
      setGenerateError(errorMessage(e));
      setGenerating(false);
    }
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
        caption="Outlined in green: changed from your default this week."
        className="lg:col-start-2 lg:row-span-3 lg:row-start-1"
      >
        {loadError && <p className="text-[14px] text-[#D98C7A]">Could not load household: {loadError}</p>}
        {!household && !loadError && <p className="text-[14px] text-muted">Loading&hellip;</p>}
        {household && (
          <div className="grid grid-cols-[76px_repeat(7,minmax(0,1fr))] gap-1.5">
            <span />
            {DAYS.map((d, i) => (
              <span key={d} className="flex flex-col items-center text-[11px] leading-tight text-muted" aria-hidden="true">
                <span>{DAY_SHORT[d]}</span>
                <span className="text-[12px] text-paper">{Number(addDaysIso(weekOf, i).slice(8))}</span>
              </span>
            ))}
            {SLOTS.map((slot) => (
              <Fragment key={slot}>
                <span className="flex items-center text-[12px] text-muted" aria-hidden="true">
                  {SLOT_LABEL[slot]}
                </span>
                {DAYS.map((day) => {
                  const key = `${slot}-${day}`;
                  const fixed = fixedMealAt(day, slot);
                  const dayName = `${DAY_LONG[day]} ${SLOT_LABEL[slot].toLowerCase()}`;
                  if (fixed) {
                    return (
                      <span
                        key={key}
                        aria-label={`Fixed meal: ${fixed.name}`}
                        title={`Fixed meal: ${fixed.name}`}
                        className="flex h-11 items-center justify-center overflow-hidden rounded-md border border-edge text-[11px] text-muted lg:h-12"
                      >
                        Fixed
                      </span>
                    );
                  }
                  const def = defaultCount(day, slot);
                  const override = overrides[key];
                  const value = override ?? def;
                  const changed = override !== undefined && override !== def;
                  const cap = household.timeCaps[day]?.[slot];
                  const eating = value === 0 ? 'out' : `${value} ${value === 1 ? 'person' : 'people'}`;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => cycle(key)}
                      aria-label={`${dayName}, ${eating}${cap ? `, ${spokenCap(cap)}` : ''}`}
                      className={`flex h-11 flex-col items-center justify-center rounded-md border text-[15px] lg:h-12 ${
                        changed ? 'border-herb text-herbLight' : 'border-edge text-paper'
                      }`}
                    >
                      {value === 0 ? <span className="text-[13px] text-muted">Out</span> : value}
                      {cap !== undefined && (
                        <span className="whitespace-nowrap text-[10px] leading-none text-muted">{formatTimeCap(cap)}</span>
                      )}
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </div>
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
          className={`${ctaBtn} lg:w-auto lg:min-w-[240px]`}
        >
          {generating ? 'Planning… this takes up to a minute' : 'Generate plan'}
        </button>
        {generateError && (
          <p className="mt-3 rounded-md border border-herb px-4 py-3 text-[14px] text-muted">{generateError}</p>
        )}
      </div>
    </Page>
  );
}
