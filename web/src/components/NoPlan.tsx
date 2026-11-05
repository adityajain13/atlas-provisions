import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getFlyerStatus } from '../api';
import { planLabel, weekOffset, weekPhrase } from '../lib/week';
import { primaryBtn } from './ui';

/**
 * Empty state for Week and List when the viewed week has no saved plan. A past week was never planned,
 * so it has no button. The flyer line changes when no flyer prices are on file, since a plan needs them.
 */
export function NoPlan({ weekOf, current }: { weekOf: string; current: string }) {
  const past = weekOffset(weekOf, current) < 0;
  const [noFlyers, setNoFlyers] = useState(false);

  useEffect(() => {
    if (past) return;
    let alive = true;
    getFlyerStatus()
      .then((s) => {
        if (alive) setNoFlyers(s.currentItems.reduce((n, r) => n + r.count, 0) === 0);
      })
      .catch(() => {
        // Unknown: keep the plain line.
      });
    return () => {
      alive = false;
    };
  }, [past]);

  if (past) {
    return (
      <section className="mt-10 border-t border-line pt-6">
        <h2 className="font-display text-[24px] font-semibold tracking-[-0.01em] text-paper">No plan was made for this week.</h2>
      </section>
    );
  }

  return (
    <section className="mt-10 border-t border-line pt-6">
      <h2 className="font-display text-[24px] font-semibold tracking-[-0.01em] text-paper">No plan for {weekPhrase(weekOf, current)} yet</h2>
      <p className="mt-2 text-[14px] text-muted">
        {noFlyers
          ? 'No flyer prices yet. Refresh flyers in Household, then plan the week.'
          : 'Plan the week to get meals and a shopping list.'}
      </p>
      <Link to={`/plan?week=${weekOf}`} className={`mt-6 ${primaryBtn}`}>
        {planLabel(weekOf, current, false)}
      </Link>
    </section>
  );
}
