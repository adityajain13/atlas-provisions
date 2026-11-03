import { Fragment, useEffect, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  DAYS,
  SLOTS,
  flyerWeekOf,
  type Day,
  type Household,
  type Slot,
  type WeekOverride,
} from '@provisions/shared';
import { errorMessage, generatePlan, getHousehold } from '../api';
import { Header } from '../components/Header';
import { Page } from '../components/Page';
import { Section } from '../components/Section';
import { addBtn, chipBase, chipTone, ctaBtn, eyebrow, fieldCls, removeIconBtn } from '../components/ui';
import { DAY_LETTER, DAY_SHORT, SLOT_LETTER, SLOT_LABEL } from '../lib/labels';

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
  const navigate = useNavigate();

  useEffect(() => {
    getHousehold()
      .then(setHousehold)
      .catch((e: unknown) => setLoadError(errorMessage(e)));
  }, []);

  const people = household?.people ?? [];
  const maxCount = people.length + 2;
  const budgetValue = budget ?? (household ? String(household.defaultBudget) : '');

  function defaultCount(day: Day, slot: Slot): number {
    if (!household) return 0;
    return people.filter((p) => household.schedule[p.id]?.[day]?.[slot] === true).length;
  }

  function isFixed(day: Day, slot: Slot): boolean {
    return !!household?.fixedMeals.some((m) => m.active && m.slot === slot && m.days.includes(day));
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
    setGenerating(true);
    setGenerateError(null);
    try {
      await generatePlan({
        weekOf: flyerWeekOf(new Date()),
        budget: budgetNumber,
        cravings,
        overrides: buildOverrides(),
        useItUp,
      });
      navigate('/');
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

  return (
    <Page>
      <Header title="Plan this week" />

      <Section title="Budget">
        <label className="block">
          <div className="flex items-baseline gap-1 border-b border-line pb-2">
            <span className="font-display text-[32px] text-muted">$</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              aria-label="Weekly budget"
              className="w-full bg-transparent font-display text-[32px] text-paper focus:outline-none"
              value={budgetValue}
              onChange={(e) => setBudget(e.target.value)}
            />
          </div>
        </label>
      </Section>

      <Section title="Cravings">
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
      >
        {loadError && <p className="text-[14px] text-[#D98C7A]">Could not load household: {loadError}</p>}
        {!household && !loadError && <p className="text-[14px] text-muted">Loading&hellip;</p>}
        {household && (
          <div className="grid grid-cols-[28px_repeat(7,minmax(0,1fr))] gap-1.5">
            <span />
            {DAYS.map((d) => (
              <span key={d} className="text-center text-[11px] text-muted" aria-hidden="true">
                {DAY_LETTER[d]}
              </span>
            ))}
            {SLOTS.map((slot) => (
              <Fragment key={slot}>
                <span className="flex items-center text-[11px] text-muted" aria-hidden="true">
                  {SLOT_LETTER[slot]}
                </span>
                {DAYS.map((day) => {
                  const key = `${slot}-${day}`;
                  const label = `${SLOT_LABEL[slot]} ${DAY_SHORT[day]}`;
                  if (isFixed(day, slot)) {
                    return (
                      <span
                        key={key}
                        aria-label={`${label}: fixed meal`}
                        className="flex h-11 items-center justify-center rounded-md border border-edge text-[11px] text-muted"
                      >
                        Fix
                      </span>
                    );
                  }
                  const def = defaultCount(day, slot);
                  const override = overrides[key];
                  const value = override ?? def;
                  const changed = override !== undefined && override !== def;
                  const cap = household.timeCaps[day]?.[slot];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => cycle(key)}
                      aria-label={`${value === 0 ? `${label}: out` : `${label}: ${value} eating`}${
                        cap ? `, ${cap} minute cap` : ''
                      }`}
                      className={`flex h-11 flex-col items-center justify-center rounded-md border text-[15px] ${
                        changed ? 'border-herb text-herbLight' : 'border-edge text-paper'
                      }`}
                    >
                      {value === 0 ? <span className="text-[13px] text-muted">Out</span> : value}
                      {cap !== undefined && <span className="text-[10px] leading-none text-muted">{cap}m</span>}
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </div>
        )}
      </Section>

      <Section title="Options">
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

      <div className="mt-10">
        <button
          type="button"
          disabled={generating || household === null}
          onClick={generate}
          className={ctaBtn}
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
