// Store choice through POST /plan, against the real Worker app and an in-memory database. A receipt price stands in
// for a flyer price, and a pin holds an item to its store. Stubbed fetch for Claude, fake Date only. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAYS, SLOTS, defaultHousehold, type Household, type ItemRule, type MealPlan, type PlanRequest } from '@provisions/shared';
import { API, OWNER, call, householdOf, householdWith, json, setup } from './testing/app';
import { toolReply } from './testing/sse';

const NOW = '2026-11-05T17:00:00Z';
const WEEK = '2026-11-15'; // two weeks ahead, so the window allows it
const KEYED = { ANTHROPIC_API_KEY: 'test-key' };

function household(over: Partial<Household> = {}): Household {
  const people = [{ id: 'ann', name: 'Ann', dietTags: [], allergies: [] }];
  const schedule = Object.fromEntries(
    people.map((p) => [p.id, Object.fromEntries(DAYS.map((d) => [d, Object.fromEntries(SLOTS.map((s) => [s, true]))]))]),
  );
  const store = (id: string, name: string) => ({ id, name, enabled: true, priceMatches: false, group: 'Other' as const });
  return {
    ...defaultHousehold(),
    people,
    schedule,
    prepDay: null,
    stores: [store('loblaws', 'Loblaws'), store('costco', 'Costco')],
    maxStores: 2,
    ...over,
  };
}

/** A Claude reply with canned tuna in Monday dinner, and no ingredients in the other meals. */
function claudeInput() {
  const meals = DAYS.flatMap((d) =>
    SLOTS.map((s) => ({
      id: `${d}-${s}`,
      slotId: `${d}-${s}`,
      name: `${d} ${s}`,
      ingredients: d === 'mon' && s === 'dinner' ? [{ id: 'canned-tuna', qty: 2 }] : [],
      activeMinutes: 10,
      steps: [],
      tags: [],
    })),
  );
  return { meals, notes: 'fake' };
}

function stubClaude() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        toolReply(claudeInput()),
    ),
  );
}

const request = (weekOf: string): PlanRequest => ({ weekOf, budget: 150, cravings: [], overrides: [], useItUp: false });

/** A fresh database with the owner's household, and a receipt price for canned tuna at Loblaws on 2026-10-28. */
async function world(doc: Household, receipt = true) {
  const ctx = await setup([OWNER], KEYED);
  await householdWith(ctx.raw, ctx.env, ctx.cookies[OWNER]!, OWNER, doc);
  if (receipt) {
    ctx.raw
      .prepare(
        `INSERT INTO price_history (ingredient_id, store, date, price_per_unit, on_sale, source, household_id, pack_qty)
         VALUES ('canned-tuna', 'Loblaws', '2026-10-28', 2.39, 0, 'receipt', ?, 1)`,
      )
      .run(householdOf(ctx.raw, OWNER));
  }
  return ctx;
}

async function planList(ctx: Awaited<ReturnType<typeof world>>): Promise<MealPlan> {
  const res = await call(`${API}/plan`, json('POST', request(WEEK), ctx.cookies[OWNER]), ctx.env);
  expect(res.status).toBe(200);
  return (await res.json()) as MealPlan;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('POST /plan with receipt prices and pins', () => {
  it('prices an item from the household last receipt when no flyer prices its store', async () => {
    stubClaude();
    const ctx = await world(household({ stores: [{ id: 'loblaws', name: 'Loblaws', enabled: true, priceMatches: false, group: 'Loblaw' }] }));
    const plan = await planList(ctx);
    const tuna = plan.list.find((i) => i.ingredientId === 'canned-tuna')!;
    expect(tuna).toMatchObject({ store: 'Loblaws', packs: 2, total: 4.78, estimate: { basis: 'receipt', date: '2026-10-28' } });
  });

  it('prices the item at its typical price, not a receipt, when the household has no receipt for it', async () => {
    stubClaude();
    const ctx = await world(household({ stores: [{ id: 'loblaws', name: 'Loblaws', enabled: true, priceMatches: false, group: 'Loblaw' }] }), false);
    const plan = await planList(ctx);
    const tuna = plan.list.find((i) => i.ingredientId === 'canned-tuna')!;
    expect(tuna.estimate).toEqual({ basis: 'typical' });
    expect(tuna.store).toBe('Loblaws');
  });

  it('keeps a pinned item at its store, unpriced there when no price is known', async () => {
    stubClaude();
    const rule: ItemRule = { id: 'p1', name: 'Canned tuna', rule: 'pin', store: 'Costco', ingredientId: 'canned-tuna' };
    const ctx = await world(household({ itemRules: [rule] }));
    const plan = await planList(ctx);
    const tuna = plan.list.find((i) => i.ingredientId === 'canned-tuna')!;
    expect(tuna).toMatchObject({ store: 'Costco', pinned: true, priceUnknown: true, needed: 2 });
    expect(plan.issues.some((i) => i.check === 'pin')).toBe(false);
  });

  it('warns when a pinned store is turned off, and still lists the item', async () => {
    stubClaude();
    const rule: ItemRule = { id: 'p1', name: 'Canned tuna', rule: 'pin', store: 'Costco', ingredientId: 'canned-tuna' };
    const doc = household({
      itemRules: [rule],
      stores: [
        { id: 'loblaws', name: 'Loblaws', enabled: true, priceMatches: false, group: 'Loblaw' },
        { id: 'costco', name: 'Costco', enabled: false, priceMatches: false, group: 'Other' },
      ],
    });
    const ctx = await world(doc);
    const plan = await planList(ctx);
    expect(plan.issues.filter((i) => i.check === 'pin').map((i) => i.message)).toEqual([
      'Canned tuna (light, in water) is pinned to Costco, which is turned off. Turn Costco on, or remove the pin.',
    ]);
    expect(plan.list.find((i) => i.ingredientId === 'canned-tuna')!.store).toBe('Loblaws');
  });
});
