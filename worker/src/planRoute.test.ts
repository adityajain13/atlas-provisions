// POST /plan against the real Worker app, with a real in-memory database and a stubbed fetch. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAYS, SLOTS, defaultHousehold, type Household, type PlanRequest } from '@provisions/shared';
import { API, OWNER, call, householdWith, json, rows, setup } from './testing/app';

const H = API;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const KEYED = { ANTHROPIC_API_KEY: 'test-key' };
const REQUEST: PlanRequest = { weekOf: '2026-11-15', budget: 150, cravings: [], overrides: [], useItUp: false };

function household(over: Partial<Household> = {}): Household {
  const people = [
    { id: 'ann', name: 'Ann', dietTags: [], allergies: [] },
    { id: 'ben', name: 'Ben', dietTags: [], allergies: [] },
  ];
  // Both people eat every slot, so the grid has one cell per slot.
  const schedule = Object.fromEntries(
    people.map((p) => [p.id, Object.fromEntries(DAYS.map((d) => [d, Object.fromEntries(SLOTS.map((s) => [s, true]))]))]),
  );
  return { ...defaultHousehold(), people, schedule, prepDay: 'sun', ...over };
}

/** Claude's answer: one meal per slot with no ingredients, plus the given prep when there is one. */
function claudeInput(prep?: unknown) {
  const meals = DAYS.flatMap((d) =>
    SLOTS.map((s) => ({ id: `${d}-${s}`, slotId: `${d}-${s}`, name: `${d} ${s}`, ingredients: [], activeMinutes: 10, steps: [], tags: [] })),
  );
  return { meals, notes: 'fake', ...(prep !== undefined ? { prep } : {}) };
}

/** Stubs fetch so every Claude call returns the same submit_plan input. Returns the stub to count calls. */
function stubClaude(input: unknown) {
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_plan', input }] }), {
        status: 200,
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// Fixed week: the plan window is judged against today, so the clock is set inside it.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-05T17:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('POST /plan', () => {
  it('makes exactly one Claude call and saves the prep that came back with the meals', async () => {
    const { raw, env, cookies } = await setup([OWNER], KEYED);
    await householdWith(raw, env, cookies[OWNER]!, OWNER, household());
    const fetchMock = stubClaude(claudeInput({ day: 'sun', steps: [{ id: 's', task: 'Cook rice', minutes: 20, forMeals: ['thu-dinner'] }] }));

    const res = await call(`${H}/plan`, json('POST', REQUEST, cookies[OWNER]), env);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(ANTHROPIC_URL);
    const body = (await res.json()) as { prep?: { day: string; steps: { task: string }[] }; issues: { check: string }[] };
    expect(body.prep?.day).toBe('sun');
    expect(body.prep?.steps.map((s) => s.task)).toEqual(['Cook rice']);
    expect(body.issues.some((i) => i.check === 'prep')).toBe(false);
    const saved = rows<{ data: string }>(raw, 'SELECT data FROM meal_plans WHERE week_of = ?', REQUEST.weekOf);
    expect(JSON.parse(saved[0]!.data)).toMatchObject({ prep: { day: 'sun' } });
  });

  it('keeps the plan with a prep warning, after one call, when the call returns no prep', async () => {
    const { raw, env, cookies } = await setup([OWNER], KEYED);
    await householdWith(raw, env, cookies[OWNER]!, OWNER, household());
    const fetchMock = stubClaude(claudeInput());

    const res = await call(`${H}/plan`, json('POST', REQUEST, cookies[OWNER]), env);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as { prep?: unknown; meals: unknown[]; issues: unknown[] };
    expect(body.prep).toBeUndefined();
    expect(body.meals).toHaveLength(21);
    expect(body.issues).toContainEqual({
      check: 'prep',
      severity: 'warning',
      message: "Prep plan wasn't included; tap Regenerate prep.",
    });
  });

  it('sends a null prep day and attaches no prep when the household has no prep day', async () => {
    const { raw, env, cookies } = await setup([OWNER], KEYED);
    await householdWith(raw, env, cookies[OWNER]!, OWNER, household({ prepDay: null }));
    const fetchMock = stubClaude(claudeInput({ day: 'sun', steps: [{ id: 's', task: 'Cook rice', minutes: 20, forMeals: [] }] }));

    const res = await call(`${H}/plan`, json('POST', REQUEST, cookies[OWNER]), env);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(JSON.parse(fetchMock.mock.calls[0]![1].body as string).messages[0].content) as { prepDay: unknown };
    expect(sent.prepDay).toBeNull();
    const body = (await res.json()) as { prep?: unknown; issues: { check: string }[] };
    expect(body.prep).toBeUndefined();
    expect(body.issues.some((i) => i.check === 'prep')).toBe(false);
  });
});

describe('Sunday plan weeks', () => {
  const SUNDAY_MESSAGE = 'weekOf must be a Sunday (YYYY-MM-DD)';

  it('rejects a Thursday weekOf on POST /plan, GET /plan and the prep route with the schema message', async () => {
    const { raw, env, cookies } = await setup([OWNER], KEYED);
    await householdWith(raw, env, cookies[OWNER]!, OWNER, household());
    const fetchMock = stubClaude(claudeInput());
    const cookie = cookies[OWNER]!;

    const planRes = await call(`${H}/plan`, json('POST', { ...REQUEST, weekOf: '2026-11-12' }, cookie), env);
    expect(planRes.status).toBe(400);
    expect(await planRes.text()).toContain(SUNDAY_MESSAGE);

    const getRes = await call(`${H}/plan/2026-11-12`, { headers: { cookie } }, env);
    expect(getRes.status).toBe(400);
    expect(await getRes.text()).toBe(SUNDAY_MESSAGE);

    const prepRes = await call(`${H}/plan/2026-11-12/prep`, { method: 'POST', headers: { cookie } }, env);
    expect(prepRes.status).toBe(400);
    expect(await prepRes.text()).toBe(SUNDAY_MESSAGE);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a Sunday on GET /plan (no saved plan yet, so 404)', async () => {
    const { env, cookies } = await setup([OWNER], KEYED);
    const res = await call(`${H}/plan/2026-11-15`, { headers: { cookie: cookies[OWNER]! } }, env);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('No plan for this week');
  });
});



describe('never-buy rules on POST /plan', () => {
  it('blocks every ingredient a never-buy name covers, less the un-ticked ones, and sends the names', async () => {
    const { raw, env, cookies } = await setup([OWNER], KEYED);
    await householdWith(
      raw,
      env,
      cookies[OWNER]!,
      OWNER,
      household({
        itemRules: [
          { id: 'r1', name: 'corn', rule: 'never', except: ['canned-corn'] },
          { id: 'r2', name: 'oats', rule: 'never' },
          { id: 'r3', name: 'eggs', rule: 'always' },
        ],
      }),
    );
    const fetchMock = stubClaude(claudeInput());

    const res = await call(`${H}/plan`, json('POST', REQUEST, cookies[OWNER]), env);

    expect(res.status).toBe(200);
    const sent = JSON.parse(JSON.parse(fetchMock.mock.calls[0]![1].body as string).messages[0].content) as {
      neverBuy: string[];
      neverBuyWords: string[];
    };
    expect(sent.neverBuy).toEqual(expect.arrayContaining(['corn-cobs', 'frozen-corn', 'corn-tortillas', 'tortilla-chips', 'rolled-oats']));
    expect(sent.neverBuy).not.toContain('canned-corn');
    expect(sent.neverBuyWords).toEqual(['corn', 'oats']);
  });
});
