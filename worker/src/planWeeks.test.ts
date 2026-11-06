// Week windows and flyer price fallbacks, against the real Worker app and an in-memory database.
// Stubbed fetch for Claude, fake Date only. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAYS, SLOTS, defaultHousehold, type Household, type PlanRequest } from '@provisions/shared';
import { API, OWNER, call, householdWith, json, setup } from './testing/app';
import { toolReply } from './testing/sse';

const H = API;
const NOW = '2026-11-05T17:00:00Z'; // Thursday; the current plan week starts Sunday 2026-11-01.
const POSTAL = 'M5V2T6';
const KEYED = { ANTHROPIC_API_KEY: 'test-key' };

function household(over: Partial<Household> = {}): Household {
  const people = [
    { id: 'ann', name: 'Ann', dietTags: [], allergies: [] },
    { id: 'ben', name: 'Ben', dietTags: [], allergies: [] },
  ];
  const schedule = Object.fromEntries(
    people.map((p) => [p.id, Object.fromEntries(DAYS.map((d) => [d, Object.fromEntries(SLOTS.map((s) => [s, true]))]))]),
  );
  return { ...defaultHousehold(), people, schedule, prepDay: 'sun', postalCode: POSTAL, ...over };
}

interface FlyerSeed {
  id: string;
  validFrom: string;
  validTo: string;
  postal?: string;
}

function claudeInput() {
  const meals = DAYS.flatMap((d) =>
    SLOTS.map((s) => ({ id: `${d}-${s}`, slotId: `${d}-${s}`, name: `${d} ${s}`, ingredients: [], activeMinutes: 10, steps: [], tags: [] })),
  );
  return { meals, notes: 'fake' };
}

function stubClaude() {
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) =>
      toolReply(claudeInput()),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const request = (weekOf: string): PlanRequest => ({ weekOf, budget: 150, cravings: [], overrides: [], useItUp: false });

/** A fresh database, the owner's household with the given document, and the flyer rows. */
async function world(flyers: FlyerSeed[] = [], doc: Household = household()) {
  const ctx = await setup([OWNER], KEYED);
  await householdWith(ctx.raw, ctx.env, ctx.cookies[OWNER]!, OWNER, doc);
  for (const f of flyers) {
    ctx.raw
      .prepare(
        `INSERT INTO flyer_items (postal_code, id, store, raw_name, price_text, size_text, valid_from, valid_to, source, fetched_at)
         VALUES (?, ?, 'No Frills', ?, '$1.99', NULL, ?, ?, 'flipp', '2026-10-29T12:00:00.000Z')`,
      )
      .run(f.postal ?? POSTAL, f.id, `Item ${f.id}`, f.validFrom, f.validTo);
  }
  return ctx;
}

const planCall = (weekOf: string, ctx: Awaited<ReturnType<typeof world>>) =>
  call(`${H}/plan`, json('POST', request(weekOf), ctx.cookies[OWNER]), ctx.env);

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
    const ctx = await world();
    const res = await planCall('2026-10-25', ctx);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('You can plan this week or up to 2 weeks ahead.');
  });

  it('refuses a week more than two weeks ahead', async () => {
    const ctx = await world();
    const res = await planCall('2026-11-22', ctx);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('You can plan this week or up to 2 weeks ahead.');
  });

  it('accepts this week and two weeks ahead', async () => {
    const fetchMock = stubClaude();
    for (const weekOf of ['2026-11-01', '2026-11-15']) {
      const ctx = await world();
      const res = await planCall(weekOf, ctx);
      expect(res.status).toBe(200);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('still refuses a weekOf that is not a Sunday, with the Sunday message', async () => {
    const ctx = await world();
    const res = await planCall('2026-11-12', ctx);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('weekOf must be a Sunday (YYYY-MM-DD)');
  });
});

describe('POST /plan flyer prices for a week', () => {
  const sunday = '2026-11-15'; // two weeks ahead

  async function planFor(flyers: FlyerSeed[]) {
    stubClaude();
    const ctx = await world(flyers);
    const res = await planCall(sunday, ctx);
    expect(res.status).toBe(200);
    return (await res.json()) as { priceSource?: string; issues: { check: string; severity: string; message: string }[] };
  }

  it('prices from the flyers valid on the Sunday when there are any', async () => {
    const plan = await planFor([
      { id: 'a', validFrom: '2026-11-12', validTo: '2026-11-18' },
      { id: 'b', validFrom: '2026-11-20', validTo: '2026-11-26' },
    ]);
    expect(plan.priceSource).toBe('week');
    expect(plan.issues.some((i) => i.check === 'prices')).toBe(false);
  });

  it('falls back to flyers that overlap the week, without a warning', async () => {
    const plan = await planFor([{ id: 'a', validFrom: '2026-11-17', validTo: '2026-11-23' }]);
    expect(plan.priceSource).toBe('overlap');
    expect(plan.issues.some((i) => i.check === 'prices')).toBe(false);
  });

  it('falls back to flyers valid today and warns when the week is in the future', async () => {
    const plan = await planFor([{ id: 'a', validFrom: '2026-11-01', validTo: '2026-11-07' }]);
    expect(plan.priceSource).toBe('current');
    expect(plan.issues).toContainEqual({
      check: 'prices',
      severity: 'warning',
      message: "Prices are estimates from the current flyer; next week's flyers aren't out yet.",
    });
  });

  it('uses overlapping flyers for this week without a warning, since today is inside it', async () => {
    stubClaude();
    const ctx = await world([{ id: 'a', validFrom: '2026-11-02', validTo: '2026-11-07' }]);
    const res = await planCall('2026-11-01', ctx);
    const plan = (await res.json()) as { priceSource?: string; issues: { check: string }[] };
    expect(plan.priceSource).toBe('overlap');
    expect(plan.issues.some((i) => i.check === 'prices')).toBe(false);
  });

  it('prices from its own postal code only: another postal code’s flyers are not used', async () => {
    const plan = await planFor([{ id: 'elsewhere', validFrom: '2026-11-12', validTo: '2026-11-18', postal: 'K1A0B1' }]);
    expect(plan.priceSource).toBe('current');
    expect(plan.issues).toContainEqual(expect.objectContaining({ check: 'prices' }));
  });

  it('has no flyer prices at all without a postal code', async () => {
    stubClaude();
    const ctx = await world(
      [{ id: 'a', validFrom: '2026-11-12', validTo: '2026-11-18' }],
      household({ postalCode: undefined }),
    );
    const res = await planCall('2026-11-15', ctx);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { priceSource?: string }).priceSource).toBe('current');
  });
});
