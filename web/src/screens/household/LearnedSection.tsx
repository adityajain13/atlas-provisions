import { useEffect, useState } from 'react';
import { type FeedbackSummary } from '@provisions/shared';
import { errorMessage, forgetIngredientFeedback, getIngredientFeedback } from '../../api';
import { Section } from '../../components/Section';
import { linkBtn } from '../../components/ui';

import { ERROR_TEXT } from './ui';

// ---------- Learned from your meals ----------

/**
 * What the planner has learned from ingredients skipped or replaced in meals over the last 90 days. Forgetting an
 * ingredient drops every change for it.
 */
export function LearnedSection() {
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getIngredientFeedback()
      .then((d) => {
        if (alive) setSummary(d);
      })
      .catch((e: unknown) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  async function forget(ingredientId: string) {
    setError(null);
    setSummary((prev) => (prev ? { items: prev.items.filter((i) => i.ingredientId !== ingredientId) } : prev));
    try {
      await forgetIngredientFeedback(ingredientId);
    } catch (e) {
      setError(errorMessage(e));
      getIngredientFeedback().then(setSummary).catch(() => {});
    }
  }

  return (
    <Section title="Learned from your meals" caption="What you skipped or swapped in the last 90 days. Plans avoid it and use the swaps.">
      {error && <p className={`mb-3 text-[13px] ${ERROR_TEXT}`}>{error}</p>}
      {!summary && !error && <p className="text-[14px] text-muted">Loading&hellip;</p>}
      {summary && summary.items.length === 0 && (
        <p className="text-[14px] text-muted">Mark ingredients as skipped or replaced on a meal, and plans will adapt.</p>
      )}
      {summary && summary.items.length > 0 && (
        <ul>
          {summary.items.map((item) => (
            <li key={item.ingredientId} className="flex items-start justify-between gap-4 border-b border-line2 py-3">
              <div className="min-w-0 text-[15px] text-paper">
                <p>
                  {item.name}
                  {item.skipped > 0 && (
                    <span className="text-muted">
                      {' '}
                      &middot; skipped {item.skipped} {item.skipped === 1 ? 'time' : 'times'}
                    </span>
                  )}
                </p>
                {item.replacements.map((r) => (
                  <p key={r.text} className="text-[14px] text-muted">
                    {item.name} &rarr; {r.text} ({r.count} {r.count === 1 ? 'time' : 'times'})
                  </p>
                ))}
              </div>
              <button type="button" onClick={() => void forget(item.ingredientId)} className={linkBtn} aria-label={`Forget ${item.name}`}>
                Forget
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
