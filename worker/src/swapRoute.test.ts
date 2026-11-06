// POST /plan/:weekOf/swap, POST /plan/:weekOf/undo and the swap cap, against the real Worker app with an in-memory
// database and a stubbed Anthropic fetch. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAYS, SLOTS, defaultHousehold, expandWeek, type Household, type MealPlan, type PlanRequest } from '@provisions/shared';
import { API, OWNER, PARTNER, call, householdWith, json, rows, setup } from './testing/app';
import { toolReply } from './testing/sse';

const H = API;
const KEYED = { ANTHROPIC_API_KEY: 'test-key' };
const WEEK = '2026-11-08';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const REQUEST: PlanRequest = { weekOf: WEEK, budget: 150, cravings: [], overrides: [], useItUp: false };

function household(over: Partial<Household> = {}): Household {
  const people = [
    { id: 'ann', name: 'Ann', dietTags: [], allergies: [] },
    { id: 'ben', name: 'Ben', dietTags: [], allergies: [] },
  ];
  const schedule = Object.fromEntries(
    people.map((p) => [p.id, Object.fromEntries(DAYS.map((d) => [d, Object.fromEntries(SLOTS.map((s) => [s, true]))]))]),
  );
  return { ...defaultHousehold(), people, schedule, prepDay: null, ...over };
}

/** A saved week for the household: one meal per cell, with a leftover chain Mon dinner -> Tue lunch. */
function storedPlan(doc: Household, over: Partial<MealPlan> = {}): MealPlan {
  const meals = expandWeek(doc, REQUEST).cells.map((c) => {
    const id = `${c.day}-${c.slot}`;
    const link = id === 'mon-dinner' ? { makesLeftoversFor: 'tue-lunch' } : id === 'tue-lunch' ? { usesLeftoversFrom: 'mon-dinner' } : {};
    return {
      id,
      day: c.day,
      slot: c.slot,
      name: `Meal ${id}`,
      eaters: [...c.eaters],
      ingredients: [],
      activeMinutes: 10,
      steps: ['Cook'],
      tags: [],
      ...link,
    };
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
    ...over,
  };
}

/** Saves the plan the way the Worker stores it, and returns the exact stored JSON. */
function insertPlan(raw: Parameters<typeof rows>[0], hh: string, plan: MealPlan): string {
  const data = JSON.stringify(plan);
  raw.prepare('INSERT INTO meal_plans (household_id, week_of, data, created_at) VALUES (?, ?, ?, ?)').run(hh, plan.weekOf, data, plan.generatedAt);
  return data;
}

/** One submit_plan reply as the Messages API sends it. */
const claudeReply = (input: unknown) =>
  toolReply(input);

/** The parts of the payload the Worker sent in a call that these tests read. */
interface Sent {
  slots: { id: string }[];
  keptMeals?: unknown[];
  swapNote?: string;
  feedback: { check: string; severity: string; message: string }[] | null;
}

/** The payload the Worker sent in a call, as the model received it. */
const sentPayload = (init: RequestInit): Sent => JSON.parse(JSON.parse(init.body as string).messages[0].content) as Sent;

/** The planner's answer for the slots it was asked to fill: one new meal each, with no ingredients. */
const answerFor = (payload: { slots: { id: string }[] }, name = 'New') => ({
  notes: 'swapped',
  meals: payload.slots.map((s) => ({
    id: s.id,
    slotId: s.id,
    name: `${name} ${s.id}`,
    ingredients: [],
    activeMinutes: 10,
    steps: ['Cook'],
    tags: [],
  })),
});

/** Stubs fetch with one answer per call, in order (the last repeats). Returns the stub. */
function stubClaude(answers: ((payload: Sent) => unknown)[] = [(p) => answerFor(p)]) {
  let n = 0;
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const answer = answers[Math.min(n, answers.length - 1)]!;
    n++;
    return claudeReply(answer(sentPayload(init)));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-05T17:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A signed-in owner with a household, a saved week, and the env for the swap route. */
async function withPlan(extra: Record<string, string | undefined> = {}, doc: Household = household(), plan = storedPlan(doc)) {
  const { raw, env, cookies } = await setup([OWNER], { ...KEYED, ...extra });
  const hh = await householdWith(raw, env, cookies[OWNER]!, OWNER, doc);
  const stored = insertPlan(raw, hh, plan);
  return { raw, env, cookie: cookies[OWNER]!, hh, stored, plan };
}

const post = (path: string, body: unknown, cookie: string, env: never) => call(path, json('POST', body, cookie), env);

describe('POST /plan/:weekOf/swap', () => {
  it('replaces the chosen meal and its linked lunch, keeps the rest exactly as saved, and saves the previous plan', async () => {
    const { raw, env, cookie, stored, plan } = await withPlan();
    const fetchMock = stubClaude();

    const res = await post(`${H}/plan/${WEEK}/swap`, { mealIds: ['mon-dinner'], note: 'quicker' }, cookie, env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as MealPlan & { swapped: string[]; added: string[] };
    expect(body.swapped).toEqual(['mon-dinner', 'tue-lunch']);
    expect(body.added).toEqual(['mon-dinner', 'tue-lunch']);
    expect(body.meals).toHaveLength(21);

    const kept = (meals: MealPlan['meals']) => meals.filter((m) => m.id !== 'mon-dinner' && m.id !== 'tue-lunch');
    const saved = rows<{ data: string; previous: string | null }>(raw, 'SELECT data, previous FROM meal_plans WHERE week_of = ?', WEEK)[0]!;
    expect(JSON.stringify(kept(JSON.parse(saved.data).meals))).toBe(JSON.stringify(kept(plan.meals)));
    expect(saved.previous).toBe(stored);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(ANTHROPIC_URL);
    const sent = sentPayload(fetchMock.mock.calls[0]![1] as RequestInit);
    expect(sent.slots.map((s) => s.id).sort()).toEqual(['mon-dinner', 'tue-lunch']);
    expect(sent.keptMeals).toHaveLength(19);
    expect(sent.swapNote).toBe('quicker');
  });

  it('enforces the leftover chain on the server when only the lunch is sent', async () => {
    const { env, cookie } = await withPlan();
    stubClaude();

    const res = await post(`${H}/plan/${WEEK}/swap`, { mealIds: ['tue-lunch'] }, cookie, env);

    const body = (await res.json()) as { swapped: string[] };
    expect(body.swapped).toEqual(['mon-dinner', 'tue-lunch']);
  });

  it('retries with the problem as feedback when the reply touches a kept slot, then keeps the valid plan', async () => {
    const { env, cookie } = await withPlan();
    const fetchMock = stubClaude([
      (p) => ({ ...answerFor(p), meals: [...answerFor(p).meals, { id: 'wed-dinner', slotId: 'wed-dinner', name: 'Stray', ingredients: [], activeMinutes: 10, steps: [], tags: [] }] }),
      (p) => answerFor(p),
    ]);

    const res = await post(`${H}/plan/${WEEK}/swap`, { mealIds: ['mon-dinner'] }, cookie, env);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retry = sentPayload(fetchMock.mock.calls[1]![1] as RequestInit);
    expect(retry.feedback?.some((i) => i.message.includes('is not being swapped'))).toBe(true);
    const body = (await res.json()) as { issues: { severity: string }[]; attempts: number };
    expect(body.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(body.attempts).toBe(2);
  });

  it('keeps saved prep steps for kept meals when the reply has no prep, and warns', async () => {
    const doc = household({ prepDay: 'sun' });
    const plan = storedPlan(doc, {
      prep: {
        day: 'sun',
        totalMinutes: 30,
        steps: [
          { id: 'prep-1', task: 'Cook rice', minutes: 20, forMeals: ['thu-dinner'], day: 'sun' },
          { id: 'prep-2', task: 'Chop onion', minutes: 10, forMeals: ['mon-dinner'], day: 'sun' },
        ],
      },
    });
    const { env, cookie } = await withPlan({}, doc, plan);
    stubClaude();

    const res = await post(`${H}/plan/${WEEK}/swap`, { mealIds: ['mon-dinner'] }, cookie, env);

    const body = (await res.json()) as { prep?: { steps: { task: string }[] }; issues: { check: string; message: string }[] };
    expect(body.prep?.steps.map((s) => s.task)).toEqual(['Cook rice']);
    expect(body.issues).toContainEqual({
      check: 'prep',
      severity: 'warning',
      message: "Prep plan wasn't included; tap Regenerate prep.",
    });
  });

  it('counts a swap as usage, and refuses the household at its swap cap for the month with a 429', async () => {
    const { raw, env, cookie, hh } = await withPlan({ SWAP_CAP_MONTHLY: '1' });
    stubClaude();

    expect((await post(`${H}/plan/${WEEK}/swap`, { mealIds: ['wed-dinner'] }, cookie, env)).status).toBe(200);
    const capped = await post(`${H}/plan/${WEEK}/swap`, { mealIds: ['wed-dinner'] }, cookie, env);

    expect(capped.status).toBe(429);
    expect(await capped.text()).toBe('This household has used its 1 swap for this month. Resets on December 1, 2026.');
    expect(rows(raw, "SELECT count FROM usage WHERE household_id = ? AND kind = 'swap'", hh)).toEqual([{ count: 1 }]);
    const usage = (await (await call(`${H}/usage`, { headers: { cookie } }, env)).json()) as { counts: object; caps: object };
    expect(usage).toMatchObject({ counts: { plan: 0, receipt: 0, prep: 0, swap: 1 } });
    expect(usage.caps).toMatchObject({ swap: 1 });
  });

  it('never refuses a household with an admin in it, and still counts its swaps', async () => {
    const { raw, env, cookie, hh } = await withPlan({ SWAP_CAP_MONTHLY: '1', ADMIN_EMAILS: OWNER });
    stubClaude();

    expect((await post(`${H}/plan/${WEEK}/swap`, { mealIds: ['wed-dinner'] }, cookie, env)).status).toBe(200);
    expect((await post(`${H}/plan/${WEEK}/swap`, { mealIds: ['wed-dinner'] }, cookie, env)).status).toBe(200);
    expect(rows(raw, "SELECT count FROM usage WHERE household_id = ? AND kind = 'swap'", hh)).toEqual([{ count: 2 }]);
  });

  it('does not count a swap that failed', async () => {
    const { raw, env, cookie, hh } = await withPlan();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream down', { status: 500 })));

    const res = await post(`${H}/plan/${WEEK}/swap`, { mealIds: ['wed-dinner'] }, cookie, env);

    expect(res.status).toBe(500);
    expect(rows(raw, "SELECT count FROM usage WHERE household_id = ? AND kind = 'swap'", hh)).toEqual([]);
  });

  it('checks the body and the week before it calls the model', async () => {
    const { env, cookie } = await withPlan();
    const fetchMock = stubClaude();

    const cases: [string, unknown, number, string | RegExp][] = [
      ['no meals', { mealIds: [] }, 400, /Choose at least one meal/],
      ['too many meals', { mealIds: Array.from({ length: 22 }, (_, i) => `m${i}`) }, 400, /at most 21/],
      ['a note over 200 characters', { mealIds: ['wed-dinner'], note: 'x'.repeat(201) }, 400, /200 characters/],
      ['an unknown meal', { mealIds: ['not-a-meal'] }, 400, 'Unknown meal: not-a-meal'],
    ];
    for (const [, body, status, text] of cases) {
      const res = await post(`${H}/plan/${WEEK}/swap`, body, cookie, env);
      expect(res.status).toBe(status);
      const message = await res.text();
      if (typeof text === 'string') expect(message).toBe(text);
      else expect(message).toMatch(text);
    }

    const thursday = await post(`${H}/plan/2026-11-12/swap`, { mealIds: ['wed-dinner'] }, cookie, env);
    expect(thursday.status).toBe(400);
    expect(await thursday.text()).toBe('weekOf must be a Sunday (YYYY-MM-DD)');

    for (const weekOf of ['2026-11-22', '2026-10-25']) {
      const res = await post(`${H}/plan/${weekOf}/swap`, { mealIds: ['wed-dinner'] }, cookie, env);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('You can plan this week or up to 2 weeks ahead.');
    }

    const noPlan = await post(`${H}/plan/2026-11-15/swap`, { mealIds: ['wed-dinner'] }, cookie, env);
    expect(noPlan.status).toBe(404);
    expect(await noPlan.text()).toBe('No plan for this week');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 503 without the planner key', async () => {
    const { env, cookie } = await withPlan({ ANTHROPIC_API_KEY: undefined });
    const res = await post(`${H}/plan/${WEEK}/swap`, { mealIds: ['wed-dinner'] }, cookie, env);
    expect(res.status).toBe(503);
  });

  it('keeps one household’s plan from another household: the other household has no plan to swap', async () => {
    const { raw, env, cookies } = await setup([OWNER, PARTNER], { ...KEYED, ALLOWED_EMAILS: `${OWNER},${PARTNER}` });
    const ownerHh = await householdWith(raw, env, cookies[OWNER]!, OWNER, household());
    insertPlan(raw, ownerHh, storedPlan(household()));
    await call(`${H}/household`, { headers: { cookie: cookies[PARTNER]! } }, env);
    stubClaude();

    const res = await post(`${H}/plan/${WEEK}/swap`, { mealIds: ['wed-dinner'] }, cookies[PARTNER]!, env);
    expect(res.status).toBe(404);
    const undo = await post(`${H}/plan/${WEEK}/undo`, {}, cookies[PARTNER]!, env);
    expect(undo.status).toBe(404);
  });
});

describe('POST /plan/:weekOf/undo', () => {
  it('puts back the plan a swap replaced, and a second undo swaps the two back', async () => {
    const { raw, env, cookie, stored, hh } = await withPlan();
    stubClaude();
    await post(`${H}/plan/${WEEK}/swap`, { mealIds: ['mon-dinner'] }, cookie, env);
    const swapped = rows<{ data: string }>(raw, 'SELECT data FROM meal_plans WHERE household_id = ? AND week_of = ?', hh, WEEK)[0]!.data;

    const undo = await post(`${H}/plan/${WEEK}/undo`, {}, cookie, env);

    expect(undo.status).toBe(200);
    expect(rows(raw, 'SELECT data FROM meal_plans WHERE household_id = ? AND week_of = ?', hh, WEEK)).toEqual([{ data: stored }]);
    expect(((await undo.json()) as MealPlan).meals.find((m) => m.id === 'mon-dinner')!.name).toBe('Meal mon-dinner');

    const again = await post(`${H}/plan/${WEEK}/undo`, {}, cookie, env);
    expect(again.status).toBe(200);
    expect(rows(raw, 'SELECT data, previous FROM meal_plans WHERE household_id = ? AND week_of = ?', hh, WEEK)).toEqual([
      { data: swapped, previous: stored },
    ]);
  });

  it('is a 404 when there is nothing to undo, and a 400 for a week that cannot be changed', async () => {
    const { env, cookie } = await withPlan();
    const none = await post(`${H}/plan/${WEEK}/undo`, {}, cookie, env);
    expect(none.status).toBe(404);
    expect(await none.text()).toBe('Nothing to undo for this week');

    const past = await post(`${H}/plan/2026-10-25/undo`, {}, cookie, env);
    expect(past.status).toBe(400);
  });
});

describe('POST /plan keeps the plan it replaces for undo', () => {
  it('saves the old plan as previous when a new plan replaces it', async () => {
    const { raw, env, cookie, hh, stored } = await withPlan();
    stubClaude();
    const res = await post(`${H}/plan`, { ...REQUEST, budget: 150 }, cookie, env);
    expect(res.status).toBe(200);
    expect(rows(raw, 'SELECT previous FROM meal_plans WHERE household_id = ? AND week_of = ?', hh, WEEK)).toEqual([{ previous: stored }]);
  });

  it('keeps the previous plan when only the prep is regenerated', async () => {
    const doc = household({ prepDay: 'sun' });
    const { raw, env, cookie, hh } = await withPlan({}, doc, storedPlan(doc));
    stubClaude(); // the prep reply is not a prep list, so the regenerate call saves the plan with its prep warning
    // A previous plan from an earlier swap, put in place directly.
    raw.prepare('UPDATE meal_plans SET previous = ? WHERE household_id = ? AND week_of = ?').run('{"earlier":true}', hh, WEEK);
    await post(`${H}/plan/${WEEK}/prep`, undefined, cookie, env);
    expect(rows(raw, 'SELECT previous FROM meal_plans WHERE household_id = ? AND week_of = ?', hh, WEEK)).toEqual([
      { previous: '{"earlier":true}' },
    ]);
  });
});

describe('POST /plan/:weekOf/swap with x-ndjson', () => {
  it('streams the stages and ends with the swapped week, its swapped and added meal ids', async () => {
    const { env, cookie } = await withPlan();
    stubClaude();

    const res = await call(
      `${H}/plan/${WEEK}/swap`,
      { method: 'POST', headers: { 'content-type': 'application/json', cookie, accept: 'application/x-ndjson' }, body: JSON.stringify({ mealIds: ['mon-dinner'] }) },
      env,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const lines = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.map((l) => l.stage)).toEqual(['writing', 'checking', 'saving', 'done']);
    const done = lines[3] as { plan: { meals: unknown[] }; swapped: string[]; added: string[] };
    expect(done.swapped).toEqual(['mon-dinner', 'tue-lunch']);
    expect(done.added).toEqual(['mon-dinner', 'tue-lunch']);
    expect(done.plan.meals).toHaveLength(21);
  });
});
