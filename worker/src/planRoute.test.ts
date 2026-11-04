// POST /plan against the real Worker app, with an in-memory D1 stub and a stubbed fetch. No network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAYS, SLOTS, defaultHousehold, type Household, type PlanRequest } from '@provisions/shared';
import { app } from './index';

const H = '/provisions/api';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
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

/** A D1 stub: the session, the stored household, and the planner's reads (all empty). Writes are recorded. */
function fakeDb(stored: Household) {
  const writes: { sql: string; args: unknown[] }[] = [];
  const session = { email: 'owner@example.com', expires_at: Date.now() + 365 * 86_400_000 };

  const first = (sql: string): unknown => {
    if (sql === 'SELECT email, expires_at FROM sessions WHERE id_hash = ?') return session;
    if (sql === 'SELECT data FROM household WHERE id = 1') return { data: JSON.stringify(stored) };
    return null;
  };

  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) {
          args = values;
          return stmt;
        },
        async first() {
          return first(sql);
        },
        async run() {
          writes.push({ sql, args });
          return { meta: { changes: 1 } };
        },
        async all() {
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  return { db, writes };
}

const makeEnv = (db: unknown) =>
  ({
    DB: db,
    ALLOWED_EMAILS: 'owner@example.com',
    ANTHROPIC_API_KEY: 'test-key',
    ASSETS: { fetch: async () => new Response('asset') },
    DEV: '0',
  }) as never;

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

const post = (path: string, body: unknown, env: unknown) =>
  app.request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'ap_session=valid-token' },
      body: JSON.stringify(body),
    },
    env as never,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /plan', () => {
  it('makes exactly one Claude call and saves the prep that came back with the meals', async () => {
    const { db, writes } = fakeDb(household());
    const fetchMock = stubClaude(claudeInput({ day: 'sun', steps: [{ id: 's', task: 'Cook rice', minutes: 20, forMeals: ['thu-dinner'] }] }));

    const res = await post(`${H}/plan`, REQUEST, makeEnv(db));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(ANTHROPIC_URL);
    const body = (await res.json()) as { prep?: { day: string; steps: { task: string }[] }; issues: { check: string }[] };
    expect(body.prep?.day).toBe('sun');
    expect(body.prep?.steps.map((s) => s.task)).toEqual(['Cook rice']);
    expect(body.issues.some((i) => i.check === 'prep')).toBe(false);
    const saved = writes.find((w) => w.sql.includes('INSERT INTO meal_plans'));
    expect(JSON.parse(saved!.args[1] as string)).toMatchObject({ prep: { day: 'sun' } });
  });

  it('keeps the plan with a prep warning, after one call, when the call returns no prep', async () => {
    const { db } = fakeDb(household());
    const fetchMock = stubClaude(claudeInput());

    const res = await post(`${H}/plan`, REQUEST, makeEnv(db));

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
    const { db } = fakeDb(household({ prepDay: null }));
    const fetchMock = stubClaude(claudeInput({ day: 'sun', steps: [{ id: 's', task: 'Cook rice', minutes: 20, forMeals: [] }] }));

    const res = await post(`${H}/plan`, REQUEST, makeEnv(db));

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
  const get = (path: string, env: unknown) =>
    app.request(path, { method: 'GET', headers: { cookie: 'ap_session=valid-token' } }, env as never);

  it('rejects a Thursday weekOf on POST /plan, GET /plan and the prep route with the schema message', async () => {
    const { db } = fakeDb(household());
    const fetchMock = stubClaude(claudeInput());

    const planRes = await post(`${H}/plan`, { ...REQUEST, weekOf: '2026-11-12' }, makeEnv(db));
    expect(planRes.status).toBe(400);
    expect(await planRes.text()).toContain(SUNDAY_MESSAGE);

    const getRes = await get(`${H}/plan/2026-11-12`, makeEnv(db));
    expect(getRes.status).toBe(400);
    expect(await getRes.text()).toBe(SUNDAY_MESSAGE);

    const prepRes = await post(`${H}/plan/2026-11-12/prep`, {}, makeEnv(db));
    expect(prepRes.status).toBe(400);
    expect(await prepRes.text()).toBe(SUNDAY_MESSAGE);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a Sunday on GET /plan (no saved plan yet, so 404)', async () => {
    const { db } = fakeDb(household());
    const res = await get(`${H}/plan/2026-11-15`, makeEnv(db));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('No plan for this week');
  });
});

