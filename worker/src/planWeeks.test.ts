// Week windows, flyer price fallbacks and the Sunday retention pass, against the real Worker app.
// In-memory D1 stub, stubbed fetch for Claude, fake Date only. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAYS, SLOTS, defaultHousehold, retentionCutoff, type Household, type PlanRequest } from '@provisions/shared';
import { app, runSunday } from './index';

const H = '/provisions/api';
const NOW = '2026-11-05T17:00:00Z'; // Thursday; the current plan week starts Sunday 2026-11-01.

function household(over: Partial<Household> = {}): Household {
  const people = [
    { id: 'ann', name: 'Ann', dietTags: [], allergies: [] },
    { id: 'ben', name: 'Ben', dietTags: [], allergies: [] },
  ];
  const schedule = Object.fromEntries(
    people.map((p) => [p.id, Object.fromEntries(DAYS.map((d) => [d, Object.fromEntries(SLOTS.map((s) => [s, true]))]))]),
  );
  return { ...defaultHousehold(), people, schedule, prepDay: 'sun', ...over };
}

interface FlyerRowLike {
  id: string;
  store: string;
  raw_name: string;
  price_text: string;
  size_text: string | null;
  valid_from: string;
  valid_to: string;
  source: string;
}

const flyerRow = (id: string, validFrom: string, validTo: string): FlyerRowLike => ({
  id,
  store: 'No Frills',
  raw_name: `Item ${id}`,
  price_text: '$1.99',
  size_text: null,
  valid_from: validFrom,
  valid_to: validTo,
  source: 'flipp',
});

/**
 * A D1 stub. The flyer query filters `valid_from <= x AND valid_to >= y` in memory, which covers both
 * the single-day query (x = y = date) and the overlap query (x = to, y = from).
 */
function fakeDb(stored: Household, flyers: FlyerRowLike[] = []) {
  const writes: { sql: string; args: unknown[] }[] = [];
  const deletes: { sql: string; args: unknown[] }[] = [];
  const session = { email: 'owner@example.com', expires_at: Date.now() + 365 * 86_400_000 };

  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) {
          args = values;
          return stmt;
        },
        async first() {
          if (sql === 'SELECT email, expires_at FROM sessions WHERE id_hash = ?') return session;
          if (sql === 'SELECT data FROM household WHERE id = 1') return { data: JSON.stringify(stored) };
          return null;
        },
        async run() {
          if (sql.startsWith('DELETE')) deletes.push({ sql, args });
          else writes.push({ sql, args });
          return { meta: { changes: 2 } };
        },
        async all() {
          if (sql.includes('FROM flyer_items')) {
            const [x, y] = args as string[];
            return { results: flyers.filter((f) => f.valid_from <= x! && f.valid_to >= y!) };
          }
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  return { db, writes, deletes };
}

const makeEnv = (db: unknown) =>
  ({
    DB: db,
    ALLOWED_EMAILS: 'owner@example.com',
    ANTHROPIC_API_KEY: 'test-key',
    ASSETS: { fetch: async () => new Response('asset') },
    DEV: '0',
  }) as never;

function claudeInput() {
  const meals = DAYS.flatMap((d) =>
    SLOTS.map((s) => ({ id: `${d}-${s}`, slotId: `${d}-${s}`, name: `${d} ${s}`, ingredients: [], activeMinutes: 10, steps: [], tags: [] })),
  );
  return { meals, notes: 'fake' };
}

function stubClaude() {
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_plan', input: claudeInput() }] }), {
        status: 200,
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const post = (body: unknown, env: unknown) =>
  app.request(
    `${H}/plan`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'ap_session=valid-token' },
      body: JSON.stringify(body),
    },
    env as never,
  );

const request = (weekOf: string): PlanRequest => ({ weekOf, budget: 150, cravings: [], overrides: [], useItUp: false });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('POST /plan week window', () => {
  it('refuses a week before the current plan week', async () => {
    const { db } = fakeDb(household());
    const res = await post(request('2026-10-25'), makeEnv(db));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('You can plan this week or up to 2 weeks ahead.');
  });

  it('refuses a week more than two weeks ahead', async () => {
    const { db } = fakeDb(household());
    const res = await post(request('2026-11-22'), makeEnv(db));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('You can plan this week or up to 2 weeks ahead.');
  });

  it('accepts this week and two weeks ahead', async () => {
    const fetchMock = stubClaude();
    for (const weekOf of ['2026-11-01', '2026-11-15']) {
      const { db } = fakeDb(household());
      const res = await post(request(weekOf), makeEnv(db));
      expect(res.status).toBe(200);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('still refuses a weekOf that is not a Sunday, with the Sunday message', async () => {
    const { db } = fakeDb(household());
    const res = await post(request('2026-11-12'), makeEnv(db));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('weekOf must be a Sunday (YYYY-MM-DD)');
  });
});

describe('POST /plan flyer prices for a week', () => {
  const sunday = '2026-11-15'; // two weeks ahead

  async function planFor(flyers: FlyerRowLike[]) {
    stubClaude();
    const { db } = fakeDb(household(), flyers);
    const res = await post(request(sunday), makeEnv(db));
    expect(res.status).toBe(200);
    return (await res.json()) as { priceSource?: string; issues: { check: string; severity: string; message: string }[] };
  }

  it('prices from the flyers valid on the Sunday when there are any', async () => {
    const plan = await planFor([flyerRow('a', '2026-11-12', '2026-11-18'), flyerRow('b', '2026-11-20', '2026-11-26')]);
    expect(plan.priceSource).toBe('week');
    expect(plan.issues.some((i) => i.check === 'prices')).toBe(false);
  });

  it('falls back to flyers that overlap the week, without a warning', async () => {
    const plan = await planFor([flyerRow('a', '2026-11-17', '2026-11-23')]);
    expect(plan.priceSource).toBe('overlap');
    expect(plan.issues.some((i) => i.check === 'prices')).toBe(false);
  });

  it('falls back to flyers valid today and warns when the week is in the future', async () => {
    const plan = await planFor([flyerRow('a', '2026-11-01', '2026-11-07')]);
    expect(plan.priceSource).toBe('current');
    expect(plan.issues).toContainEqual({
      check: 'prices',
      severity: 'warning',
      message: "Prices are estimates from the current flyer; next week's flyers aren't out yet.",
    });
  });

  it('uses overlapping flyers for this week without a warning, since today is inside it', async () => {
    stubClaude();
    const { db } = fakeDb(household(), [flyerRow('a', '2026-11-02', '2026-11-07')]);
    const res = await post(request('2026-11-01'), makeEnv(db));
    const plan = (await res.json()) as { priceSource?: string; issues: { check: string }[] };
    expect(plan.priceSource).toBe('overlap');
    expect(plan.issues.some((i) => i.check === 'prices')).toBe(false);
  });
});

describe('the Sunday job', () => {
  it('refreshes the flyers, then deletes plans and ticks older than the retention window', async () => {
    const { db, deletes } = fakeDb(household());
    await runSunday(makeEnv(db) as never);

    const cutoff = retentionCutoff(new Date());
    expect(cutoff).toBe('2026-08-09'); // twelve weeks before the current plan week, 2026-11-01
    expect(deletes.map((d) => d.sql)).toEqual(['DELETE FROM meal_plans WHERE week_of < ?', 'DELETE FROM checks WHERE week_of < ?']);
    expect(deletes.every((d) => d.args[0] === cutoff)).toBe(true);
  });

  it('still deletes old weeks when the flyer refresh throws', async () => {
    const { db, deletes } = fakeDb(household());
    const broken = {
      prepare(sql: string) {
        if (sql === 'SELECT data FROM household WHERE id = 1') {
          return { bind: () => ({}), first: async () => { throw new Error('boom'); } } as never;
        }
        return db.prepare(sql);
      },
    } as unknown as D1Database;

    await expect(runSunday(makeEnv(broken) as never)).rejects.toThrow('boom');
    expect(deletes).toHaveLength(2);
  });
});

