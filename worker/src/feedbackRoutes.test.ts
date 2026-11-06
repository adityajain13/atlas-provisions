// Ingredient changes in a saved meal: the PUT, DELETE and GET routes, the summary and forgetting. Against the real
// Worker app with an in-memory database. No network.
import { describe, expect, it } from 'vitest';
import { DAYS, SLOTS, defaultHousehold, expandWeek, torontoDate, type Household, type MealPlan, type PlanRequest } from '@provisions/shared';
import { API, OWNER, call, householdWith, json, rows, setup, withCookie } from './testing/app';

const WEEK = '2026-11-01';
const REQUEST: PlanRequest = { weekOf: WEEK, budget: 150, cravings: [], overrides: [], useItUp: false };
const MEAL = 'sun-dinner';
const path = (weekOf: string, mealId: string, ingredientId: string) =>
  `${API}/plan/${weekOf}/meals/${mealId}/ingredients/${ingredientId}/feedback`;

function household(): Household {
  const people = [{ id: 'ann', name: 'Ann', dietTags: [], allergies: [] }];
  const schedule = { ann: Object.fromEntries(DAYS.map((d) => [d, Object.fromEntries(SLOTS.map((s) => [s, true]))])) };
  return { ...defaultHousehold(), people, schedule, prepDay: null };
}

/** A saved week where the Sunday dinner uses sour cream and jasmine rice. The other meals use nothing. */
function storedPlan(doc: Household): MealPlan {
  const meals = expandWeek(doc, REQUEST).cells.map((c) => {
    const id = `${c.day}-${c.slot}`;
    const uses = id === MEAL ? [{ ingredientId: 'sour-cream', qty: 0.1, unit: 'kg' as const }, { ingredientId: 'jasmine-rice', qty: 0.2, unit: 'kg' as const }] : [];
    return { id, day: c.day, slot: c.slot, name: id === MEAL ? 'Chicken tacos' : `Meal ${id}`, eaters: [...c.eaters], ingredients: uses, activeMinutes: 20, steps: ['Cook'], tags: [] };
  });
  return {
    weekOf: WEEK,
    request: REQUEST,
    meals,
    fixedMeals: [],
    list: [],
    stores: [],
    totalCost: 0,
    fixedCost: 0,
    issues: [],
    attempts: 1,
    generatedAt: '2026-10-25T10:00:00.000Z',
    notes: 'saved',
  };
}

async function setupWeek() {
  const ctx = await setup();
  const cookie = ctx.cookies[OWNER]!;
  const hh = await householdWith(ctx.raw, ctx.env, cookie, OWNER, household());
  ctx.raw
    .prepare('INSERT INTO meal_plans (household_id, week_of, data, created_at) VALUES (?, ?, ?, ?)')
    .run(hh, WEEK, JSON.stringify(storedPlan(household())), '2026-10-25T10:00:00.000Z');
  return { ...ctx, cookie };
}

const put = (body: unknown, cookie?: string) => json('PUT', body, cookie);

describe('PUT /plan/:weekOf/meals/:mealId/ingredients/:ingredientId/feedback', () => {
  it('returns 401 without a session', async () => {
    const { env } = await setup();
    const res = await call(path(WEEK, MEAL, 'sour-cream'), { method: 'PUT', body: '{}' }, env);
    expect(res.status).toBe(401);
  });

  it('records a skipped ingredient with the meal name, and replaces the row when marked again', async () => {
    const { env, cookie, raw } = await setupWeek();
    const first = await call(path(WEEK, MEAL, 'sour-cream'), put({ kind: 'skipped' }, cookie), env);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ kind: 'skipped' });
    await call(path(WEEK, MEAL, 'sour-cream'), put({ kind: 'replaced', replacement: 'Greek yogurt' }, cookie), env);

    const saved = rows<{ kind: string; replacement: string | null; meal_name: string }>(
      raw,
      'SELECT kind, replacement, meal_name FROM ingredient_feedback WHERE ingredient_id = ?',
      'sour-cream',
    );
    expect(saved).toEqual([{ kind: 'replaced', replacement: 'Greek yogurt', meal_name: 'Chicken tacos' }]);
  });

  it('keeps a replacement only for a replaced ingredient', async () => {
    const { env, cookie, raw } = await setupWeek();
    await call(path(WEEK, MEAL, 'sour-cream'), put({ kind: 'skipped', replacement: 'ignored' }, cookie), env);
    expect(rows<{ replacement: string | null }>(raw, 'SELECT replacement FROM ingredient_feedback')).toEqual([{ replacement: null }]);
  });

  it('asks for the replacement when the ingredient is replaced', async () => {
    const { env, cookie } = await setupWeek();
    const res = await call(path(WEEK, MEAL, 'sour-cream'), put({ kind: 'replaced' }, cookie), env);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Say what it was replaced with');
  });

  it('rejects a kind that is neither skipped nor replaced', async () => {
    const { env, cookie } = await setupWeek();
    const res = await call(path(WEEK, MEAL, 'sour-cream'), put({ kind: 'loved' }, cookie), env);
    expect(res.status).toBe(400);
  });

  it('refuses an ingredient the meal does not use, an unknown meal, and a week with no plan', async () => {
    const { env, cookie } = await setupWeek();
    expect((await call(path(WEEK, MEAL, 'broccoli'), put({ kind: 'skipped' }, cookie), env)).status).toBe(400);
    expect((await call(path(WEEK, 'wed-lunch-missing', 'sour-cream'), put({ kind: 'skipped' }, cookie), env)).status).toBe(404);
    expect((await call(path('2026-11-15', MEAL, 'sour-cream'), put({ kind: 'skipped' }, cookie), env)).status).toBe(404);
  });

  it('rejects a weekOf that is not a Sunday', async () => {
    const { env, cookie } = await setupWeek();
    const res = await call(path('2026-10-28', MEAL, 'sour-cream'), put({ kind: 'skipped' }, cookie), env);
    expect(res.status).toBe(400);
  });
});

describe('DELETE the same path', () => {
  it('clears the change, so the meal is used as planned again', async () => {
    const { env, cookie, raw } = await setupWeek();
    await call(path(WEEK, MEAL, 'sour-cream'), put({ kind: 'skipped' }, cookie), env);
    const res = await call(path(WEEK, MEAL, 'sour-cream'), { method: 'DELETE', headers: { cookie } }, env);
    expect(res.status).toBe(200);
    expect(rows(raw, 'SELECT * FROM ingredient_feedback')).toEqual([]);
  });
});

describe('GET /plan/:weekOf/ingredient-feedback', () => {
  it('returns the week\'s changes by meal and ingredient, and nothing for another week', async () => {
    const { env, cookie } = await setupWeek();
    await call(path(WEEK, MEAL, 'sour-cream'), put({ kind: 'replaced', replacement: 'Greek yogurt' }, cookie), env);
    await call(path(WEEK, MEAL, 'jasmine-rice'), put({ kind: 'skipped' }, cookie), env);

    const week = await call(`${API}/plan/${WEEK}/ingredient-feedback`, withCookie(cookie), env);
    expect(await week.json()).toEqual({
      [MEAL]: {
        'sour-cream': { kind: 'replaced', replacement: 'Greek yogurt' },
        'jasmine-rice': { kind: 'skipped' },
      },
    });
    const other = await call(`${API}/plan/2026-11-15/ingredient-feedback`, withCookie(cookie), env);
    expect(await other.json()).toEqual({});
  });
});

describe('the household summary, and forgetting an ingredient', () => {
  it('lists each ingredient with its skips and replacements, and forgets all of them', async () => {
    const { env, cookie } = await setupWeek();
    await call(path(WEEK, MEAL, 'sour-cream'), put({ kind: 'replaced', replacement: 'Greek yogurt' }, cookie), env);
    await call(path(WEEK, MEAL, 'jasmine-rice'), put({ kind: 'skipped' }, cookie), env);

    const summary = await call(`${API}/ingredient-feedback`, withCookie(cookie), env);
    const body = (await summary.json()) as { items: { ingredientId: string; name: string; skipped: number; replacements: { text: string; count: number }[] }[] };
    expect(body.items.map((i) => i.ingredientId).sort()).toEqual(['jasmine-rice', 'sour-cream']);
    expect(body.items.find((i) => i.ingredientId === 'sour-cream')).toMatchObject({
      name: 'Sour cream',
      skipped: 0,
      replacements: [{ text: 'Greek yogurt', count: 1 }],
    });
    expect(body.items.find((i) => i.ingredientId === 'jasmine-rice')).toMatchObject({ skipped: 1, replacements: [] });

    const forgot = await call(`${API}/ingredient-feedback/sour-cream`, { method: 'DELETE', headers: { cookie } }, env);
    expect(await forgot.json()).toEqual({ ok: true, removed: 1 });
    const after = (await (await call(`${API}/ingredient-feedback`, withCookie(cookie), env)).json()) as { items: { ingredientId: string }[] };
    expect(after.items.map((i) => i.ingredientId)).toEqual(['jasmine-rice']);
  });

  it('counts only the changes made today or within the last 90 days', async () => {
    const { env, cookie, raw } = await setupWeek();
    const old = new Date(`${torontoDate()}T12:00:00Z`);
    old.setUTCDate(old.getUTCDate() - 120);
    raw
      .prepare(
        `INSERT INTO ingredient_feedback (id, household_id, week_of, meal_id, meal_name, ingredient_id, kind, replacement, created_at)
         SELECT 'old', id, ?, ?, 'Chicken tacos', 'sour-cream', 'skipped', NULL, ? FROM households LIMIT 1`,
      )
      .run(WEEK, MEAL, old.toISOString());
    const body = (await (await call(`${API}/ingredient-feedback`, withCookie(cookie), env)).json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });
});
