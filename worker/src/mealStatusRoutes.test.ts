// "Didn't go to plan?": the status PUT and DELETE routes, statuses on GET /plan/:weekOf, and the to-pantry route.
// Against the real Worker app with an in-memory database. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAYS, SLOTS, defaultExpiry, defaultHousehold, expandWeek, INGREDIENT_BY_ID, type Household, type MealPlan, type PlanRequest } from '@provisions/shared';
import { API, OWNER, PARTNER, call, householdWith, json, rows, setup } from './testing/app';

const WEEK = '2026-11-08';
const REQUEST: PlanRequest = { weekOf: WEEK, budget: 150, cravings: [], overrides: [], useItUp: false };
const DINNER = 'sun-dinner';
const path = (mealId: string, weekOf = WEEK) => `${API}/plan/${weekOf}/meals/${mealId}/status`;

function household(): Household {
  const people = [
    { id: 'ann', name: 'Ann', dietTags: [], allergies: [] },
    { id: 'ben', name: 'Ben', dietTags: [], allergies: [] },
  ];
  const schedule = Object.fromEntries(
    people.map((p) => [p.id, Object.fromEntries(DAYS.map((d) => [d, Object.fromEntries(SLOTS.map((s) => [s, true]))]))]),
  );
  return { ...defaultHousehold(), people, schedule, prepDay: null };
}

/** A saved week. The Sunday dinner uses sour cream and jasmine rice; the other meals use nothing. */
function storedPlan(doc: Household): MealPlan {
  const meals = expandWeek(doc, REQUEST).cells.map((c) => {
    const id = `${c.day}-${c.slot}`;
    const ingredients =
      id === DINNER
        ? [
            { ingredientId: 'sour-cream', qty: 0.2, unit: 'kg' as const },
            { ingredientId: 'jasmine-rice', qty: 0.4, unit: 'kg' as const },
          ]
        : [];
    return { id, day: c.day, slot: c.slot, name: id === DINNER ? 'Chicken tacos' : `Meal ${id}`, eaters: [...c.eaters], ingredients, activeMinutes: 20, steps: ['Cook'], tags: [] };
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
    generatedAt: '2026-11-01T10:00:00.000Z',
    notes: 'saved',
  };
}

async function setupWeek(extra: Record<string, string | undefined> = {}) {
  const ctx = await setup([OWNER, PARTNER], { ALLOWED_EMAILS: `${OWNER},${PARTNER}`, ...extra });
  const cookie = ctx.cookies[OWNER]!;
  const hh = await householdWith(ctx.raw, ctx.env, cookie, OWNER, household());
  ctx.raw
    .prepare('INSERT INTO meal_plans (household_id, week_of, data, created_at) VALUES (?, ?, ?, ?)')
    .run(hh, WEEK, JSON.stringify(storedPlan(household())), '2026-11-01T10:00:00.000Z');
  // The partner signs in and gets a household of their own, with no plan.
  await call(`${API}/household`, { headers: { cookie: ctx.cookies[PARTNER]! } }, ctx.env);
  return { ...ctx, cookie, partner: ctx.cookies[PARTNER]!, hh };
}

const put = (mealId: string, body: unknown, cookie: string, env: never, weekOf = WEEK) => call(path(mealId, weekOf), json('PUT', body, cookie), env);
const del = (mealId: string, cookie: string, env: never) => call(path(mealId), { method: 'DELETE', headers: { cookie } }, env);
const getPlan = (cookie: string, env: never, weekOf = WEEK) => call(`${API}/plan/${weekOf}`, { headers: { cookie } }, env);

describe('PUT /plan/:weekOf/meals/:mealId/status', () => {
  it('returns 401 without a session', async () => {
    const { env } = await setup();
    const res = await call(path(DINNER), json('PUT', { status: 'skipped' }), env);
    expect(res.status).toBe(401);
  });

  it('marks a meal skipped with its reason, and GET /plan shows the status by meal id', async () => {
    const { env, cookie, raw, hh } = await setupWeek();

    const res = await put(DINNER, { status: 'skipped', reason: 'ate-out' }, cookie, env as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'skipped', reason: 'ate-out' });

    const stored = rows<{ status: string; reason: string; week_of: string }>(raw, 'SELECT status, reason, week_of FROM meal_status WHERE household_id = ?', hh);
    expect(stored).toEqual([{ status: 'skipped', reason: 'ate-out', week_of: WEEK }]);

    const plan = (await (await getPlan(cookie, env as never)).json()) as MealPlan & { statuses: Record<string, unknown> };
    expect(plan.statuses).toEqual({ [DINNER]: { status: 'skipped', reason: 'ate-out' } });
    expect(plan.meals).toHaveLength(21);
  });

  it('replaces the row when the meal is marked again', async () => {
    const { env, cookie, raw, hh } = await setupWeek();
    await put(DINNER, { status: 'skipped', reason: 'not-eating' }, cookie, env as never);
    await put(DINNER, { status: 'replaced', madeName: 'Lentil soup' }, cookie, env as never);

    expect(rows(raw, 'SELECT meal_id FROM meal_status WHERE household_id = ?', hh)).toHaveLength(1);
    const plan = (await (await getPlan(cookie, env as never)).json()) as { statuses: Record<string, unknown> };
    expect(plan.statuses).toEqual({ [DINNER]: { status: 'replaced', madeName: 'Lentil soup' } });
  });

  it('keeps guests and their allergies on a meal made instead', async () => {
    const { env, cookie } = await setupWeek();
    const body = { status: 'replaced', guests: 2, guestAllergies: ['tree nut'], note: 'Vegetarian guest' };
    expect((await put(DINNER, body, cookie, env as never)).status).toBe(200);

    const plan = (await (await getPlan(cookie, env as never)).json()) as { statuses: Record<string, unknown> };
    expect(plan.statuses[DINNER]).toEqual(body);
  });

  it('refuses a reason on a meal made instead, a name on a skipped meal, and guests on a skipped meal', async () => {
    const { env, cookie } = await setupWeek();
    expect((await put(DINNER, { status: 'replaced', reason: 'ate-out' }, cookie, env as never)).status).toBe(400);
    expect((await put(DINNER, { status: 'skipped', madeName: 'Toast' }, cookie, env as never)).status).toBe(400);
    expect((await put(DINNER, { status: 'skipped', guests: 1 }, cookie, env as never)).status).toBe(400);
    expect((await put(DINNER, { status: 'replaced', guests: 11 }, cookie, env as never)).status).toBe(400);
    expect((await put(DINNER, { status: 'maybe' }, cookie, env as never)).status).toBe(400);
  });

  it('is 404 for a meal the week does not have, and for a week with no plan', async () => {
    const { env, cookie } = await setupWeek();
    expect((await put('no-such-meal', { status: 'skipped' }, cookie, env as never)).status).toBe(404);
    expect((await put(DINNER, { status: 'skipped' }, cookie, env as never, '2026-11-15')).status).toBe(404);
  });

  it("does not reach another household's week", async () => {
    const { env, partner } = await setupWeek();
    expect((await put(DINNER, { status: 'skipped' }, partner, env as never)).status).toBe(404);
    const plan = await getPlan(partner, env as never);
    expect(plan.status).toBe(404);
  });
});

describe('DELETE /plan/:weekOf/meals/:mealId/status', () => {
  it('clears the mark, so GET /plan shows none', async () => {
    const { env, cookie } = await setupWeek();
    await put(DINNER, { status: 'skipped', reason: 'ate-out' }, cookie, env as never);

    const res = await del(DINNER, cookie, env as never);
    expect(res.status).toBe(200);
    const plan = (await (await getPlan(cookie, env as never)).json()) as { statuses: Record<string, unknown> };
    expect(plan.statuses).toEqual({});
  });

  it('is fine to clear a meal that has no mark, and does not touch another household', async () => {
    const { env, cookie, partner, raw, hh } = await setupWeek();
    await put(DINNER, { status: 'skipped' }, cookie, env as never);
    expect((await del(DINNER, cookie, env as never)).status).toBe(200);
    expect((await del(DINNER, cookie, env as never)).status).toBe(200);

    await put(DINNER, { status: 'skipped' }, cookie, env as never);
    await del(DINNER, partner, env as never); // the partner has no plan, so this is refused before any delete
    expect(rows(raw, 'SELECT meal_id FROM meal_status WHERE household_id = ?', hh)).toHaveLength(1);
  });
});

describe('GET /plan/:weekOf statuses', () => {
  it('is an empty object when nothing is marked', async () => {
    const { env, cookie } = await setupWeek();
    const plan = (await (await getPlan(cookie, env as never)).json()) as { statuses: unknown; meals: unknown[] };
    expect(plan.statuses).toEqual({});
    expect(plan.meals).toHaveLength(21);
  });
});

describe('POST /plan/:weekOf/meals/:mealId/to-pantry', () => {
  const toPantry = (mealId: string, body: unknown, cookie: string, env: never, weekOf = WEEK) =>
    call(`${API}/plan/${weekOf}/meals/${mealId}/to-pantry`, json('POST', body, cookie), env);

  it('puts the unused amounts into the pantry as plan leftovers, with the catalogue shelf life', async () => {
    const { env, cookie, raw, hh } = await setupWeek();
    const res = await toPantry(DINNER, { items: [{ ingredientId: 'sour-cream', qty: 0.2 }, { ingredientId: 'jasmine-rice', qty: 0.4 }] }, cookie, env as never);

    expect(res.status).toBe(201);
    const body = (await res.json()) as { added: { ingredientId: string; qty: number; unit: string; expiresOn: string; source: string }[] };
    expect(body.added.map((i) => [i.ingredientId, i.qty, i.unit, i.source])).toEqual([
      ['sour-cream', 0.2, INGREDIENT_BY_ID['sour-cream']!.baseUnit, 'plan-leftover'],
      ['jasmine-rice', 0.4, INGREDIENT_BY_ID['jasmine-rice']!.baseUnit, 'plan-leftover'],
    ]);

    const addedOn = rows<{ added_on: string }>(raw, 'SELECT added_on FROM pantry_items WHERE household_id = ? LIMIT 1', hh)[0]!.added_on;
    expect(body.added[0]!.expiresOn).toBe(defaultExpiry('sour-cream', addedOn));
    const stored = rows<{ ingredient_id: string; source: string; expires_on: string }>(raw, 'SELECT ingredient_id, source, expires_on FROM pantry_items WHERE household_id = ? ORDER BY ingredient_id', hh);
    expect(stored.map((r) => [r.ingredient_id, r.source])).toEqual([
      ['jasmine-rice', 'plan-leftover'],
      ['sour-cream', 'plan-leftover'],
    ]);
  });

  it('refuses an ingredient the meal does not use, and leaves the pantry alone', async () => {
    const { env, cookie, raw, hh } = await setupWeek();
    const res = await toPantry(DINNER, { items: [{ ingredientId: 'sour-cream', qty: 0.1 }, { ingredientId: 'honey', qty: 0.1 }] }, cookie, env as never);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('is not an ingredient of that meal');
    expect(rows(raw, 'SELECT id FROM pantry_items WHERE household_id = ?', hh)).toEqual([]);
  });

  it('refuses an empty list, a zero quantity and a repeated ingredient', async () => {
    const { env, cookie } = await setupWeek();
    expect((await toPantry(DINNER, { items: [] }, cookie, env as never)).status).toBe(400);
    expect((await toPantry(DINNER, { items: [{ ingredientId: 'sour-cream', qty: 0 }] }, cookie, env as never)).status).toBe(400);
    expect(
      (await toPantry(DINNER, { items: [{ ingredientId: 'sour-cream', qty: 0.1 }, { ingredientId: 'sour-cream', qty: 0.2 }] }, cookie, env as never)).status,
    ).toBe(400);
  });

  it('is 404 for an unknown meal and for another household', async () => {
    const { env, cookie, partner } = await setupWeek();
    const items = { items: [{ ingredientId: 'sour-cream', qty: 0.1 }] };
    expect((await toPantry('no-such-meal', items, cookie, env as never)).status).toBe(404);
    expect((await toPantry(DINNER, items, partner, env as never)).status).toBe(404);
  });
});

describe('POST /plan clears the marks of the week it plans again', () => {
  const NEW_WEEK = '2026-11-15';
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T17:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('drops the statuses of that week, because its meals are new', async () => {
    const { raw, env, cookies } = await setup([OWNER], { ANTHROPIC_API_KEY: 'test-key' });
    const hh = await householdWith(raw, env, cookies[OWNER]!, OWNER, { ...defaultHousehold(), people: [{ id: 'ann', name: 'Ann', dietTags: [], allergies: [] }], schedule: {}, prepDay: null });
    const meals = DAYS.flatMap((d) =>
      SLOTS.map((sl) => ({ id: `${d}-${sl}`, slotId: `${d}-${sl}`, name: `${d} ${sl}`, ingredients: [], activeMinutes: 10, steps: [], tags: [] })),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_plan', input: { meals, notes: 'fake' } }] }), { status: 200 })),
    );
    const request = { weekOf: NEW_WEEK, budget: 150, cravings: [], overrides: [], useItUp: false };
    expect((await call(`${API}/plan`, json('POST', request, cookies[OWNER]), env)).status).toBe(200);
    expect((await put('mon-dinner', { status: 'skipped', reason: 'ate-out' }, cookies[OWNER]!, env as never, NEW_WEEK)).status).toBe(200);
    expect(rows(raw, 'SELECT meal_id FROM meal_status WHERE household_id = ?', hh)).toHaveLength(1);

    expect((await call(`${API}/plan`, json('POST', request, cookies[OWNER]), env)).status).toBe(200);

    expect(rows(raw, 'SELECT meal_id FROM meal_status WHERE household_id = ?', hh)).toEqual([]);
  });
});
