import { describe, expect, it } from 'vitest';
import { IngredientFeedbackInputSchema, feedbackSignals, feedbackSummary, OFTEN_SKIPPED_TIMES, type FeedbackRecord } from './feedback';

const TODAY = '2026-11-05';
const at = (daysAgo: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
};
const skip = (ingredientId: string, daysAgo = 1): FeedbackRecord => ({ ingredientId, kind: 'skipped', createdAt: at(daysAgo) });
const swap = (ingredientId: string, replacement: string, daysAgo = 1): FeedbackRecord => ({
  ingredientId,
  kind: 'replaced',
  replacement,
  createdAt: at(daysAgo),
});

describe('IngredientFeedbackInputSchema', () => {
  it('needs a replacement for a replaced ingredient, and drops one for a skipped ingredient', () => {
    expect(IngredientFeedbackInputSchema.safeParse({ kind: 'replaced' }).success).toBe(false);
    expect(IngredientFeedbackInputSchema.safeParse({ kind: 'replaced', replacement: '   ' }).success).toBe(false);
    expect(IngredientFeedbackInputSchema.parse({ kind: 'replaced', replacement: ' Greek yogurt ' })).toEqual({ kind: 'replaced', replacement: 'Greek yogurt' });
    expect(IngredientFeedbackInputSchema.parse({ kind: 'skipped', replacement: 'ignored' })).toEqual({ kind: 'skipped' });
  });
});

describe('feedbackSignals', () => {
  it('lists an ingredient the planner should avoid once it is skipped two times in the window', () => {
    expect(OFTEN_SKIPPED_TIMES).toBe(2);
    const once = feedbackSignals([skip('cilantro', 3)], TODAY);
    expect(once.oftenSkipped).toEqual([]);
    const twice = feedbackSignals([skip('cilantro', 3), skip('cilantro', 10)], TODAY);
    expect(twice.oftenSkipped).toEqual(['cilantro']);
  });

  it('forgets changes older than 90 days', () => {
    const old = feedbackSignals([skip('cilantro', 95), skip('cilantro', 100), swap('sour-cream', 'Greek yogurt', 120)], TODAY);
    expect(old).toEqual({ oftenSkipped: [], preferredSwaps: [] });
  });

  it('prefers a replacement used at least once, matching the text without case or extra spaces', () => {
    const out = feedbackSignals([swap('sour-cream', 'Greek yogurt'), swap('sour-cream', 'greek  yogurt', 4), swap('sour-cream', 'Parsley', 2)], TODAY);
    expect(out.preferredSwaps).toEqual([
      { from: 'sour-cream', to: 'Greek yogurt', toId: 'greek-yogurt' },
      { from: 'sour-cream', to: 'Parsley', toId: 'parsley' },
    ]);
  });

  it('leaves toId out when the replacement is not a catalogue ingredient', () => {
    const out = feedbackSignals([swap('sour-cream', 'the good stuff')], TODAY);
    expect(out.preferredSwaps).toEqual([{ from: 'sour-cream', to: 'the good stuff' }]);
  });
});

describe('feedbackSummary', () => {
  it('gives each ingredient its skips, its replacements by count, and the last date, most skipped first', () => {
    const out = feedbackSummary(
      [skip('cilantro', 2), skip('cilantro', 9), skip('cilantro', 20), swap('sour-cream', 'Greek yogurt', 1), swap('sour-cream', 'Greek yogurt', 3), swap('sour-cream', 'Parsley', 5)],
      TODAY,
    );
    expect(out.items.map((i) => i.ingredientId)).toEqual(['cilantro', 'sour-cream']);
    expect(out.items[0]).toMatchObject({ name: 'Cilantro', skipped: 3, replacements: [], lastDate: '2026-11-03' });
    expect(out.items[1]).toMatchObject({
      name: 'Sour cream',
      skipped: 0,
      replacements: [
        { text: 'Greek yogurt', count: 2 },
        { text: 'Parsley', count: 1 },
      ],
      lastDate: '2026-11-04',
    });
  });
});
