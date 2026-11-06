import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DAY_LONG,
  SLOTS,
  torontoDate,
  type Day,
  type MealPlan,
  type PlannedMeal,
  type Rating,
  type RatingKind,
  type Slot,
} from '@provisions/shared';
import { errorMessage, getHousehold, getPlan, getRatings, regeneratePrep, saveRating, swapMeals, undoSwap } from '../api';
import { Header } from '../components/Header';
import { Page } from '../components/Page';
import { PrepBoard, PrepToday } from '../components/PrepArticle';
import { prepAnchor, stepsOnDay } from '../lib/prepView';
import MealDetail, { RATING_OPTIONS, TAG_TONE } from '../components/MealDetail';
import { CheckIcon, RefreshIcon, ReturnIcon } from '../components/Icons';
import { SaveStatus, useSaveScope, useSaveStatus } from '../components/SaveStatus';
import { NoPlan } from '../components/NoPlan';
import WeekSwitcher from '../components/WeekSwitcher';
import SwapDialog from '../components/SwapDialog';
import SwapBar from '../components/SwapBar';
import UndoToast from '../components/UndoToast';
import { planLabel, useViewedWeek, viewWindow, weekOffset } from '../lib/week';
import { secondaryBtn } from '../components/ui';
import { DAY_SHORT, SLOT_LABEL } from '../lib/labels';
import { defaultDay, planToWeek, type Rateable, type ViewMeal, type ViewWeek } from '../lib/planView';
import { swappedMessage, swapPreview } from '../lib/swap';
import { useChecks } from '../lib/useChecks';

const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-herb';

const sameMeal = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The rating everyone eating the meal has given it, or null when they differ or none has rated it. */
function ratingFor(ratings: Rating[], meal: Rateable): RatingKind | null {
  const values = meal.personIds.map(
    (id) => ratings.find((r) => r.personId === id && sameMeal(r.mealName, meal.name))?.rating ?? null,
  );
  const first = values[0];
  return first && values.every((v) => v === first) ? first : null;
}

type Source = { status: 'loading' } | { status: 'plan'; plan: MealPlan } | { status: 'none' } | { status: 'error'; error: string };

/** How one meal card looks while meals are being chosen or swapped. */
interface CardState {
  choosing: boolean; // choose mode is on
  selectable: boolean; // a planned meal in choose mode (fixed meals are not)
  chosen: boolean; // picked for the swap
  linked: boolean; // taken in by a leftover link, not picked
  busy: boolean; // being replaced while the planner works
  flash: boolean; // just replaced, for a moment
}

/** ISO date `n` days after `iso`. */
function isoPlus(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The saved plan's meal behind a drawn one, for its ingredients and steps. */
function plannedFor(plan: MealPlan | null, day: Day, meal: ViewMeal): PlannedMeal | undefined {
  return plan?.meals.find((m) => m.day === day && m.slot === meal.slot && m.name === meal.name);
}

export default function Week() {
  const { weekOf, current, go } = useViewedWeek();
  // Keyed by week: switching weeks starts a fresh load, day pick and open meal.
  return <WeekScreen key={weekOf} weekOf={weekOf} current={current} go={go} />;
}

function WeekScreen({ weekOf, current, go }: { weekOf: string; current: string; go: (weekOf: string) => void }) {
  // Null until the reader picks a day: then the default (today, or Sunday) applies.
  const [picked, setPicked] = useState<Day | null>(null);
  const { track } = useSaveStatus();
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [source, setSource] = useState<Source>({ status: 'loading' });
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [prepDay, setPrepDay] = useState<Day | null>(null);
  const [prepBusy, setPrepBusy] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);
  // Desktop only: the meal open in the side panel.
  const [openMeal, setOpenMeal] = useState<{ day: Day; meal: ViewMeal } | null>(null);
  const closeMeal = useCallback(() => setOpenMeal(null), []);
  // Meal swapping: choose mode, the meals picked, the meal ids the confirm dialog is for, and the note.
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<string[] | null>(null);
  const [swapNote, setSwapNote] = useState('');
  // The meals being replaced while the planner works, and the ones a swap just put in place.
  const [swapping, setSwapping] = useState<string[]>([]);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ key: number; count: number } | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  useSaveScope('sync', source.status === 'plan');
  // One set of ticks for both prep checklists (phone and desktop), so they never disagree.
  const { checks, toggle } = useChecks(source.status === 'plan' ? source.plan.weekOf : null);

  useEffect(() => {
    let alive = true;
    Promise.all([getPlan(weekOf), getHousehold().catch(() => null), getRatings().catch(() => [] as Rating[])])
      .then(([plan, household, saved]) => {
        if (!alive) return;
        setNames(new Map((household?.people ?? []).map((p) => [p.id, p.name])));
        setPrepDay(household?.prepDay ?? null);
        setRatings(saved);
        setSource(plan ? { status: 'plan', plan } : { status: 'none' });
      })
      .catch((e: unknown) => {
        if (alive) setSource({ status: 'error', error: errorMessage(e) });
      });
    return () => {
      alive = false;
    };
  }, [weekOf]);

  // The "just swapped" highlight lasts a moment.
  useEffect(() => {
    if (highlight.length === 0) return;
    const t = window.setTimeout(() => setHighlight([]), 2500);
    return () => window.clearTimeout(t);
  }, [highlight]);

  const window_ = viewWindow(current);
  const switcher = <WeekSwitcher weekOf={weekOf} current={current} first={window_.first} last={window_.last} onChange={go} />;
  // A week that has passed cannot be planned, so it gets no plan button, and it cannot be swapped.
  const past = weekOffset(weekOf, current) < 0;

  if (source.status === 'loading') {
    return (
      <Page>
        <Header title="Your week" />
        <div className="mt-6">{switcher}</div>
        <p className="mt-10 text-[14px] text-muted">Loading&hellip;</p>
      </Page>
    );
  }

  if (source.status !== 'plan') {
    return (
      <Page>
        <Header title="Your week" />
        <div className="mt-6">{switcher}</div>
        {source.status === 'error' ? (
          <p className="mt-10 text-[14px] text-muted">Could not load this week&apos;s plan: {source.error}</p>
        ) : (
          <NoPlan weekOf={weekOf} current={current} />
        )}
      </Page>
    );
  }

  const plan: MealPlan = source.plan;
  const week = planToWeek(plan, names);
  // Leftover links point at other planned meals. Opening one swaps the side panel to it.
  const openMealById = (id: string) => {
    for (const d of week.days) {
      const meal = d.meals.find((m) => m.id === id);
      if (meal) {
        setOpenMeal({ day: d.key, meal });
        return;
      }
    }
  };
  const todayIso = torontoDate();
  const selectedDay = picked ?? defaultDay(week.weekOf, todayIso);
  const day = week.days.find((d) => d.key === selectedDay) ?? week.days[0]!;
  const pct = week.budget > 0 ? Math.min(100, (week.spent / week.budget) * 100) : 0;
  const errors = plan?.issues.filter((i) => i.severity === 'error') ?? [];
  // Warnings that are not errors, such as estimated prices for a week whose flyers are not out yet.
  const notes = plan?.issues.filter((i) => i.severity === 'warning' && (i.check === 'prices' || i.check === 'prep-timing')) ?? [];
  // Desktop: jump the page to a day's prep group.
  const scrollToPrep = (day: Day) => document.getElementById(prepAnchor(day))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const prepWarning =
    plan && !plan.prep && prepDay === selectedDay ? (plan.issues.find((i) => i.check === 'prep')?.message ?? null) : null;

  // Choose mode: what the picked meals would replace, including the meals their leftover links bring in.
  const choice = choosing && selected.length > 0 ? swapPreview(plan, selected) : null;
  const linkedIds = choice ? choice.linked.map((e) => e.id) : [];
  const preview = dialog ? swapPreview(plan, dialog) : null;
  const cardState = (m: ViewMeal): CardState => {
    const id = m.id;
    const chosen = id !== undefined && selected.includes(id);
    return {
      choosing,
      selectable: choosing && id !== undefined && !m.fixed,
      chosen,
      linked: id !== undefined && linkedIds.includes(id),
      busy: id !== undefined && swapping.includes(id),
      flash: id !== undefined && highlight.includes(id),
    };
  };
  const toggleMeal = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const exitChoosing = () => {
    setChoosing(false);
    setSelected([]);
  };
  const openSwap = (ids: string[]) => {
    setSwapNote('');
    setSwapError(null);
    setDialog(ids);
  };

  // Rebuilds the prep list alone and shows the plan it returns.
  async function retryPrep() {
    if (!plan) return;
    setPrepBusy(true);
    setPrepError(null);
    const weekOf = plan.weekOf;
    try {
      setSource({ status: 'plan', plan: await track(regeneratePrep(weekOf), () => regeneratePrep(weekOf)) });
    } catch (e) {
      setPrepError(errorMessage(e));
    } finally {
      setPrepBusy(false);
    }
  }

  // Records the rating for every household member eating the meal, then reloads the ratings.
  async function rate(meal: Rateable, value: RatingKind) {
    setRatingError(null);
    const save = () =>
      Promise.all(
        meal.personIds.map((personId) =>
          saveRating({ mealName: meal.name, personId, rating: value, ingredientIds: meal.ingredientIds }),
        ),
      );
    try {
      await track(save(), save);
      setRatings(await getRatings());
    } catch (e) {
      setRatingError(errorMessage(e));
      setRatings(await getRatings().catch(() => ratings));
    }
  }

  // Swaps the meals of the confirm dialog. The planner fills the freed slots; the week is then reloaded.
  async function runSwap(ids: string[], note: string) {
    const replaced = swapPreview(plan, ids).closure;
    setDialog(null);
    setSwapError(null);
    setSwapping(replaced);
    try {
      const result = await track(swapMeals(plan.weekOf, ids, note), undefined, { busy: 'Planning…' });
      // The reload makes the List and prep screens show the new plan as well.
      const fresh = await getPlan(plan.weekOf).catch(() => null);
      setSource({ status: 'plan', plan: fresh ?? result });
      exitChoosing();
      closeMeal();
      setHighlight(result.added);
      setUndo((u) => ({ key: (u?.key ?? 0) + 1, count: result.swapped.length }));
    } catch (e) {
      setSwapError(errorMessage(e));
    } finally {
      setSwapping([]);
    }
  }

  // Puts back the plan the last swap replaced.
  async function runUndo() {
    setUndoBusy(true);
    setSwapError(null);
    try {
      const restored = await track(undoSwap(plan.weekOf));
      setSource({ status: 'plan', plan: restored });
      setUndo(null);
      setHighlight([]);
    } catch (e) {
      setSwapError(errorMessage(e));
      setUndo(null);
    } finally {
      setUndoBusy(false);
    }
  }

  // The batch-prep card and its retry line. Shared by both layouts.
  const warningFor = (message: string | null) =>
    message ? (
      <div className="space-y-3">
        <p className="text-[13px] text-muted">{message}</p>
        <button type="button" onClick={retryPrep} disabled={prepBusy} className={`${secondaryBtn} disabled:opacity-40`}>
          {prepBusy ? 'Regenerating prep…' : 'Regenerate prep'}
        </button>
        {prepError && <p className="text-[13px] text-[#D98C7A]">Could not regenerate prep: {prepError}</p>}
      </div>
    ) : null;

  const mobileWarning = warningFor(prepWarning);
  // Desktop shows the prep card for the household's prep day whichever day is selected.
  const deskPrep = plan?.prep ?? null;
  const deskWarning =
    plan && !plan.prep && prepDay ? warningFor(plan.issues.find((i) => i.check === 'prep')?.message ?? null) : null;
  const hasDeskSide = deskPrep !== null || deskWarning !== null;

  const swapErrorLine = swapError && <p className="mt-6 text-[13px] text-[#D98C7A]">Could not swap meals: {swapError}</p>;
  const chooseButton = (className: string) =>
    !past && !choosing ? (
      <button type="button" onClick={() => setChoosing(true)} className={className}>
        Choose meals to swap
      </button>
    ) : null;

  return (
    <Page>
      {/* Phone layout. Unchanged below 1024px. */}
      <div className="lg:hidden">
        <Header
          size="lg"
          status={<SaveStatus />}
          action={
            past ? undefined : (
              <Link
                to={`/plan?week=${weekOf}`}
                aria-label={planLabel(weekOf, current, true)}
                title={planLabel(weekOf, current, true)}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-edge text-muted"
              >
                <RefreshIcon />
              </Link>
            )
          }
          title={
            <>
              {day.dayLabel},
              <br />
              {day.headline}
            </>
          }
        />
        <div className="mt-4">{switcher}</div>
        {chooseButton(`mt-4 w-full ${secondaryBtn}`)}

        {errors.length > 0 && (
          <div className="mt-6 rounded-lg border border-edge px-4 py-3">
            <p className="text-[14px] text-paper">Plan has unresolved issues</p>
            <ul className="mt-2 space-y-1.5 text-[13px] text-muted">
              {errors.map((i) => (
                <li key={i.message}>{i.message}</li>
              ))}
            </ul>
          </div>
        )}
        {notes.map((i) => (
          <p key={i.message} className="mt-6 text-[13px] text-muted">
            {i.message}
          </p>
        ))}
        {swapErrorLine}

        <BudgetBlock week={week} pct={pct} className="mt-8" />

        <div className="mt-6 flex justify-between" role="group" aria-label="Day">
          {week.days.map((d) => {
            const active = d.key === selectedDay;
            return (
              <button
                key={d.key}
                type="button"
                aria-pressed={active}
                onClick={() => setPicked(d.key)}
                className={`flex h-14 w-11 flex-col items-center justify-center rounded-lg text-[11px] ${
                  active ? 'bg-paper text-ink' : 'border border-line text-muted'
                }`}
              >
                <span>{DAY_SHORT[d.key]}</span>
                <span className="text-[15px] font-medium">{d.dateNum}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 space-y-6">
          {plan?.prep && stepsOnDay(plan.prep, day.key).length > 0 && (
            <PrepToday
              plan={plan}
              prep={plan.prep}
              day={day.key}
              heading={isoPlus(week.weekOf, week.days.indexOf(day)) === todayIso ? 'Prep today' : `Prep for ${DAY_LONG[day.key]}`}
              ticked={checks.prep}
              onToggle={(id) => toggle('prep', id)}
            />
          )}
          {mobileWarning}
          {day.meals.map((m) => {
            const st = cardState(m);
            const frame = st.choosing
              ? st.selectable
                ? `rounded-lg border p-4 ${st.chosen ? 'border-herb' : st.linked ? 'border-herb/40' : 'border-edge'}`
                : 'rounded-lg border border-line2 p-4 opacity-50'
              : m.leftover
                ? 'rounded-lg border border-edge p-4'
                : 'border-t border-line pt-4';
            return (
              <article
                key={`${m.slot}-${m.name}`}
                aria-busy={st.busy || undefined}
                className={`relative ${frame} ${st.flash ? 'ring-2 ring-herb/70' : ''} ${st.busy ? 'skeleton opacity-60' : ''}`}
              >
                {st.selectable && (
                  <button
                    type="button"
                    aria-pressed={st.chosen}
                    aria-label={`${st.chosen ? 'Remove' : 'Choose'} ${m.name}`}
                    onClick={() => toggleMeal(m.id!)}
                    className={`${RING} absolute inset-0 z-10 rounded-lg`}
                  />
                )}
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-muted">
                    {SLOT_LABEL[m.slot]} &middot; {m.who}
                  </span>
                  <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted">
                    {st.linked && <span className="text-herbLight">Linked</span>}
                    {st.chosen && (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-herb text-ink">
                        <CheckIcon size={12} />
                      </span>
                    )}
                    {!st.choosing && (m.fixed ? 'Fixed' : m.cost !== null ? `$${m.cost.toFixed(2)}` : '')}
                  </span>
                </div>
                {m.leftover && (
                  <div className="mt-2">
                    <LeftoverLine meal={m} />
                  </div>
                )}
                <h3
                  className={`mt-2 font-display font-medium ${m.leftover ? 'text-paper/80' : 'text-paper'} ${
                    m.slot === 'dinner' ? 'text-[24px] leading-[1.2]' : 'text-[20px] leading-[1.25]'
                  }`}
                >
                  {m.name}
                </h3>
                <p className="mt-1 text-[13px] text-muted">{m.detail}</p>
                {m.makes && <MakesLine meal={m} className="mt-1 block text-[12px] text-muted" />}
                {m.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {m.tags.map((t) => (
                      <span
                        key={`${t.kind}-${t.text}`}
                        className={`rounded-full border px-2.5 py-1 text-[12px] ${TAG_TONE[t.kind]}`}
                      >
                        {t.text}
                      </span>
                    ))}
                  </div>
                )}
                {m.rateable && (
                  <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label={`Rate ${m.name}`}>
                    {RATING_OPTIONS.map((opt) => {
                      const on = ratingFor(ratings, m.rateable!) === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          aria-pressed={on}
                          onClick={() => rate(m.rateable!, opt.value)}
                          className={`h-11 rounded-md border text-[13px] ${on ? 'border-herb text-herbLight' : 'border-edge text-muted'}`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                {!past && !st.choosing && m.id && !m.fixed && (
                  <button type="button" onClick={() => openSwap([m.id!])} className={`mt-3 w-full ${secondaryBtn}`}>
                    Swap
                  </button>
                )}
              </article>
            );
          })}
          {day.meals.length === 0 && <p className="text-[14px] text-muted">Nothing planned.</p>}
        </div>

        {ratingError && <p className="mt-6 text-[13px] text-[#D98C7A]">Could not save rating: {ratingError}</p>}

        {!past && (
          <Link to={`/plan?week=${weekOf}`} className={`mt-10 w-full ${secondaryBtn}`}>
            {planLabel(weekOf, current, true)}
          </Link>
        )}
      </div>

      {/* Desktop layout: the whole week as a grid. */}
      <div className="hidden lg:block">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between xl:gap-10">
          <div className="min-w-0">
            {switcher}
            <div className="lg:flex lg:items-baseline lg:gap-4">
              <h1 className="mt-4 font-display text-[44px] font-semibold leading-[1.05] tracking-[-0.02em] text-paper">
                {day.dayLabel},
                <br />
                {day.headline}
              </h1>
              <div className="mt-3 lg:mt-0 lg:translate-y-[-6px]">
                <SaveStatus />
              </div>
            </div>
          </div>
          <div className="flex items-end gap-4 xl:shrink-0">
            <BudgetBlock week={week} pct={pct} className="min-w-0 flex-1 xl:w-[300px] xl:flex-none" />
            {chooseButton(`${RING} flex h-11 shrink-0 items-center gap-2 rounded-lg border border-edge px-4 text-[14px] text-paper hover:border-muted`)}
            {!past && (
              <Link
                to={`/plan?week=${weekOf}`}
                className={`${RING} flex h-11 shrink-0 items-center gap-2 rounded-lg border border-edge px-4 text-[14px] text-paper hover:border-muted`}
              >
                <RefreshIcon />
                {planLabel(weekOf, current, true)}
              </Link>
            )}
          </div>
        </div>

        {errors.length > 0 && (
          <div className="mt-6 rounded-lg border border-edge px-4 py-3">
            <p className="text-[14px] text-paper">Plan has unresolved issues</p>
            <ul className="mt-2 space-y-1.5 text-[13px] text-muted">
              {errors.map((i) => (
                <li key={i.message}>{i.message}</li>
              ))}
            </ul>
          </div>
        )}
        {notes.map((i) => (
          <p key={i.message} className="mt-6 text-[13px] text-muted">
            {i.message}
          </p>
        ))}
        {swapErrorLine}

        <div className="mt-8 min-w-0">
          <div className="min-w-0">
            <div className="grid grid-cols-[96px_repeat(7,minmax(0,1fr))] gap-2">
              <span aria-hidden="true" />
              {week.days.map((d, i) => {
                const active = d.key === selectedDay;
                const isToday = isoPlus(week.weekOf, i) === todayIso;
                const hasPrep = plan?.prep ? stepsOnDay(plan.prep, d.key).length > 0 : false;
                return (
                  <div key={d.key} className="flex min-w-0 flex-col items-stretch gap-1">
                  <button
                    type="button"
                    aria-pressed={active}
                    aria-current={isToday ? 'date' : undefined}
                    onClick={() => setPicked(d.key)}
                    className={`${RING} flex h-16 flex-col items-center justify-center rounded-lg text-[12px] ${
                      isToday
                        ? 'bg-paper text-ink'
                        : active
                          ? 'border border-herb text-herbLight'
                          : 'border border-line text-muted hover:text-paper'
                    }`}
                  >
                    <span className="uppercase tracking-[0.1em]">{DAY_SHORT[d.key]}</span>
                    <span className="text-[20px] font-semibold leading-none tabular-nums">{d.dateNum}</span>
                  </button>
                  {hasPrep && (
                    <button
                      type="button"
                      onClick={() => scrollToPrep(d.key)}
                      className={`${RING} flex min-h-6 items-center justify-center gap-1.5 rounded text-[11px] text-herbLight hover:text-paper`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-herb" aria-hidden="true" />
                      Prep
                    </button>
                  )}
                  </div>
                );
              })}

              {SLOTS.map((slot) => (
                <Fragment key={slot}>
                  <span className="pt-4 text-[12px] text-muted">{SLOT_LABEL[slot]}</span>
                  {week.days.map((d) => {
                    const meals = d.meals.filter((m) => m.slot === slot);
                    if (meals.length === 0) {
                      return (
                        <div
                          key={`${d.key}-${slot}`}
                          className="flex min-h-[112px] items-center justify-center rounded-lg border border-dashed border-edge text-[14px] text-faint"
                        >
                          <span aria-hidden="true">&mdash;</span>
                          <span className="sr-only">Nothing planned</span>
                        </div>
                      );
                    }
                    return (
                      <div key={`${d.key}-${slot}`} className="flex min-w-0 flex-col gap-2">
                        {meals.map((m) => (
                          <MealCell
                            key={m.name}
                            meal={m}
                            state={cardState(m)}
                            onOpen={() => {
                              if (choosing) {
                                if (m.id && !m.fixed) toggleMeal(m.id);
                              } else {
                                setOpenMeal({ day: d.key, meal: m });
                              }
                            }}
                          />
                        ))}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>

          {hasDeskSide && (
            <div className="mt-8 min-w-0 space-y-6">
              {plan && deskPrep && <PrepBoard plan={plan} prep={deskPrep} ticked={checks.prep} onToggle={(id) => toggle('prep', id)} />}
              {deskWarning}
            </div>
          )}
        </div>

        {openMeal && (
          <MealDetail
            day={openMeal.day}
            meal={openMeal.meal}
            planned={plannedFor(plan, openMeal.day, openMeal.meal)}
            onOpenMeal={openMealById}
            rating={openMeal.meal.rateable ? ratingFor(ratings, openMeal.meal.rateable) : null}
            ratingError={ratingError}
            onRate={(value) => {
              if (openMeal.meal.rateable) void rate(openMeal.meal.rateable, value);
            }}
            onClose={closeMeal}
            onSwap={!past && openMeal.meal.id && !openMeal.meal.fixed ? () => openSwap([openMeal.meal.id!]) : undefined}
          />
        )}
      </div>

      {choosing && (
        <>
          <div className="h-24" aria-hidden="true" />
          <SwapBar
            selected={selected.length}
            linked={linkedIds.length}
            onSwap={() => openSwap(selected)}
            onCancel={exitChoosing}
          />
        </>
      )}

      {preview && (
        <SwapDialog
          preview={preview}
          note={swapNote}
          onNote={setSwapNote}
          onCancel={() => setDialog(null)}
          onConfirm={() => void runSwap(dialog!, swapNote)}
        />
      )}

      {undo && (
        <UndoToast
          key={undo.key}
          message={swappedMessage(undo.count)}
          busy={undoBusy}
          onUndo={() => void runUndo()}
          onDismiss={() => setUndo(null)}
        />
      )}
    </Page>
  );
}

function BudgetBlock({ week, pct, className = '' }: { week: ViewWeek; pct: number; className?: string }) {
  const n = week.stores.length;
  return (
    <div className={`border-y border-line py-4 ${className}`}>
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="whitespace-nowrap text-[26px] font-semibold tabular-nums text-paper">${week.spent.toFixed(2)}</span>
        <span className="whitespace-nowrap text-[14px] text-muted">of ${week.budget}</span>
      </div>
      <div className="mt-3 h-1 w-full rounded-full bg-line" aria-hidden="true">
        <div className="h-1 rounded-full bg-herb" style={{ width: `${pct}%` }} />
      </div>
      {n > 0 && (
        <div className="mt-3">
          <p className="text-[12px] text-muted">
            {n} {n === 1 ? 'store' : 'stores'}
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {week.stores.map((s) => (
              <li key={s} className="rounded-full border border-edge px-2.5 py-0.5 text-[12px] text-muted">
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A tag pill's text, cut only when it runs past 24 characters. The full text is in the title. */
function shortPill(text: string): string {
  return text.length > 24 ? `${text.slice(0, 23).trimEnd()}…` : text;
}

/** "From Mon dinner" for a leftover meal, with a return arrow. Plain "Leftovers" when its source is not in the plan. */
function LeftoverLine({ meal }: { meal: ViewMeal }) {
  if (!meal.leftover) return null;
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-herbLight">
      <ReturnIcon />
      {meal.leftover.from ? `From ${meal.leftover.from.label}` : 'Leftovers'}
    </span>
  );
}

/** "Makes Tue lunch, Wed lunch" for a meal whose leftovers are eaten later. */
function MakesLine({ meal, className }: { meal: ViewMeal; className: string }) {
  if (!meal.makes) return null;
  return <span className={className}>Makes {meal.makes.map((r) => r.label).join(', ')}</span>;
}

function MealCell({ meal, onOpen, state }: { meal: ViewMeal; onOpen: () => void; state: CardState }) {
  const linkedLabel = state.linked ? 'Linked' : null;
  const meta = [meal.who, meal.fixed ? 'Fixed' : meal.cost !== null ? `$${meal.cost.toFixed(2)}` : null]
    .filter(Boolean)
    .join(' · ');
  const tone = state.choosing
    ? state.chosen
      ? 'border-herb'
      : state.linked
        ? 'border-herb/40'
        : meal.fixed
          ? 'border-line2 bg-ink'
          : 'border-line2 bg-field'
    : meal.fixed
      ? 'border-line2 bg-ink'
      : meal.leftover
        ? 'border-edge bg-transparent'
        : 'border-line2 bg-field';
  return (
    <button
      type="button"
      onClick={onOpen}
      title={meal.name}
      disabled={state.choosing && !!meal.fixed}
      aria-pressed={state.selectable ? state.chosen : undefined}
      aria-busy={state.busy || undefined}
      className={`${RING} relative flex min-h-[112px] w-full min-w-0 flex-1 flex-col rounded-lg border p-3 text-left hover:border-edge disabled:cursor-not-allowed disabled:opacity-50 ${tone} ${
        state.flash ? 'ring-2 ring-herb/70' : ''
      } ${state.busy ? 'skeleton opacity-60' : ''}`}
    >
      {state.chosen && (
        <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-herb text-ink">
          <CheckIcon size={12} />
        </span>
      )}
      {meal.leftover && <LeftoverLine meal={meal} />}
      <span
        className={`line-clamp-3 break-normal text-[15px] font-medium leading-[1.25] [overflow-wrap:normal] hyphens-none ${
          meal.fixed ? 'text-muted' : meal.leftover ? 'text-paper/80' : 'text-paper'
        } ${meal.leftover ? 'mt-1.5' : ''}`}
      >
        {meal.name}
      </span>
      {(meta || linkedLabel) && (
        <span className="mt-auto pt-2 text-[12px] text-muted">
          {linkedLabel && <span className="text-herbLight">{linkedLabel}</span>}
          {linkedLabel && meta && ' · '}
          {meta}
        </span>
      )}
      {meal.makes && <MakesLine meal={meal} className="mt-1 block text-[12px] text-muted" />}
      {meal.tags.length > 0 && (
        <span className="mt-2 flex flex-wrap gap-1">
          {meal.tags.slice(0, 2).map((t) => (
            <span
              key={`${t.kind}-${t.text}`}
              title={t.text}
              className={`max-w-full rounded-full border px-2 py-0.5 text-[11px] ${TAG_TONE[t.kind]}`}
            >
              {shortPill(t.text)}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}
