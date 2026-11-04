import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getFlyerStatus } from '../api';
import { primaryBtn } from './ui';

/**
 * Empty state for Week and List when this week has no saved plan. The line changes when no flyer
 * prices are on file, since a plan needs them to price the week.
 */
export function NoPlan() {
  const [noFlyers, setNoFlyers] = useState(false);

  useEffect(() => {
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
  }, []);

  return (
    <section className="mt-10 border-t border-line pt-6">
      <h2 className="font-display text-[24px] font-semibold tracking-[-0.01em] text-paper">No plan for this week yet</h2>
      <p className="mt-2 text-[14px] text-muted">
        {noFlyers
          ? 'No flyer prices yet. Refresh flyers in Household, then plan the week.'
          : 'Plan the week to get meals and a shopping list.'}
      </p>
      <Link to="/plan" className={`mt-6 ${primaryBtn}`}>
        Plan this week
      </Link>
    </section>
  );
}
