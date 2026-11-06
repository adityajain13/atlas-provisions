// Guests joining a swap: POST /plan/:weekOf/swap with `guests`. The guests eat the swapped slots, their allergies are
// checked there, and the marks on the meals a swap replaces go. Against the real Worker app with an in-memory database
// and a stubbed Anthropic fetch. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAYS, SLOTS, defaultHousehold, expandWeek, type Household, type MealPlan, type PlanRequest } from '@provisions/shared';
import { API, OWNER, call, householdWith, json, rows, setup } from './testing/app';
import { toolReply } from './testing/sse';
import { sentPlannerPayload } from './testing/payload';

const WEEK = '2026-11-08';
const KEYED = { ANTHROPIC_API_KEY: 'test-key' };
const REQUEST: PlanRequest = { weekOf: WEEK, budget: 150, cravings: [], overrides: [], useItUp: false };

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

/** A saved week: one meal per cell, with the leftover chain Mon dinner -> Tue lunch. */
function storedPlan(doc: Household): MealPlan {
  const meals = expandWeek(doc, REQUEST).cells.map((c) => {
    const id = `${c.day}-${c.slot}`;
    const link = id === 'mon-dinner' ? { makesLeftoversFor: 'tue-lunch' } : id === 'tue-lunch' ? { usesLeftoversFrom: 'mon-dinner' } : {};
    return { id, day: c.day, slot: c.slot, name: `Meal ${id}`, eaters: [...c.eaters], ingredients: [], activeMinutes: 10, steps: ['Cook'], tags: [], ...link };
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

const claudeReply = (input: unknown) =>
  toolReply(input);

interface Sent {
  slots: { id: string; eaters: string[] }[];
  allergies: Record<string, string[]>;
}
const sentPayload = (init: RequestInit): Sent => sentPlannerPayload(JSON.parse(init.body as string)) as unknown as Sent;

/** One answer per slot the model is asked for. `ingredientsFor` lets a test put an ingredient in a chosen slot. */
const answerFor = (payload: Sent, ingredientsFor: (slot: string) => { id: string; qty: number }[] = () => []) => ({
  notes: 'swapped',
  meals: payload.slots.map((s) => ({
    id: s.id,
    slotId: s.id,
    name: `New ${s.id}`,
    ingredients: ingredientsFor(s.id),
    activeMinutes: 10,
    steps: ['Cook'],
    tags: [],
  })),
});

/** Stubs fetch with one answer per call, in order (the last repeats). */
function stubClaude(answer: (payload: Sent) => unknown = (p) => answerFor(p)) {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => claudeReply(answer(sentPayload(init))));
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

async function withPlan() {
  const { raw, env, cookies } = await setup([OWNER], KEYED);
  const hh = await householdWith(raw, env, cookies[OWNER]!, OWNER, household());
  const plan = storedPlan(household());
  raw.prepare('INSERT INTO meal_plans (household_id, week_of, data, created_at) VALUES (?, ?, ?, ?)').run(hh, WEEK, JSON.stringify(plan), plan.generatedAt);
  return { raw, env, cookie: cookies[OWNER]!, hh };
}

const swap = (body: unknown, cookie: string, env: never) => call(`${API}/plan/${WEEK}/swap`, json('POST', body, cookie), env);
const savedPlan = (raw: Parameters<typeof rows>[0], hh: string) =>
  JSON.parse(rows<{ data: string }>(raw, 'SELECT data FROM meal_plans WHERE household_id = ? AND week_of = ?', hh, WEEK)[0]!.data) as MealPlan;

describe('POST /plan/:weekOf/swap with guests', () => {
  it('seats the guests in every swapped slot, keeps their allergies on the plan, and leaves the other slots alone', async () => {
    const { raw, env, cookie, hh } = await withPlan();
    const fetchMock = stubClaude();

    const res = await swap({ mealIds: ['mon-dinner'], guests: { count: 2, allergies: [' Peanut '] } }, cookie, env as never);

    expect(res.status).toBe(200);
    const plan = savedPlan(raw, hh);
    const eaters = (id: string) => plan.meals.find((m) => m.id === id)!.eaters;
    expect(eaters('mon-dinner')).toEqual(['ann', 'ben', 'guest-1', 'guest-2']);
    expect(eaters('tue-lunch')).toEqual(['ann', 'ben', 'guest-1', 'guest-2']);
    expect(eaters('wed-dinner')).toEqual(['ann', 'ben']);
    expect(plan.guests).toEqual({ 'guest-1': { allergies: ['peanut'] }, 'guest-2': { allergies: ['peanut'] } });

    const sent = sentPayload(fetchMock.mock.calls[0]![1] as RequestInit);
    expect(sent.allergies['guest-1']).toEqual(['peanut']);
    expect(sent.allergies['ann']).toBeUndefined(); // a person with no allergies is left out of the payload
  });

  it('holds a guest allergen out of the swapped slot, and names the guest in the error', async () => {
    const { env, cookie } = await withPlan();
    stubClaude((p) => answerFor(p, (slot) => (slot === 'mon-dinner' ? [{ id: 'peanut-butter', qty: 0.05 }] : [])));

    const res = await swap({ mealIds: ['mon-dinner'], guests: { count: 1, allergies: ['peanut'] } }, cookie, env as never);

    const body = (await res.json()) as { issues: { check: string; severity: string; message: string }[] };
    const hits = body.issues.filter((i) => i.check === 'allergen');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((i) => i.severity === 'error' && i.message.includes('Guest 1 is allergic to peanut'))).toBe(true);
  });

  it('does not flag the same allergen in a swap without guests, so the other slots are not affected', async () => {
    const { env, cookie } = await withPlan();
    stubClaude((p) => answerFor(p, (slot) => (slot === 'wed-dinner' ? [{ id: 'peanut-butter', qty: 0.05 }] : [])));

    const res = await swap({ mealIds: ['wed-dinner'] }, cookie, env as never);

    const body = (await res.json()) as { issues: { check: string }[] };
    expect(body.issues.some((i) => i.check === 'allergen')).toBe(false);
  });

  it('gives the next guests fresh ids, so a later swap never reuses the guests already on the plan', async () => {
    const { raw, env, cookie, hh } = await withPlan();
    stubClaude();
    await swap({ mealIds: ['mon-dinner'], guests: { count: 1, allergies: [] } }, cookie, env as never);

    await swap({ mealIds: ['thu-dinner'], guests: { count: 1, allergies: ['dairy'] } }, cookie, env as never);

    const plan = savedPlan(raw, hh);
    expect(plan.meals.find((m) => m.id === 'thu-dinner')!.eaters).toEqual(['ann', 'ben', 'guest-2']);
    expect(plan.guests).toEqual({ 'guest-1': { allergies: [] }, 'guest-2': { allergies: ['dairy'] } });
  });

  it('clears the marks on the meals it replaces, and keeps the marks on the rest of the week', async () => {
    const { raw, env, cookie, hh } = await withPlan();
    stubClaude();
    const mark = raw.prepare('INSERT INTO meal_status (household_id, week_of, meal_id, status, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    mark.run(hh, WEEK, 'mon-dinner', 'skipped', 'ate-out', 'now');
    mark.run(hh, WEEK, 'tue-lunch', 'replaced', null, 'now');
    mark.run(hh, WEEK, 'wed-dinner', 'skipped', 'not-eating', 'now');

    const res = await swap({ mealIds: ['mon-dinner'] }, cookie, env as never);

    expect(res.status).toBe(200);
    const left = rows<{ meal_id: string }>(raw, 'SELECT meal_id FROM meal_status WHERE household_id = ? ORDER BY meal_id', hh).map((r) => r.meal_id);
    expect(left).toEqual(['wed-dinner']);
  });
});
