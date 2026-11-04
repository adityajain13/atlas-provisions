import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  SLOTS,
  planWeekOf,
  torontoDate,
  type Day,
  type MealPlan,
  type PlannedMeal,
  type Rating,
  type RatingKind,
  type Slot,
} from '@provisions/shared';
import { errorMessage, getHousehold, getPlan, getRatings, regeneratePrep, saveRating } from '../api';
import { Header } from '../components/Header';
import { Page } from '../components/Page';
import { PrepArticle } from '../components/PrepArticle';
import MealDetail, { RATING_OPTIONS, TAG_TONE } from '../components/MealDetail';
import { RefreshIcon } from '../components/Icons';
import { SamplePill } from '../components/SamplePill';
import { secondaryBtn } from '../components/ui';
import { DAY_SHORT, SLOT_LABEL } from '../lib/labels';
import { defaultDay, planToWeek } from '../lib/planView';
import { MOCK_WEEK, type MockMeal, type MockWeek, type Rateable } from '../mocks/week';

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

type Source = { status: 'loading' } | { status: 'plan'; plan: MealPlan } | { status: 'sample'; error: string | null };

/** ISO date `n` days after `iso`. */
function isoPlus(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The saved plan's meal behind a drawn one, for its ingredients and steps. */
function plannedFor(plan: MealPlan | null, day: Day, meal: MockMeal): PlannedMeal | undefined {
  return plan?.meals.find((m) => m.day === day && m.slot === meal.slot && m.name === meal.name);
}

export default function Week() {
  // Null until the reader picks a day: then the default (today, or Sunday) applies.
  const [picked, setPicked] = useState<Day | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [source, setSource] = useState<Source>({ status: 'loading' });
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [prepDay, setPrepDay] = useState<Day | null>(null);
  const [prepBusy, setPrepBusy] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);
  // Desktop only: the meal open in the side panel.
  const [openMeal, setOpenMeal] = useState<{ day: Day; meal: MockMeal } | null>(null);
  const closeMeal = useCallback(() => setOpenMeal(null), []);

  useEffect(() => {
    let alive = true;
    const weekOf = planWeekOf(new Date());
    Promise.all([getPlan(weekOf), getHousehold().catch(() => null), getRatings().catch(() => [] as Rating[])])
      .then(([plan, household, saved]) => {
        if (!alive) return;
        setNames(new Map((household?.people ?? []).map((p) => [p.id, p.name])));
        setPrepDay(household?.prepDay ?? null);
        setRatings(saved);
        setSource(plan ? { status: 'plan', plan } : { status: 'sample', error: null });
      })
      .catch((e: unknown) => {
        if (alive) setSource({ status: 'sample', error: errorMessage(e) });
      });
    return () => {
      alive = false;
    };
  }, []);

  if (source.status === 'loading') {
    return (
      <Page>
        <Header title="Your week" />
        <p className="mt-10 text-[14px] text-muted">Loading&hellip;</p>
      </Page>
    );
  }

  const plan = source.status === 'plan' ? source.plan : null;
  const week = plan ? planToWeek(plan, names) : MOCK_WEEK;
  const todayIso = torontoDate();
  const selected = picked ?? defaultDay(week.weekOf, todayIso);
  const day = week.days.find((d) => d.key === selected) ?? week.days[0]!;
  const pct = week.budget > 0 ? Math.min(100, (week.spent / week.budget) * 100) : 0;
  const errors = plan?.issues.filter((i) => i.severity === 'error') ?? [];
  const prep = plan?.prep && plan.prep.day === selected ? plan.prep : null;
  const prepWarning =
    plan && !plan.prep && prepDay === selected ? (plan.issues.find((i) => i.check === 'prep')?.message ?? null) : null;

  // Rebuilds the prep list alone and shows the plan it returns.
  async function retryPrep() {
    if (!plan) return;
    setPrepBusy(true);
    setPrepError(null);
    try {
      setSource({ status: 'plan', plan: await regeneratePrep(plan.weekOf) });
    } catch (e) {
      setPrepError(errorMessage(e));
    } finally {
      setPrepBusy(false);
    }
  }

  // Records the rating for every household member eating the meal, then reloads the ratings.
  async function rate(meal: Rateable, value: RatingKind) {
    setRatingError(null);
    try {
      await Promise.all(
        meal.personIds.map((personId) =>
          saveRating({ mealName: meal.name, personId, rating: value, ingredientIds: meal.ingredientIds }),
        ),
      );
      setRatings(await getRatings());
    } catch (e) {
      setRatingError(errorMessage(e));
      setRatings(await getRatings().catch(() => ratings));
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

  return (
    <Page>
      {/* Phone layout. Unchanged below 1024px. */}
      <div className="lg:hidden">
        <Header
          size="lg"
          subtitle={
            <>
              Week of {week.label}
              {!plan && <SamplePill />}
            </>
          }
          action={
            <Link
              to="/plan"
              aria-label="Plan this week"
              title="Plan this week"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-edge text-muted"
            >
              <RefreshIcon />
            </Link>
          }
          title={
            <>
              {day.dayLabel},
              <br />
              {day.headline}
            </>
          }
        />

        {source.status === 'sample' && source.error && (
          <p className="mt-6 text-[13px] text-muted">Could not load this week's plan: {source.error}</p>
        )}

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

        <BudgetBlock week={week} pct={pct} className="mt-8" />

        <div className="mt-6 flex justify-between" role="group" aria-label="Day">
          {week.days.map((d) => {
            const active = d.key === selected;
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
          {plan && prep && <PrepArticle plan={plan} prep={prep} />}
          {mobileWarning}
          {day.meals.map((m) => (
            <article key={`${m.slot}-${m.name}`} className="border-t border-line pt-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-[0.14em] text-muted">
                  {SLOT_LABEL[m.slot]} &middot; {m.who}
                </span>
                <span className="text-[11px] uppercase tracking-[0.14em] text-muted">
                  {m.fixed ? 'Fixed' : m.cost !== null ? `$${m.cost.toFixed(2)}` : ''}
                </span>
              </div>
              <h3
                className={`mt-2 font-display font-medium text-paper ${
                  m.slot === 'dinner' ? 'text-[24px] leading-[1.2]' : 'text-[20px] leading-[1.25]'
                }`}
              >
                {m.name}
              </h3>
              <p className="mt-1 text-[13px] text-muted">{m.detail}</p>
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
            </article>
          ))}
          {day.meals.length === 0 && <p className="text-[14px] text-muted">Nothing planned.</p>}
        </div>

        {ratingError && <p className="mt-6 text-[13px] text-[#D98C7A]">Could not save rating: {ratingError}</p>}

        <Link to="/plan" className={`mt-10 w-full ${secondaryBtn}`}>
          Plan next week
        </Link>
      </div>

      {/* Desktop layout: the whole week as a grid. */}
      <div className="hidden lg:block">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between xl:gap-10">
          <div className="min-w-0">
            <p className="text-[13px] text-muted">
              Week of {week.label}
              {!plan && <SamplePill />}
            </p>
            <h1 className="mt-2 font-display text-[44px] font-semibold leading-[1.05] tracking-[-0.02em] text-paper">
              {day.dayLabel},
              <br />
              {day.headline}
            </h1>
          </div>
          <div className="flex items-end gap-4 xl:shrink-0">
            <BudgetBlock week={week} pct={pct} className="min-w-0 flex-1 xl:w-[300px] xl:flex-none" />
            <Link
              to="/plan"
              className={`${RING} flex h-11 shrink-0 items-center gap-2 rounded-lg border border-edge px-4 text-[14px] text-paper hover:border-muted`}
            >
              <RefreshIcon />
              Plan this week
            </Link>
          </div>
        </div>

        {source.status === 'sample' && source.error && (
          <p className="mt-6 text-[13px] text-muted">Could not load this week's plan: {source.error}</p>
        )}

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

        <div className={`mt-8 ${hasDeskSide ? '2xl:grid 2xl:grid-cols-[minmax(0,1fr)_320px] 2xl:items-start 2xl:gap-10' : ''}`}>
          <div className="min-w-0">
            <div className="grid grid-cols-[96px_repeat(7,minmax(0,1fr))] gap-2">
              <span aria-hidden="true" />
              {week.days.map((d, i) => {
                const active = d.key === selected;
                const isToday = isoPlus(week.weekOf, i) === todayIso;
                return (
                  <button
                    key={d.key}
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
                          <MealCell key={m.name} meal={m} onOpen={() => setOpenMeal({ day: d.key, meal: m })} />
                        ))}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>

          {hasDeskSide && (
            <aside className="mt-8 min-w-0 space-y-6 2xl:mt-0">
              {plan && deskPrep && (
                <PrepArticle plan={plan} prep={deskPrep} framed />
              )}
              {deskWarning}
            </aside>
          )}
        </div>

        {openMeal && (
          <MealDetail
            day={openMeal.day}
            meal={openMeal.meal}
            planned={plannedFor(plan, openMeal.day, openMeal.meal)}
            rating={openMeal.meal.rateable ? ratingFor(ratings, openMeal.meal.rateable) : null}
            ratingError={ratingError}
            onRate={(value) => {
              if (openMeal.meal.rateable) void rate(openMeal.meal.rateable, value);
            }}
            onClose={closeMeal}
          />
        )}
      </div>
    </Page>
  );
}

function BudgetBlock({ week, pct, className = '' }: { week: MockWeek; pct: number; className?: string }) {
  return (
    <div className={`border-y border-line py-4 ${className}`}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <span className="text-[26px] font-semibold tabular-nums text-paper">${week.spent.toFixed(2)}</span>
          <span className="ml-1.5 text-[14px] text-muted">of ${week.budget}</span>
        </div>
        <span className="text-right text-[13px] text-muted">{week.stores.join(' · ')}</span>
      </div>
      <div className="mt-3 h-1 w-full rounded-full bg-line" aria-hidden="true">
        <div className="h-1 rounded-full bg-herb" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function MealCell({ meal, onOpen }: { meal: MockMeal; onOpen: () => void }) {
  const meta = [meal.who, meal.fixed ? 'Fixed' : meal.cost !== null ? `$${meal.cost.toFixed(2)}` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${RING} flex min-h-[112px] w-full min-w-0 flex-col rounded-lg border p-3 text-left hover:border-edge ${
        meal.fixed ? 'border-line2 bg-ink' : 'border-line2 bg-field'
      }`}
    >
      <span
        className={`line-clamp-3 break-words text-[15px] font-medium leading-[1.25] ${meal.fixed ? 'text-muted' : 'text-paper'}`}
      >
        {meal.name}
      </span>
      {meta && <span className="mt-auto pt-2 text-[12px] text-muted">{meta}</span>}
      {meal.tags.length > 0 && (
        <span className="mt-2 flex flex-wrap gap-1">
          {meal.tags.slice(0, 2).map((t) => (
            <span
              key={`${t.kind}-${t.text}`}
              className={`max-w-full truncate rounded-full border px-2 py-0.5 text-[11px] ${TAG_TONE[t.kind]}`}
            >
              {t.text}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}
