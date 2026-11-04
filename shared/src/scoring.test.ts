import { describe, expect, it } from 'vitest';
import { baselineFor, nutrientDensity, scoreDeals, type HistoryPoint, type ScoreOptions } from './scoring';
import type { MatchedItem } from './match';
import { INGREDIENT_BY_ID } from './catalog';

const AS_OF = '2026-11-15'; // a plan week's Sunday

function m(
  ingredientId: string,
  store: string,
  pricePerUnit: number,
  extra: Partial<MatchedItem> = {},
): MatchedItem {
  return {
    id: `${ingredientId}-${store}`,
    store,
    rawName: ingredientId,
    priceText: '',
    validFrom: '2026-11-12',
    validTo: '2026-11-18',
    source: 'fixture',
    ingredientId,
    confidence: 0.9,
    packQty: 0.5,
    pricePerUnit,
    packPrice: pricePerUnit * 0.5,
    ...extra,
  };
}

function h(ingredientId: string, store: string, date: string, pricePerUnit: number): HistoryPoint {
  return { ingredientId, store, date, pricePerUnit };
}

function opts(extra: Partial<ScoreOptions> = {}): ScoreOptions {
  return {
    history: [],
    neverBuy: [],
    alwaysBuy: [],
    allergens: [],
    shoppingDate: AS_OF,
    householdSize: 2,
    ...extra,
  };
}

describe('baselineFor', () => {
  it('uses the median of history inside the 56-day window', () => {
    const history = [
      h('chicken-thigh-boneless', 'A', '2026-09-20', 10),
      h('chicken-thigh-boneless', 'B', '2026-10-01', 12),
      h('chicken-thigh-boneless', 'A', '2026-10-20', 20),
      h('chicken-thigh-boneless', 'A', '2026-11-01', 8),
    ];
    expect(baselineFor('chicken-thigh-boneless', history, [], AS_OF)).toBe(11);
  });

  it('ignores history older than 56 days', () => {
    const history = [
      h('bananas', 'A', '2026-01-01', 99),
      h('bananas', 'A', '2026-01-02', 99),
      h('bananas', 'A', '2026-01-03', 99),
      h('bananas', 'A', '2026-10-01', 2),
    ];
    // Only one point is in the window, so the fallback applies (single store x 1.15).
    expect(baselineFor('bananas', history, [m('bananas', 'A', 1.5)], AS_OF)).toBeCloseTo(1.5 * 1.15);
  });

  it('falls back to the current price x 1.15 when there is one store', () => {
    expect(baselineFor('bananas', [], [m('bananas', 'A', 2)], AS_OF)).toBeCloseTo(2.3);
  });

  it('falls back to the highest current price when several stores carry it', () => {
    const current = [m('bananas', 'A', 2), m('bananas', 'B', 3)];
    expect(baselineFor('bananas', [], current, AS_OF)).toBe(3);
  });

  it('uses the fallback when there are fewer than 3 history points', () => {
    const history = [h('bananas', 'A', '2026-11-01', 50), h('bananas', 'A', '2026-11-02', 50)];
    expect(baselineFor('bananas', history, [m('bananas', 'A', 2)], AS_OF)).toBeCloseTo(2.3);
  });

  it('returns 0 when there is no data at all', () => {
    expect(baselineFor('bananas', [], [], AS_OF)).toBe(0);
  });
});

describe('nutrientDensity', () => {
  it('is clamped to 0..1 and zero for missing weight data', () => {
    const d = nutrientDensity(INGREDIENT_BY_ID['chicken-thigh-boneless']!, 0.5);
    expect(d).toBe(1);
    expect(nutrientDensity(INGREDIENT_BY_ID['eggs-large']!, 0)).toBe(0);
    expect(nutrientDensity(INGREDIENT_BY_ID['canned-tuna']!, 10)).toBeGreaterThan(0);
  });

  it('is higher for cheaper protein', () => {
    const ing = INGREDIENT_BY_ID['chicken-thigh-boneless']!;
    expect(nutrientDensity(ing, 100)).toBeLessThan(nutrientDensity(ing, 40));
  });
});

describe('scoreDeals', () => {
  const history = [
    h('chicken-thigh-boneless', 'A', '2026-10-01', 10),
    h('chicken-thigh-boneless', 'A', '2026-10-15', 10),
    h('chicken-thigh-boneless', 'A', '2026-11-01', 10),
  ];

  it('drops never-buy ingredients', () => {
    const deals = scoreDeals([m('chicken-thigh-boneless', 'A', 5)], opts({ history, neverBuy: ['chicken-thigh-boneless'] }));
    expect(deals).toHaveLength(0);
  });

  it('drops ingredients that clash with household allergens', () => {
    const deals = scoreDeals([m('salmon-fillet', 'A', 5, { packQty: 0.5 })], opts({ allergens: ['fish'] }));
    expect(deals.find((d) => d.ingredientId === 'salmon-fillet')).toBeUndefined();
  });

  it('keeps ingredients whose allergens do not clash', () => {
    const deals = scoreDeals([m('salmon-fillet', 'A', 5, { packQty: 0.5 })], opts({ allergens: ['peanut'] }));
    expect(deals.map((d) => d.ingredientId)).toContain('salmon-fillet');
  });

  it('drops expired items', () => {
    const deals = scoreDeals([m('chicken-thigh-boneless', 'A', 5, { validTo: '2026-11-11' })], opts({ history }));
    expect(deals).toHaveLength(0);
  });

  it('drops packs too big for the household', () => {
    // Chicken has a 2-day shelf life: 2/7 * 1.5 * 2 people = 0.857 kg max.
    const deals = scoreDeals([m('chicken-thigh-boneless', 'A', 5, { packQty: 2 })], opts({ history }));
    expect(deals).toHaveLength(0);
  });

  it('keeps only the cheapest price per (ingredient, store)', () => {
    const deals = scoreDeals(
      [m('chicken-thigh-boneless', 'A', 7), m('chicken-thigh-boneless', 'A', 5), m('chicken-thigh-boneless', 'B', 6)],
      opts({ history }),
    );
    expect(deals).toHaveLength(2);
    const storeA = deals.find((d) => d.store === 'A');
    expect(storeA?.pricePerUnit).toBe(5);
  });

  it('adds always-buy staples from the cheapest store, flagged staple, even when not on sale', () => {
    const deals = scoreDeals(
      [m('broccoli', 'A', 4), m('broccoli', 'B', 3), m('bananas', 'A', 1)],
      opts({ alwaysBuy: ['broccoli'], history: [h('broccoli', 'A', '2026-11-01', 3)] }),
    );
    const staple = deals.find((d) => d.ingredientId === 'broccoli');
    expect(staple?.staple).toBe(true);
    expect(staple?.store).toBe('B');
    expect(deals.filter((d) => d.ingredientId === 'broccoli')).toHaveLength(1);
  });

  it('caps the number of deals per category', () => {
    const produce = ['broccoli', 'bananas', 'carrots', 'spinach', 'celery'];
    const items = produce.map((id, i) => m(id, 'A', 1 + i, { packQty: 0.2 }));
    const deals = scoreDeals(items, opts({ perCategory: 2 }));
    expect(deals).toHaveLength(2);
  });

  it('sorts by score, highest first', () => {
    const deals = scoreDeals(
      [m('chicken-thigh-boneless', 'A', 2), m('chicken-thigh-boneless', 'B', 9.5), m('bananas', 'A', 1.2, { packQty: 0.2 })],
      opts({ history }),
    );
    for (let i = 1; i < deals.length; i++) {
      expect(deals[i - 1]!.score).toBeGreaterThanOrEqual(deals[i]!.score);
    }
    expect(deals[0]!.ingredientId).toBe('chicken-thigh-boneless');
  });

  it('gives a deal a discount relative to its baseline', () => {
    const [deal] = scoreDeals([m('chicken-thigh-boneless', 'A', 5)], opts({ history }));
    expect(deal?.baseline).toBe(10);
    expect(deal?.discountPct).toBeCloseTo(0.5);
  });
});
