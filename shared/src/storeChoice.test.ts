// Store choice beyond the cheapest total: the ranked 'prefer' mode, pins to a store, and receipt estimates.
import { describe, expect, it } from 'vitest';
import { HouseholdSchema, ItemRuleSchema, defaultHousehold, type Household } from './index';
import { DEFAULT_STORE_PREFERENCE } from './stores';
import { estimateOffers, collectOffers, type Offer } from './offers';
import { buildList, pinsOf, validate, type ValidateContext } from './validate';
import { INGREDIENTS } from './catalog';
import type { FixedCost } from './fixed';
import type { ItemRule } from './index';
import type { ListItem, MealPlan, PlannedMeal } from './plan';
import type { Deal } from './scoring';

const NO_FIXED: FixedCost = { cost: 0, listItems: [], macrosByPerson: {}, leftovers: [], needs: [], issues: [] };

function deal(ingredientId: string, store: string, pricePerUnit: number, packQty = 1): Deal {
  return { ingredientId, store, pricePerUnit, packQty, packPrice: pricePerUnit * packQty, discountPct: 0, baseline: pricePerUnit, validTo: '2026-11-18', score: 0 };
}

/** One meal that needs the given ingredients, in kg. */
function meal(ingredients: { id: string; qty: number }[]): PlannedMeal[] {
  return [
    {
      id: 'm1',
      day: 'mon',
      slot: 'dinner',
      name: 'Test dinner',
      eaters: ['ann'],
      ingredients: ingredients.map((i) => ({ ingredientId: i.id, qty: i.qty, unit: 'kg' as const })),
      activeMinutes: 10,
      steps: [],
      tags: [],
    },
  ];
}

const totalOf = (list: ListItem[]) => list.reduce((s, i) => s + i.total, 0);
const storeOf = (list: ListItem[], id: string) => list.find((i) => i.ingredientId === id)?.store;

describe('buildList: prefer mode (ranked stores)', () => {
  // broccoli: A $5, B $3. spinach: A $1, B $4. One kg each. A is ranked first.
  const deals = [deal('broccoli', 'A', 5), deal('broccoli', 'B', 3), deal('spinach', 'A', 1), deal('spinach', 'B', 4)];
  const both = meal([{ id: 'broccoli', qty: 1 }, { id: 'spinach', qty: 1 }]);

  it('keeps the top-ranked store when the cheaper one saves less than minSaving', () => {
    // Cheapest split is broccoli at B and spinach at A: $4. Switching broccoli to B saves $2 across the list, under $3.
    const cheapest = buildList(both, NO_FIXED, deals, [], ['A', 'B'], 2);
    expect(totalOf(cheapest)).toBe(4);
    const prefer = buildList(both, NO_FIXED, deals, [], ['A', 'B'], 2, [], [], {
      preference: { mode: 'prefer', minSaving: 3 },
    });
    expect(new Set(prefer.map((i) => i.store))).toEqual(new Set(['A']));
    expect(totalOf(prefer)).toBe(6);
  });

  it('switches to a lower-ranked store when it saves at least minSaving, exactly at the boundary included', () => {
    const exact = [deal('broccoli', 'A', 7), deal('broccoli', 'B', 4)];
    const list = buildList(meal([{ id: 'broccoli', qty: 1 }]), NO_FIXED, exact, [], ['A', 'B'], 2, [], [], {
      preference: { mode: 'prefer', minSaving: 3 },
    });
    expect(list[0]).toMatchObject({ store: 'B', total: 4 });
  });

  it('does not switch when the saving is just under minSaving', () => {
    const under = [deal('broccoli', 'A', 6.99), deal('broccoli', 'B', 4)];
    const list = buildList(meal([{ id: 'broccoli', qty: 1 }]), NO_FIXED, under, [], ['A', 'B'], 2, [], [], {
      preference: { mode: 'prefer', minSaving: 3 },
    });
    expect(list[0]!.store).toBe('A');
  });

  it('with minSaving 0 is the same as the cheapest mode on this list', () => {
    const cheapest = buildList(both, NO_FIXED, deals, [], ['A', 'B'], 2);
    const prefer = buildList(both, NO_FIXED, deals, [], ['A', 'B'], 2, [], [], { preference: { mode: 'prefer', minSaving: 0 } });
    expect(prefer.map((i) => [i.ingredientId, i.store])).toEqual(cheapest.map((i) => [i.ingredientId, i.store]));
  });

  it('gives a near tie to the store ranked first, whichever order the stores are in', () => {
    const ab = buildList(both, NO_FIXED, deals, [], ['A', 'B'], 1, [], [], { preference: { mode: 'prefer', minSaving: 3 } });
    const ba = buildList(both, NO_FIXED, deals, [], ['B', 'A'], 1, [], [], { preference: { mode: 'prefer', minSaving: 3 } });
    expect(new Set(ab.map((i) => i.store))).toEqual(new Set(['A']));
    expect(new Set(ba.map((i) => i.store))).toEqual(new Set(['B']));
  });

  it('keeps the cheapest mode for the same list, so the store order does not matter there', () => {
    const list = buildList(both, NO_FIXED, deals, [], ['B', 'A'], 2, [], [], { preference: { mode: 'cheapest', minSaving: 3 } });
    expect(totalOf(list)).toBe(4);
  });

  it('takes a saving on one item when it is large enough, and keeps the rest at the preferred store', () => {
    const d = [deal('broccoli', 'A', 5), deal('broccoli', 'B', 1), deal('spinach', 'A', 1), deal('spinach', 'B', 1.5)];
    const list = buildList(both, NO_FIXED, d, [], ['A', 'B'], 2, [], [], { preference: { mode: 'prefer', minSaving: 3 } });
    expect(storeOf(list, 'broccoli')).toBe('B');
    expect(storeOf(list, 'spinach')).toBe('A');
  });
});

describe('buildList: pins', () => {
  // broccoli: A $5, B $3. spinach: A $4, B $1.
  const deals = [deal('broccoli', 'A', 5), deal('broccoli', 'B', 3), deal('spinach', 'A', 4), deal('spinach', 'B', 1)];
  const both = meal([{ id: 'broccoli', qty: 1 }, { id: 'spinach', qty: 1 }]);

  it('buys a pinned item at its store, even when another enabled store is cheaper for it', () => {
    const list = buildList(both, NO_FIXED, deals, [], ['A', 'B'], 2, [], [], { pins: [{ ingredientId: 'broccoli', store: 'A' }] });
    expect(storeOf(list, 'broccoli')).toBe('A');
    expect(list.find((i) => i.ingredientId === 'broccoli')).toMatchObject({ pinned: true, total: 5 });
    expect(storeOf(list, 'spinach')).toBe('B');
  });

  it('counts the pinned store toward the store limit', () => {
    const list = buildList(both, NO_FIXED, deals, [], ['A', 'B'], 1, [], [], { pins: [{ ingredientId: 'broccoli', store: 'A' }] });
    expect(new Set(list.map((i) => i.store))).toEqual(new Set(['A']));
    expect(totalOf(list)).toBe(9);
  });

  it('lists a pinned item with no known price under its store, with the quantity and priceUnknown', () => {
    const list = buildList(meal([{ id: 'eggs-large', qty: 0.7 }]), NO_FIXED, [], [], ['A', 'B'], 2, [], [], {
      pins: [{ ingredientId: 'eggs-large', store: 'B' }],
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ store: 'B', pinned: true, priceUnknown: true, total: 0, needed: 0.7 });
  });

  it('prices a pinned item from a receipt estimate when no flyer prices its store', () => {
    const est: Offer[] = [{ ingredientId: 'broccoli', store: 'A', pricePerUnit: 5, packQty: 1, packPrice: 5, estimate: { basis: 'receipt', date: '2026-10-28' } }];
    const list = buildList(meal([{ id: 'broccoli', qty: 1 }]), NO_FIXED, [deal('broccoli', 'B', 3)], [], ['A', 'B'], 2, [], [], {
      pins: [{ ingredientId: 'broccoli', store: 'A' }],
      estimates: est,
    });
    expect(list[0]).toMatchObject({ store: 'A', total: 5, estimate: { basis: 'receipt', date: '2026-10-28' } });
  });

  it('is ignored for a store that is not enabled, and validate reports it', () => {
    const list = buildList(both, NO_FIXED, deals, [], ['A', 'B'], 2, [], [], { pins: [{ ingredientId: 'broccoli', store: 'C' }] });
    expect(storeOf(list, 'broccoli')).toBe('B');
    expect(list.find((i) => i.ingredientId === 'broccoli')!.pinned).toBeUndefined();
  });

  it('does nothing for an ingredient that is not on the list', () => {
    const list = buildList(both, NO_FIXED, deals, [], ['A', 'B'], 2, [], [], { pins: [{ ingredientId: 'eggs-large', store: 'A' }] });
    expect(list.some((i) => i.ingredientId === 'eggs-large')).toBe(false);
  });
});

describe('pinsOf', () => {
  it('takes always-buy rules with a store, and pin rules, once per ingredient', () => {
    const rules: ItemRule[] = [
      { id: '1', name: 'eggs', rule: 'always', store: 'Costco' },
      { id: '2', name: 'eggs', rule: 'pin', store: 'Walmart', ingredientId: 'eggs-large' },
      { id: '3', name: 'milk', rule: 'always' },
      { id: '4', name: 'bananas', rule: 'pin', store: 'Costco', ingredientId: 'bananas' },
      { id: '5', name: 'beef', rule: 'never', store: 'Costco' },
    ];
    expect(pinsOf(rules)).toEqual([
      { ingredientId: 'eggs-large', store: 'Costco' },
      { ingredientId: 'bananas', store: 'Costco' },
    ]);
  });

  it('leaves out a rule that names no catalogue ingredient', () => {
    expect(pinsOf([{ id: '1', name: 'zzz unknown thing', rule: 'pin', store: 'A' }])).toEqual([]);
  });
});

describe('estimateOffers and collectOffers', () => {
  it('keeps the most recent receipt price per ingredient and store, inside the window', () => {
    const offers = estimateOffers(
      [
        { ingredientId: 'canned-tuna', store: 'Loblaws', date: '2026-10-01', pricePerUnit: 2.1 },
        { ingredientId: 'canned-tuna', store: 'Loblaws', date: '2026-10-28', pricePerUnit: 2.39 },
        { ingredientId: 'canned-tuna', store: 'Loblaws', date: '2026-07-01', pricePerUnit: 9 },
        { ingredientId: 'canned-tuna', store: 'Metro', date: '2026-10-30', pricePerUnit: 2.5, packQty: 1 },
      ],
      '2026-08-01',
      '2026-11-05',
    );
    const loblaws = offers.find((o) => o.store === 'Loblaws')!;
    expect(loblaws).toMatchObject({ pricePerUnit: 2.39, packQty: 1, packPrice: 2.39, estimate: { basis: 'receipt', date: '2026-10-28' } });
    expect(offers.find((o) => o.store === 'Metro')).toBeDefined();
    expect(offers).toHaveLength(2);
  });

  it('prices a weight pack as bought: the pack size times the price per base unit', () => {
    const [o] = estimateOffers([{ ingredientId: 'chicken-breast-boneless', store: 'Loblaws', date: '2026-10-28', pricePerUnit: 6.5833, packQty: 0.84 }], '2026-08-01', '2026-11-05');
    expect(o).toMatchObject({ packQty: 0.84 });
    expect(o!.packPrice).toBeCloseTo(5.53, 2);
  });

  it('drops a row with a price of zero or less, and one outside the window', () => {
    expect(
      estimateOffers([{ ingredientId: 'canned-tuna', store: 'Loblaws', date: '2026-10-28', pricePerUnit: 0 }], '2026-08-01', '2026-11-05'),
    ).toEqual([]);
  });

  it('uses a receipt estimate only where no flyer prices that store, even when the flyer is dearer', () => {
    const est: Offer[] = [
      { ingredientId: 'broccoli', store: 'A', pricePerUnit: 1, packQty: 1, packPrice: 1, estimate: { basis: 'receipt', date: '2026-10-28' } },
      { ingredientId: 'broccoli', store: 'B', pricePerUnit: 1, packQty: 1, packPrice: 1, estimate: { basis: 'receipt', date: '2026-10-28' } },
    ];
    const offers = collectOffers([deal('broccoli', 'A', 5)], [], () => true, est).get('broccoli')!;
    expect(offers.find((o) => o.store === 'A')).toMatchObject({ pricePerUnit: 5 });
    expect(offers.find((o) => o.store === 'A')!.estimate).toBeUndefined();
    expect(offers.find((o) => o.store === 'B')!.estimate).toEqual({ basis: 'receipt', date: '2026-10-28' });
  });

  it('lets an estimate win the store choice when it is the cheapest', () => {
    const est: Offer[] = [{ ingredientId: 'broccoli', store: 'B', pricePerUnit: 2, packQty: 1, packPrice: 2, estimate: { basis: 'receipt', date: '2026-10-28' } }];
    const list = buildList(meal([{ id: 'broccoli', qty: 1 }]), NO_FIXED, [deal('broccoli', 'A', 5)], [], ['A', 'B'], 1, [], [], { estimates: est });
    expect(list[0]).toMatchObject({ store: 'B', total: 2, estimate: { basis: 'receipt', date: '2026-10-28' } });
  });
});

describe('validate: pins', () => {
  const broccoli = INGREDIENTS.find((i) => i.id === 'broccoli')!;

  function planWith(list: ListItem[]): MealPlan {
    return {
      weekOf: '2026-11-08',
      request: { weekOf: '2026-11-08', budget: 150, cravings: [], overrides: [], useItUp: false },
      meals: [],
      fixedMeals: [],
      list,
      stores: [],
      totalCost: 0,
      fixedCost: 0,
      issues: [],
      attempts: 0,
      generatedAt: '2026-11-05T00:00:00Z',
      notes: '',
    };
  }

  function ctxWith(household: Household): ValidateContext {
    return {
      household,
      cells: [],
      fixed: NO_FIXED,
      available: new Set(),
      neverBuy: new Set(),
      recentDinnerNames: [],
    };
  }

  function householdWith(stores: { name: string; enabled: boolean }[], rules: ItemRule[], maxStores = 2): Household {
    const h = defaultHousehold();
    return {
      ...h,
      maxStores,
      stores: stores.map((s) => ({ id: s.name.toLowerCase(), name: s.name, enabled: s.enabled, priceMatches: false })),
      itemRules: rules,
    };
  }

  const item = (ingredientId: string, store: string, name: string): ListItem => ({
    ingredientId,
    name,
    category: 'produce',
    store,
    packs: 1,
    packQty: 1,
    packPrice: 5,
    total: 5,
    usedIn: ['m1'],
    pinned: true,
  });

  it('warns when a pinned store is turned off', () => {
    const h = householdWith([{ name: 'Costco', enabled: false }, { name: 'Walmart', enabled: true }], [
      { id: 'r1', name: 'broccoli', rule: 'pin', store: 'Costco', ingredientId: broccoli.id },
    ]);
    const issues = validate(planWith([item(broccoli.id, 'Walmart', 'Broccoli')]), ctxWith(h)).filter((i) => i.check === 'pin');
    expect(issues).toEqual([
      expect.objectContaining({ severity: 'warning', message: 'Broccoli is pinned to Costco, which is turned off. Turn Costco on, or remove the pin.' }),
    ]);
  });

  it('warns when the pins name more stores than the household allows', () => {
    const h = householdWith(
      [{ name: 'A', enabled: true }, { name: 'B', enabled: true }, { name: 'C', enabled: true }],
      [
        { id: 'r1', name: 'x', rule: 'pin', store: 'A', ingredientId: broccoli.id },
        { id: 'r2', name: 'y', rule: 'pin', store: 'B', ingredientId: 'spinach' },
        { id: 'r3', name: 'z', rule: 'pin', store: 'C', ingredientId: 'eggs-large' },
      ],
      2,
    );
    const list = [item(broccoli.id, 'A', 'Broccoli'), item('spinach', 'B', 'Spinach'), item('eggs-large', 'C', 'Eggs')];
    const issues = validate(planWith(list), ctxWith(h)).filter((i) => i.check === 'pin');
    expect(issues.map((i) => i.message)).toEqual(['Pins use 3 stores, more than your limit of 2. Remove a pin, or raise the limit.']);
  });

  it('says nothing when every pin is followed', () => {
    const h = householdWith([{ name: 'Costco', enabled: true }], [{ id: 'r1', name: 'broccoli', rule: 'pin', store: 'Costco', ingredientId: broccoli.id }]);
    expect(validate(planWith([item(broccoli.id, 'Costco', 'Broccoli')]), ctxWith(h)).filter((i) => i.check === 'pin')).toEqual([]);
  });
});

describe('household schema: store preference and pins', () => {
  it('gives a household stored before store preferences the default', () => {
    const { storePreference: _unused, ...old } = defaultHousehold();
    const parsed = HouseholdSchema.parse(old);
    expect(parsed.storePreference).toEqual(DEFAULT_STORE_PREFERENCE);
  });

  it('keeps a saved preference, and refuses a saving outside 0 to 50', () => {
    const base = defaultHousehold();
    expect(HouseholdSchema.parse({ ...base, storePreference: { mode: 'cheapest', minSaving: 0 } }).storePreference).toEqual({ mode: 'cheapest', minSaving: 0 });
    expect(HouseholdSchema.safeParse({ ...base, storePreference: { mode: 'prefer', minSaving: 51 } }).success).toBe(false);
    expect(HouseholdSchema.safeParse({ ...base, storePreference: { mode: 'prefer', minSaving: -1 } }).success).toBe(false);
  });

  it('accepts a pin rule and an always-buy rule with a store, and older rules without them', () => {
    expect(ItemRuleSchema.safeParse({ id: '1', name: 'eggs', rule: 'pin', store: 'Costco', ingredientId: 'eggs-large' }).success).toBe(true);
    expect(ItemRuleSchema.safeParse({ id: '2', name: 'milk', rule: 'always', store: 'Costco' }).success).toBe(true);
    expect(ItemRuleSchema.safeParse({ id: '3', name: 'milk', rule: 'always' }).success).toBe(true);
    expect(ItemRuleSchema.safeParse({ id: '4', name: 'milk', rule: 'sometimes' }).success).toBe(false);
  });
});
