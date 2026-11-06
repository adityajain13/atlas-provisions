// What the household skipped or replaced in a planned meal, and the summary the planner and Household read.
// Mounted under /provisions/api, behind sign-in. Every route works in the signed-in address's household.
import { Hono } from 'hono';
import {
  FEEDBACK_WINDOW_DAYS,
  IngredientFeedbackInputSchema,
  addDaysIso,
  feedbackSignals,
  feedbackSummary,
  isSundayIso,
  newId,
  torontoDate,
  type FeedbackSignals,
  type FeedbackSummary,
} from '@provisions/shared';
import type { ZodError } from 'zod';
import { deleteFeedback, forgetIngredientFeedback, loadFeedbackRecords, loadPlan, loadWeekFeedback, upsertFeedback } from './db';
import type { AuthMiddlewareEnv, SessionVars } from './authMiddleware';

export const feedbackRoutes = new Hono<{ Bindings: AuthMiddlewareEnv; Variables: SessionVars }>();


function formatZod(error: ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}

/** The household's changes from the last FEEDBACK_WINDOW_DAYS, as a summary for the Household screen. */
/** The planner's signals from the household's changes in the window, as of `today`. */
export async function planFeedback(db: D1Database, householdId: string, today: string): Promise<FeedbackSignals> {
  return feedbackSignals(await loadFeedbackRecords(db, householdId, addDaysIso(today, -FEEDBACK_WINDOW_DAYS)), today);
}

export async function householdFeedbackSummary(db: D1Database, householdId: string, today: string): Promise<FeedbackSummary> {
  const since = addDaysIso(today, -FEEDBACK_WINDOW_DAYS);
  return feedbackSummary(await loadFeedbackRecords(db, householdId, since), today);
}

// Marks one ingredient in one meal as skipped or replaced. Any week with a saved plan, past weeks too.
feedbackRoutes.put(`/plan/:weekOf/meals/:mealId/ingredients/:ingredientId/feedback`, async (c) => {
  const weekOf = c.req.param('weekOf');
  if (!isSundayIso(weekOf)) return c.text('weekOf must be a Sunday (YYYY-MM-DD)', 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.text('Body must be JSON', 400);
  }
  const parsed = IngredientFeedbackInputSchema.safeParse(body);
  if (!parsed.success) return c.text(formatZod(parsed.error), 400);

  const householdId = c.get('householdId');
  const plan = await loadPlan(c.env.DB, householdId, weekOf);
  if (!plan) return c.text('No plan for this week', 404);
  const mealId = c.req.param('mealId');
  const ingredientId = c.req.param('ingredientId');
  const meal = plan.meals.find((m) => m.id === mealId);
  if (!meal) return c.text('No such meal in this week', 404);
  if (!meal.ingredients.some((i) => i.ingredientId === ingredientId)) {
    return c.text('That meal does not use that ingredient', 400);
  }

  const record = {
    id: newId(),
    weekOf,
    mealId,
    mealName: meal.name,
    ingredientId,
    kind: parsed.data.kind,
    ...(parsed.data.kind === 'replaced' && parsed.data.replacement ? { replacement: parsed.data.replacement } : {}),
    createdAt: new Date().toISOString(),
  };
  await upsertFeedback(c.env.DB, householdId, record);
  return c.json({ kind: record.kind, ...(record.replacement ? { replacement: record.replacement } : {}) });
});

// Clears one ingredient's change in one meal: used as planned again.
feedbackRoutes.delete(`/plan/:weekOf/meals/:mealId/ingredients/:ingredientId/feedback`, async (c) => {
  const weekOf = c.req.param('weekOf');
  if (!isSundayIso(weekOf)) return c.text('weekOf must be a Sunday (YYYY-MM-DD)', 400);
  await deleteFeedback(c.env.DB, c.get('householdId'), weekOf, c.req.param('mealId'), c.req.param('ingredientId'));
  return c.json({ ok: true });
});

// The changes saved for one week, by meal id and then ingredient id, for the meal detail to show.
feedbackRoutes.get(`/plan/:weekOf/ingredient-feedback`, async (c) => {
  const weekOf = c.req.param('weekOf');
  if (!isSundayIso(weekOf)) return c.text('weekOf must be a Sunday (YYYY-MM-DD)', 400);
  return c.json(await loadWeekFeedback(c.env.DB, c.get('householdId'), weekOf));
});

// What the planner has learned, over the window. Each ingredient with a change: how often it was skipped, and what
// it was replaced with.
feedbackRoutes.get(`/ingredient-feedback`, async (c) => {
  return c.json(await householdFeedbackSummary(c.env.DB, c.get('householdId'), torontoDate()));
});

// Forgets an ingredient's changes, in every week.
feedbackRoutes.delete(`/ingredient-feedback/:ingredientId`, async (c) => {
  const removed = await forgetIngredientFeedback(c.env.DB, c.get('householdId'), c.req.param('ingredientId'));
  return c.json({ ok: true, removed });
});
