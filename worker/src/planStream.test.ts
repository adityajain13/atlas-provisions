// POST /plan with `Accept: application/x-ndjson` streams progress lines and ends with a done or error line. Without the
// header the response is the plain JSON plan, as before. Claude is stubbed; no network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAYS, SLOTS, defaultHousehold, type Household, type PlanRequest } from '@provisions/shared';
import { API, OWNER, call, householdWith, json, setup } from './testing/app';
import { sseResponse, toolReply } from './testing/sse';

const H = API;
const KEYED = { ANTHROPIC_API_KEY: 'test-key' };
const REQUEST: PlanRequest = { weekOf: '2026-11-15', budget: 150, cravings: [], overrides: [], useItUp: false };

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

/** Claude's answer: one meal per slot with no ingredients, so nothing is over budget or unknown. */
function claudeInput() {
  const meals = DAYS.flatMap((d) =>
    SLOTS.map((s) => ({ id: `${d}-${s}`, slotId: `${d}-${s}`, name: `${d} ${s}`, ingredients: [], activeMinutes: 10, steps: [], tags: [] })),
  );
  return { meals, notes: 'fake' };
}

function stubClaude(input: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        toolReply(input),
    ),
  );
}

/** A POST that asks for the streamed form of the response. */
const streamed = (body: unknown, cookie: string): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie, accept: 'application/x-ndjson' },
  body: JSON.stringify(body),
});

/** The lines of a streamed body, parsed. Every line is one JSON object. */
async function linesOf(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-05T17:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('POST /plan with x-ndjson', () => {
  it('streams the stages in order and ends with the saved plan', async () => {
    const { raw, env, cookies } = await setup([OWNER], KEYED);
    await householdWith(raw, env, cookies[OWNER]!, OWNER, household());
    stubClaude(claudeInput());

    const res = await call(`${H}/plan`, streamed(REQUEST, cookies[OWNER]!), env);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const lines = await linesOf(res);
    expect(lines.map((l) => l.stage)).toEqual(['writing', 'checking', 'saving', 'done']);
    expect(lines[0]).toEqual({ stage: 'writing', attempt: 1 });
    const done = lines[3] as { plan: { meals: unknown[]; attempts: number; timings: { attempts: { mode: string }[] } } };
    expect(done.plan.meals).toHaveLength(21);
    expect(done.plan.attempts).toBe(1);
    expect(done.plan.timings.attempts.map((a) => a.mode)).toEqual(['full']);
  });

  it('ends with an error line when the planner fails after the stream has started', async () => {
    const { raw, env, cookies } = await setup([OWNER], KEYED);
    await householdWith(raw, env, cookies[OWNER]!, OWNER, household());
    vi.stubGlobal('fetch', vi.fn(async () => new Response('overloaded', { status: 500 })));

    const res = await call(`${H}/plan`, streamed(REQUEST, cookies[OWNER]!), env);

    expect(res.status).toBe(200);
    const lines = await linesOf(res);
    const last = lines[lines.length - 1]!;
    expect(last).toMatchObject({ stage: 'error', status: 500 });
    expect(String(last.message)).toContain('Claude API returned 500');
  });

  it('ends with the error message when Claude sends an error event mid-reply', async () => {
    const { raw, env, cookies } = await setup([OWNER], KEYED);
    await householdWith(raw, env, cookies[OWNER]!, OWNER, household());
    const events = [
      { event: 'message_start', data: { type: 'message_start', message: {} } },
      { event: 'error', data: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(events)));

    const res = await call(`${H}/plan`, streamed(REQUEST, cookies[OWNER]!), env);

    const lines = await linesOf(res);
    expect(lines[lines.length - 1]).toMatchObject({ stage: 'error', status: 500 });
    expect(String(lines[lines.length - 1]!.message)).toBe('Claude API stream failed: overloaded_error: Overloaded');
  });

  it('keeps the plain JSON response when the header is absent, with the timings in the plan', async () => {
    const { raw, env, cookies } = await setup([OWNER], KEYED);
    await householdWith(raw, env, cookies[OWNER]!, OWNER, household());
    stubClaude(claudeInput());

    const res = await call(`${H}/plan`, json('POST', REQUEST, cookies[OWNER]), env);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const plan = (await res.json()) as { meals: unknown[]; timings: { totalMs: number; attempts: unknown[] } };
    expect(plan.meals).toHaveLength(21);
    expect(plan.timings.attempts).toHaveLength(1);
    expect(plan.timings.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('answers a request with no plannable week with the usual 400, not a stream', async () => {
    const { raw, env, cookies } = await setup([OWNER], KEYED);
    await householdWith(raw, env, cookies[OWNER]!, OWNER, household());

    const res = await call(`${H}/plan`, streamed({ ...REQUEST, weekOf: '2026-12-06' }, cookies[OWNER]!), env);

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).not.toContain('ndjson');
  });
});
