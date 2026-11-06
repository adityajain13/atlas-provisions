// What the household changes in a planned meal: an ingredient skipped, or replaced with something else. Recorded on a
// saved meal (any week), kept per household, and read two ways: the planner learns from it, and the Household screen
// lists what it has learned. Counts use the last FEEDBACK_WINDOW_DAYS only, so old habits fade.
import { z } from 'zod';
import { INGREDIENT_BY_ID } from './catalog';
import { matchIngredient } from './match';
import { addDaysIso } from './plan';

export const FEEDBACK_KINDS = ['skipped', 'replaced'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_WINDOW_DAYS = 90;
/** An ingredient skipped this many times in the window is one the planner avoids. */
export const OFTEN_SKIPPED_TIMES = 2;
const SWAP_LIMIT = 20;
const SUMMARY_LIMIT = 100;

/** Body for PUT .../feedback. A replacement is required for 'replaced' and not kept for 'skipped'. */
export const IngredientFeedbackInputSchema = z
  .object({
    kind: z.enum(FEEDBACK_KINDS),
    replacement: z.string().trim().min(1, 'Say what it was replaced with').max(60).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.kind === 'replaced' && body.replacement === undefined) {
      ctx.addIssue({ code: 'custom', path: ['replacement'], message: 'Say what it was replaced with' });
    }
  })
  .transform((body) => (body.kind === 'skipped' ? { kind: body.kind } : body));
export type IngredientFeedbackInput = z.infer<typeof IngredientFeedbackInputSchema>;

/** One recorded change, as the worker reads it. createdAt is an ISO time. */
export interface FeedbackRecord {
  ingredientId: string;
  kind: FeedbackKind;
  replacement?: string;
  createdAt: string;
}

/** What the planner is told: ingredients to avoid, and ingredients to swap for something the household uses. */
export interface FeedbackSignals {
  oftenSkipped: string[]; // catalogue ids
  preferredSwaps: { from: string; to: string; toId?: string }[]; // from: catalogue id; to: the replacement as typed
}

/** One week's changes: meal id, then ingredient id, to what was changed. */
export type WeekFeedback = Record<string, Record<string, { kind: FeedbackKind; replacement?: string }>>;

/** The Household screen's view: per ingredient, how often it was skipped and what it was replaced with. */
export interface FeedbackSummary {
  items: {
    ingredientId: string;
    name: string;
    skipped: number;
    replacements: { text: string; count: number }[];
    lastDate: string;
  }[];
}

/** The recent records only: those created on or after `today` less the window. */
function inWindow(records: FeedbackRecord[], today: string): FeedbackRecord[] {
  const cutoff = addDaysIso(today, -FEEDBACK_WINDOW_DAYS);
  return records.filter((r) => r.createdAt.slice(0, 10) >= cutoff);
}

/** A replacement typed as text, compared without case or extra spaces. */
const keyOf = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The planner's signals from the household's changes. oftenSkipped: skipped OFTEN_SKIPPED_TIMES or more times in the
 * window. preferredSwaps: each (ingredient, replacement) pair used at least once in the window, most used first. A
 * replacement that names a catalogue ingredient also carries its id as toId.
 */
export function feedbackSignals(records: FeedbackRecord[], today: string): FeedbackSignals {
  const recent = inWindow(records, today);
  const skipped = new Map<string, number>();
  const swaps = new Map<string, { from: string; to: string; count: number }>();
  for (const r of recent) {
    if (r.kind === 'skipped') {
      skipped.set(r.ingredientId, (skipped.get(r.ingredientId) ?? 0) + 1);
    } else if (r.replacement) {
      const key = `${r.ingredientId}|${keyOf(r.replacement)}`;
      const prev = swaps.get(key);
      if (prev) prev.count += 1;
      else swaps.set(key, { from: r.ingredientId, to: r.replacement.trim(), count: 1 });
    }
  }
  const oftenSkipped = [...skipped].filter(([, n]) => n >= OFTEN_SKIPPED_TIMES).map(([id]) => id).sort();
  const preferredSwaps = [...swaps.values()]
    .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from))
    .slice(0, SWAP_LIMIT)
    .map((s) => {
      const toId = matchIngredient(s.to)?.ingredientId;
      return toId ? { from: s.from, to: s.to, toId } : { from: s.from, to: s.to };
    });
  return { oftenSkipped, preferredSwaps };
}

/** The Household screen's list: every ingredient with a change in the window, most skipped first. */
export function feedbackSummary(records: FeedbackRecord[], today: string): FeedbackSummary {
  const byIngredient = new Map<string, { skipped: number; replacements: Map<string, { text: string; count: number }>; lastDate: string }>();
  for (const r of inWindow(records, today)) {
    const row = byIngredient.get(r.ingredientId) ?? { skipped: 0, replacements: new Map(), lastDate: '' };
    const date = r.createdAt.slice(0, 10);
    if (date > row.lastDate) row.lastDate = date;
    if (r.kind === 'skipped') {
      row.skipped += 1;
    } else if (r.replacement) {
      const key = keyOf(r.replacement);
      const prev = row.replacements.get(key);
      if (prev) prev.count += 1;
      else row.replacements.set(key, { text: r.replacement.trim(), count: 1 });
    }
    byIngredient.set(r.ingredientId, row);
  }
  const items = [...byIngredient]
    .map(([ingredientId, row]) => ({
      ingredientId,
      name: INGREDIENT_BY_ID[ingredientId]?.name ?? ingredientId,
      skipped: row.skipped,
      replacements: [...row.replacements.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)),
      lastDate: row.lastDate,
    }))
    .sort((a, b) => b.skipped - a.skipped || a.name.localeCompare(b.name))
    .slice(0, SUMMARY_LIMIT);
  return { items };
}
