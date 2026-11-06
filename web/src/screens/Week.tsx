import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DAY_LONG,
  SLOTS,
  isMealUpcoming,
  leftoverDependents,
  torontoDate,
  type Day,
  type FixedMeal,
  type GuestsInput,
  type MealPlan,
  type MealStatus,
  type MealStatusInput,
  type PlannedMeal,
  type Rating,
  type RatingKind,
  type Slot,
  type SkipReason,
} from '@provisions/shared';
import {
  addPlanLeftovers,
  clearMealStatus,
  errorMessage,
  getHouseholdCached,
  getRatings,
  getRatingsCached,
  getWeekPlan,
  regeneratePrep,
  saveRating,
  setMealStatus,
  swapMeals,
  undoSwap,
} from '../api';
import { LeftoversDialog, PantryDialog } from '../components/StatusDialogs';
import NoticeToast from '../components/NoticeToast';
import { guestsLine, leftoversQuestion, markLabel, mergeStatus, mealLabel, nextDinnerAfter, pantryAddedMessage, pantryChoices, useUpNote, guestSwapNote, type PantryChoice } from '../lib/mealStatus';
import { Header } from '../components/Header';
import { Page } from '../components/Page';
import { PrepBoard, PrepToday } from '../components/PrepArticle';
import { prepAnchor, stepsOnDay } from '../lib/prepView';
import MealDetail, { RATING_OPTIONS, TAG_TONE } from '../components/MealDetail';
import { RefreshIcon, ReturnIcon } from '../components/Icons';
import { SaveStatus, useSaveScope, useSaveStatus } from '../components/SaveStatus';
import { NoPlan } from '../components/NoPlan';
import WeekSwitcher from '../components/WeekSwitcher';
import SwapDialog from '../components/SwapDialog';
import SwapBar from '../components/SwapBar';
import UndoToast from '../components/UndoToast';
import { SelectCircle } from '../components/SelectCircle';
import { SwapProgressDialog } from '../components/SwapProgressDialog';
import { planLabel, useViewedWeek, viewWindow, weekOffset } from '../lib/week';
import { secondaryBtn } from '../components/ui';
import { DAY_SHORT, SLOT_LABEL } from '../lib/labels';
import { defaultDay, planToWeek, type Rateable, type ViewMeal, type ViewWeek } from '../lib/planView';
import { swappedMessage, swapPreview } from '../lib/swap';
import { WAITING_TEXT, progressText, timingLine } from '../lib/planProgress';
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

/** "Swapping 3 meals", the title of the progress modal. */
const swappingTitle = (count: number) => `Swapping ${count} ${count === 1 ? 'meal' : 'meals'}`;

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
  // Phone only: the meal open as a full-screen sheet.
  const [sheetMeal, setSheetMeal] = useState<{ day: Day; meal: ViewMeal } | null>(null);
  const closeSheet = useCallback(() => setSheetMeal(null), []);
  // The household's fixed meals, for the ingredients a fixed meal's detail lists.
  const [fixedMeals, setFixedMeals] = useState<FixedMeal[]>([]);
  // Meal swapping: choose mode, the meals picked, the meal ids the confirm dialog is for, and the note.
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<string[] | null>(null);
  const [swapNote, setSwapNote] = useState('');
  // The meals being replaced while the planner works, and the ones a swap just put in place.
  const [swapping, setSwapping] = useState<string[]>([]);
  // What the planner is doing for the swap in progress, as a line of text.
  const [swapProgress, setSwapProgress] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ key: number; count: number } | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  // The progress modal for a swap or a prep rewrite: its title, the meals replaced, and the error once it fails.
  const [progressModal, setProgressModal] = useState<{ title: string; meals: string[]; error: string | null } | null>(null);
  // "Didn't go to plan?": the marks on the week's meals, by meal id; a failed write; and the write in progress.
  const [statuses, setStatuses] = useState<Record<string, MealStatus>>({});
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  // The follow-up dialogs after a meal is skipped or made instead: the meals its leftovers were for, the ingredient
  // checklist for the meal itself, a swap to open once those are done, and the line shown after the pantry is filled.
  const [leftovers, setLeftovers] = useState<{ sourceId: string; deps: string[]; reason?: SkipReason } | null>(null);
  const [pantryFor, setPantryFor] = useState<{
    sourceId: string;
    choices: PantryChoice[];
    then: { ids: string[]; note: string } | null;
    busy: boolean;
    error: string | null;
  } | null>(null);
  const [pantryToast, setPantryToast] = useState<{ key: number; count: number; names: string[]; next?: string } | null>(null);
  useSaveScope('sync', source.status === 'plan');
  // One set of ticks for both prep checklists (phone and desktop), so they never disagree.
  const { checks, toggle } = useChecks(source.status === 'plan' ? source.plan.weekOf : null);

  useEffect(() => {
    let alive = true;
    // The household and ratings come from the cache: switching weeks loads only the week's plan.
    Promise.all([getWeekPlan(weekOf), getHouseholdCached().catch(() => null), getRatingsCached().catch(() => [] as Rating[])])
      .then(([found, household, saved]) => {
        if (!alive) return;
        setNames(new Map((household?.people ?? []).map((p) => [p.id, p.name])));
        setPrepDay(household?.prepDay ?? null);
        setFixedMeals(household?.fixedMeals ?? []);
        setRatings(saved);
        setStatuses(found?.statuses ?? {});
        setSource(found ? { status: 'plan', plan: found.plan } : { status: 'none' });
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
  const week = planToWeek(plan, names, statuses);
  // Leftover links point at other planned meals. Opening one swaps the open meal (panel or sheet) to it.
  const findMeal = (id: string): { day: Day; meal: ViewMeal } | null => {
    for (const d of week.days) {
      const meal = d.meals.find((m) => m.id === id);
      if (meal) return { day: d.key, meal };
    }
    return null;
  };
  const openMealById = (id: string) => {
    const found = findMeal(id);
    if (found) setOpenMeal(found);
  };
  const openSheetById = (id: string) => {
    const found = findMeal(id);
    if (found) setSheetMeal(found);
  };
  // The ingredients of the household's fixed meal behind a fixed meal on the week, as typed on Household.
  const fixedIngredientsFor = (day: Day, meal: ViewMeal) =>
    fixedMeals.find((f) => f.active && f.name === meal.name && f.slot === meal.slot && f.days.includes(day))?.ingredients;
  // What the meal panel (desktop) or the sheet (phone) shows for one open meal. The meal is read from the week as it
  // is now, so a mark set in the panel shows there at once.
  const detailFor = (
    opened: { day: Day; meal: ViewMeal },
    onClose: () => void,
    onOpen: (id: string) => void,
    presentation: 'panel' | 'sheet',
  ) => {
    const open = (opened.meal.id && findMeal(opened.meal.id)) || opened;
    const planned = !open.meal.fixed && open.meal.id !== undefined;
    return {
      weekOf: plan.weekOf,
      day: open.day,
      meal: open.meal,
      planned: plannedFor(plan, open.day, open.meal),
      fixedIngredients: fixedIngredientsFor(open.day, open.meal),
      onOpenMeal: onOpen,
      rating: open.meal.rateable ? ratingFor(ratings, open.meal.rateable) : null,
      ratingError,
      onRate: (value: RatingKind) => {
        if (open.meal.rateable) void rate(open.meal.rateable, value);
      },
      onClose,
      onSwap: !past && open.meal.id && !open.meal.fixed ? () => openSwap([open.meal.id!]) : undefined,
      presentation,
      status: open.meal.status,
      statusBusy,
      statusError,
      onMark: planned ? (patch: MealStatusInput) => void markMeal(open.meal, patch) : undefined,
      onClearStatus: planned && open.meal.status ? () => void clearMark(open.meal.id!) : undefined,
      canSwapForGuests: planned && !past && isMealUpcoming(plan.weekOf, open.day, open.meal.slot, new Date()),
      onSwapForGuests: planned ? (guests: GuestsInput, note: string) => void swapForGuests(open.meal.id!, guests, note) : undefined,
    };
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
  const openSwap = (ids: string[], note = '') => {
    setSwapNote(note);
    setSwapError(null);
    setDialog(ids);
  };

  // Rebuilds the prep list alone and shows the plan it returns.
  async function retryPrep() {
    if (!plan) return;
    setPrepBusy(true);
    setPrepError(null);
    setProgressModal({ title: 'Rewriting the prep list', meals: [], error: null });
    const weekOf = plan.weekOf;
    try {
      setSource({ status: 'plan', plan: await track(regeneratePrep(weekOf), () => regeneratePrep(weekOf)) });
      setProgressModal(null);
    } catch (e) {
      setPrepError(errorMessage(e));
      setProgressModal({ title: 'Rewriting the prep list', meals: [], error: errorMessage(e) });
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
  async function runSwap(ids: string[], note: string, guests?: GuestsInput) {
    const replaced = swapPreview(plan, ids).closure;
    const replacedNames = plan.meals.filter((m) => m.id !== undefined && replaced.includes(m.id)).map((m) => m.name);
    setDialog(null);
    // The meal panel would cover the progress, so it closes as the swap starts.
    closeMeal();
    setSheetMeal(null);
    setSwapError(null);
    setSwapping(replaced);
    setProgressModal({ title: swappingTitle(replaced.length), meals: replacedNames, error: null });
    try {
      const run = () => swapMeals(plan.weekOf, ids, note, (e) => setSwapProgress(progressText(e)), guests);
      const result = await track(run(), undefined, { busy: 'Planning…' });
      // The reload makes the List and prep screens show the new plan as well, and the marks the swap left.
      await reloadWeek(result);
      exitChoosing();
      setProgressModal(null);
      setHighlight(result.added);
      setUndo((u) => ({ key: (u?.key ?? 0) + 1, count: result.swapped.length }));
    } catch (e) {
      setSwapError(errorMessage(e));
      setProgressModal((m) => ({ title: m?.title ?? 'Swapping meals', meals: m?.meals ?? [], error: errorMessage(e) }));
    } finally {
      setSwapProgress(null);
      setSwapping([]);
    }
  }

  // The week and its marks from the server. The plan given is kept when the reload fails.
  async function reloadWeek(fallback: MealPlan) {
    const found = await getWeekPlan(plan.weekOf).catch(() => null);
    if (found) {
      setSource({ status: 'plan', plan: found.plan });
      setStatuses(found.statuses);
    } else {
      setSource({ status: 'plan', plan: fallback });
    }
  }

  // Records a mark on a planned meal. A skip or a made-instead then asks about the meals its leftovers were for, and
  // about the ingredients it did not use.
  async function markMeal(meal: ViewMeal, patch: MealStatusInput) {
    if (!meal.id) return;
    const id = meal.id;
    setStatusBusy(true);
    setStatusError(null);
    try {
      const saved = await track(setMealStatus(plan.weekOf, id, mergeStatus(statuses[id], patch)));
      setStatuses((prev) => ({ ...prev, [id]: saved }));
      if (patch.status === 'skipped' || patch.madeName !== undefined) {
        afterMiss(id, patch.status === 'skipped' ? patch.reason : undefined);
      }
    } catch (e) {
      setStatusError(errorMessage(e));
    } finally {
      setStatusBusy(false);
    }
  }

  // Clears a meal's mark: it went to plan after all.
  async function clearMark(mealId: string) {
    setStatusBusy(true);
    setStatusError(null);
    try {
      await track(clearMealStatus(plan.weekOf, mealId));
      setStatuses((prev) => {
        const next = { ...prev };
        delete next[mealId];
        return next;
      });
    } catch (e) {
      setStatusError(errorMessage(e));
    } finally {
      setStatusBusy(false);
    }
  }

  // Marks several meals at once with a patch each. A failure is shown; what was saved stays.
  async function markAll(ids: string[], patchFor: (id: string) => MealStatusInput) {
    if (ids.length === 0) return;
    setStatusBusy(true);
    setStatusError(null);
    try {
      const saved = await track(
        Promise.all(ids.map(async (id) => [id, await setMealStatus(plan.weekOf, id, mergeStatus(statuses[id], patchFor(id)))] as const)),
      );
      setStatuses((prev) => ({ ...prev, ...Object.fromEntries(saved) }));
    } catch (e) {
      setStatusError(errorMessage(e));
    } finally {
      setStatusBusy(false);
    }
  }

  // A skip or a made-instead: the meals its leftovers were for are asked about first, then the ingredients.
  function afterMiss(sourceId: string, reason?: SkipReason) {
    const deps = leftoverDependents(plan.meals, sourceId);
    if (deps.length > 0) setLeftovers({ sourceId, deps, ...(reason ? { reason } : {}) });
    else openPantry(sourceId, null);
  }

  // The leftovers prompt: skip the meals it was to feed, keep them as planned, or swap them. Then the ingredients.
  async function answerLeftovers(choice: 'skip' | 'keep' | 'swap') {
    const current = leftovers;
    if (!current) return;
    setLeftovers(null);
    if (choice === 'swap') {
      openPantry(current.sourceId, { ids: current.deps, note: '' });
      return;
    }
    if (choice === 'skip') {
      await markAll(current.deps, () => ({ status: 'skipped', ...(current.reason ? { reason: current.reason } : {}) }));
    } else {
      // Kept as planned: a meal already marked keeps its mark. The mark only says the question was answered.
      await markAll(current.deps.filter((id) => !statuses[id]), () => ({ status: 'replaced' }));
    }
    openPantry(current.sourceId, null);
  }

  // Closing the leftovers prompt without an answer changes nothing, and goes on to the ingredients.
  function dismissLeftovers() {
    const current = leftovers;
    setLeftovers(null);
    if (current) openPantry(current.sourceId, null);
  }

  // The ingredient checklist for a meal that did not use them. A meal with none goes straight on.
  function openPantry(sourceId: string, then: { ids: string[]; note: string } | null) {
    const meal = plan.meals.find((m) => m.id === sourceId);
    if (!meal || meal.ingredients.length === 0) {
      finishDialogs(then);
      return;
    }
    setPantryFor({ sourceId, choices: pantryChoices(meal), then, busy: false, error: null });
  }

  // What comes after the dialogs: a swap the leftovers prompt asked for.
  function finishDialogs(then: { ids: string[]; note: string } | null) {
    if (then) openSwap(then.ids, then.note);
  }

  // Puts the ticked ingredients in the pantry. A line then says so, and offers a swap for a dinner later in the week.
  async function addToPantry() {
    const current = pantryFor;
    if (!current) return;
    const ticked = current.choices.filter((c) => c.ticked);
    setPantryFor({ ...current, busy: true, error: null });
    try {
      const added = await track(addPlanLeftovers(plan.weekOf, current.sourceId, ticked.map((c) => ({ ingredientId: c.ingredientId, qty: c.qty }))));
      const source = plan.meals.find((m) => m.id === current.sourceId);
      const next = !past && source ? nextDinnerAfter(plan, source, statuses, new Date()) : undefined;
      setPantryFor(null);
      setPantryToast({ key: Date.now(), count: added.length, names: ticked.map((c) => c.name), ...(next ? { next: next.id } : {}) });
      finishDialogs(current.then);
    } catch (e) {
      setPantryFor((p) => (p ? { ...p, busy: false, error: errorMessage(e) } : p));
    }
  }

  // Closing the checklist without adding goes on to what follows it.
  function closePantry() {
    const current = pantryFor;
    setPantryFor(null);
    finishDialogs(current?.then ?? null);
  }

  // The line after the pantry is filled: a swap for the next dinner, to use up what went in.
  function useUpLater() {
    const toast = pantryToast;
    if (!toast?.next) return;
    setPantryToast(null);
    openSwap([toast.next], useUpNote(toast.names));
  }

  // A swap for a meal that works: the meal (and the meals its leftovers link to) is replaced, with the guests in its slots.
  async function swapForGuests(mealId: string, guests: GuestsInput, note: string) {
    await runSwap([mealId], guestSwapNote(guests, note), guests);
  }

  // Puts back the plan the last swap replaced.
  async function runUndo() {
    setUndoBusy(true);
    setSwapError(null);
    try {
      const restored = await track(undoSwap(plan.weekOf));
      await reloadWeek(restored);
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
  const timing = timingLine(plan?.timings);
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

        <BudgetBlock week={week} pct={pct} timing={timing} className="mt-8" />

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
            // The meal's name, meta and tags. On a phone it opens the meal as a full-screen sheet (not while choosing).
            const header = (
              <span className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-[0.14em] text-muted">
                  {SLOT_LABEL[m.slot]} &middot; {m.who}
                </span>
                <span className={`flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted ${st.selectable ? 'pr-7' : ''}`}>
                  {st.linked && <span className="text-herbLight">Linked</span>}
                  {!st.choosing && (m.fixed ? 'Fixed' : m.cost !== null ? `$${m.cost.toFixed(2)}` : '')}
                </span>
              </span>
            );
            const main = (
              <>
                {header}
                {m.leftover && (
                  <span className="mt-2 block">
                    <LeftoverLine meal={m} />
                  </span>
                )}
                <MarkLine meal={m} />
                <span
                  role="heading"
                  aria-level={3}
                  className={`mt-2 block font-display font-medium ${nameTone(m)} ${
                    m.slot === 'dinner' ? 'text-[24px] leading-[1.2]' : 'text-[20px] leading-[1.25]'
                  }`}
                >
                  {m.name}
                </span>
                <span className="mt-1 block text-[13px] text-muted">{m.detail}</span>
                <GuestLine meal={m} className="mt-1 block text-[12px] text-muted" />
                {m.makes && <MakesLine meal={m} className="mt-1 block text-[12px] text-muted" />}
                {m.tags.length > 0 && (
                  <span className="mt-3 flex flex-wrap gap-2">
                    {m.tags.map((t) => (
                      <span key={`${t.kind}-${t.text}`} className={`rounded-full border px-2.5 py-1 text-[12px] ${TAG_TONE[t.kind]}`}>
                        {t.text}
                      </span>
                    ))}
                  </span>
                )}
              </>
            );
            const opener = st.choosing ? (
              <div className="block">{main}</div>
            ) : (
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setSheetMeal({ day: day.key, meal: m })}
                className={`${RING} block w-full rounded-lg text-left`}
              >
                {main}
              </button>
            );
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
                    onClick={() => toggleMeal(m.id!)}
                    className={`${RING} absolute inset-0 z-10 rounded-lg`}
                  >
                    <span className="absolute right-4 top-4">
                      <SelectCircle chosen={st.chosen} />
                    </span>
                    <span className="sr-only">
                      {m.name}, {st.chosen ? 'Selected' : 'Select'}
                    </span>
                  </button>
                )}
                {opener}
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

        {sheetMeal && <MealDetail {...detailFor(sheetMeal, closeSheet, openSheetById, 'sheet')} />}
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
            <BudgetBlock week={week} pct={pct} timing={timing} className="min-w-0 flex-1 xl:w-[300px] xl:flex-none" />
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

        {openMeal && <MealDetail {...detailFor(openMeal, closeMeal, openMealById, 'panel')} />}
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

      {progressModal && (
        <SwapProgressDialog
          title={progressModal.title}
          progress={swapProgress ?? WAITING_TEXT}
          meals={progressModal.meals}
          error={progressModal.error}
          onClose={() => setProgressModal(null)}
        />
      )}

      {leftovers && (
        <LeftoversDialog
          question={leftoversQuestion(
            leftovers.deps
              .map((id) => plan.meals.find((m) => m.id === id))
              .filter((m): m is PlannedMeal => m !== undefined)
              .map(mealLabel),
          )}
          canSwap={!past}
          busy={statusBusy}
          onSkip={() => void answerLeftovers('skip')}
          onSwap={() => void answerLeftovers('swap')}
          onKeep={() => void answerLeftovers('keep')}
          onCancel={dismissLeftovers}
        />
      )}

      {pantryFor && (
        <PantryDialog
          choices={pantryFor.choices}
          busy={pantryFor.busy}
          error={pantryFor.error}
          onToggle={(id) =>
            setPantryFor((p) => (p ? { ...p, choices: p.choices.map((c) => (c.ingredientId === id ? { ...c, ticked: !c.ticked } : c)) } : p))
          }
          onAdd={() => void addToPantry()}
          onCancel={() => {
            if (!pantryFor.busy) closePantry();
          }}
        />
      )}

      {pantryToast && !undo && (
        <NoticeToast
          key={pantryToast.key}
          message={pantryAddedMessage(pantryToast.count)}
          actionLabel={pantryToast.next ? 'Use them in a later meal' : undefined}
          onAction={useUpLater}
          onDismiss={() => setPantryToast(null)}
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

function BudgetBlock({ week, pct, timing, className = '' }: { week: ViewWeek; pct: number; timing: string | null; className?: string }) {
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
      {timing && <p className="mt-3 text-[12px] text-muted">{timing}</p>}
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

/**
 * "From Mon dinner" for a leftover meal, with a return arrow. Plain "Leftovers" when its source is not in the plan. A
 * source that was skipped reads "(skipped)" in a quiet red, until this meal has been dealt with.
 */
function LeftoverLine({ meal }: { meal: ViewMeal }) {
  if (!meal.leftover) return null;
  const from = meal.leftover.from;
  return (
    <span className={`flex items-center gap-1.5 text-[12px] ${from?.skipped ? 'text-[#D98C7A]' : 'text-herbLight'}`}>
      <ReturnIcon />
      {from ? `From ${from.label}${from.skipped ? ' (skipped)' : ''}` : 'Leftovers'}
    </span>
  );
}

/** The name's tone: struck through for a skipped meal, muted for one made instead, and as before otherwise. */
function nameTone(meal: ViewMeal): string {
  if (meal.status?.status === 'skipped') return 'text-muted line-through';
  if (meal.status?.madeName) return 'text-muted';
  if (meal.fixed) return 'text-muted';
  return meal.leftover ? 'text-paper/80' : 'text-paper';
}

/** "Skipped · Ate out", or "Made: Pasta instead", above a meal's name. Nothing for a meal with no such mark. */
function MarkLine({ meal, className = '' }: { meal: ViewMeal; className?: string }) {
  const label = markLabel(meal.status);
  if (!label) return null;
  const tone = meal.status?.status === 'skipped' ? 'text-muted' : 'text-herbLight';
  return <span className={`block text-[12px] ${tone} ${className}`}>{label}</span>;
}

/** "+1 guest · tree nut", for a meal someone joins. */
function GuestLine({ meal, className = '' }: { meal: ViewMeal; className?: string }) {
  const line = guestsLine(meal.status);
  if (!line) return null;
  return <span className={`${className}`}>{line}</span>;
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
    : meal.status?.status === 'skipped'
      ? 'border-line2 bg-transparent opacity-70'
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
      className={`${RING} relative flex min-h-[112px] w-full min-w-0 flex-1 flex-col rounded-lg border p-3 text-left hover:border-edge disabled:cursor-not-allowed disabled:opacity-50 ${state.selectable ? 'pr-9' : ''} ${tone} ${
        state.flash ? 'ring-2 ring-herb/70' : ''
      } ${state.busy ? 'skeleton opacity-60' : ''}`}
    >
      {state.selectable && (
        <>
          <span className="absolute right-3 top-3">
            <SelectCircle chosen={state.chosen} />
          </span>
          <span className="sr-only">{state.chosen ? 'Selected' : 'Select'}</span>
        </>
      )}
      {meal.leftover && <LeftoverLine meal={meal} />}
      <MarkLine meal={meal} className="mt-1.5" />
      <span
        className={`line-clamp-3 break-normal text-[15px] font-medium leading-[1.25] [overflow-wrap:normal] hyphens-none ${nameTone(meal)} ${
          meal.leftover && !meal.status ? 'mt-1.5' : ''
        }`}
      >
        {meal.name}
      </span>
      <GuestLine meal={meal} className="mt-1 block text-[12px] text-muted" />
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
