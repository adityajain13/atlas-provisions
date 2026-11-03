import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { flyerWeekOf, type Day, type MealPlan } from '@provisions/shared';
import { errorMessage, getHousehold, getPlan } from '../api';
import { Header } from '../components/Header';
import { Page } from '../components/Page';
import { RefreshIcon } from '../components/Icons';
import { SamplePill } from '../components/SamplePill';
import { secondaryBtn } from '../components/ui';
import { DAY_SHORT, SLOT_LABEL } from '../lib/labels';
import { planToWeek } from '../lib/planView';
import { MOCK_WEEK, type MockTag } from '../mocks/week';

const TAG_TONE: Record<MockTag['kind'], string> = {
  craving: 'border-herb text-herbLight',
  deal: 'border-[#3A3631] text-[#C9C3B8]',
  leftover: 'border-edge text-muted',
};

type Source = { status: 'loading' } | { status: 'plan'; plan: MealPlan } | { status: 'sample'; error: string | null };

export default function Week() {
  const [selected, setSelected] = useState<Day>('thu');
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [source, setSource] = useState<Source>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    const weekOf = flyerWeekOf(new Date());
    Promise.all([getPlan(weekOf), getHousehold().catch(() => null)])
      .then(([plan, household]) => {
        if (!alive) return;
        setNames(new Map((household?.people ?? []).map((p) => [p.id, p.name])));
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
  const day = week.days.find((d) => d.key === selected) ?? week.days[0]!;
  const pct = week.budget > 0 ? Math.min(100, (week.spent / week.budget) * 100) : 0;
  const errors = plan?.issues.filter((i) => i.severity === 'error') ?? [];

  return (
    <Page>
      <Header
        size="lg"
        subtitle={
          <>
            Flyer week · {week.label}
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

      <div className="mt-8 border-y border-line py-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <span className="font-display text-[26px] text-paper">${week.spent.toFixed(2)}</span>
            <span className="ml-1.5 text-[14px] text-muted">of ${week.budget}</span>
          </div>
          <span className="text-right text-[13px] text-muted">{week.stores.join(' · ')}</span>
        </div>
        <div className="mt-3 h-1 w-full rounded-full bg-line" aria-hidden="true">
          <div className="h-1 rounded-full bg-herb" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="mt-6 flex justify-between" role="group" aria-label="Day">
        {week.days.map((d) => {
          const active = d.key === selected;
          return (
            <button
              key={d.key}
              type="button"
              aria-pressed={active}
              onClick={() => setSelected(d.key)}
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
              className={`mt-2 font-display font-normal text-paper ${
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
          </article>
        ))}
        {day.meals.length === 0 && <p className="text-[14px] text-muted">Nothing planned.</p>}
      </div>

      <Link to="/plan" className={`mt-10 w-full ${secondaryBtn}`}>
        Plan next week
      </Link>
    </Page>
  );
}
