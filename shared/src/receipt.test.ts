import { describe, expect, it } from 'vitest';
import {
  LOW_CONFIDENCE,
  ReceiptCommitSchema,
  detectStore,
  isLowConfidence,
  lineCosts,
  matchReceipt,
  planReceiptCommit,
  type ParsedReceipt,
} from './receipt';

const STORES = ['No Frills', 'FreshCo', 'Food Basics', 'Walmart'];

function receipt(over: Partial<ParsedReceipt> = {}): ParsedReceipt {
  return { readable: true, merchant: 'NO FRILLS #3411', items: [], ...over };
}

describe('lineCosts', () => {
  it('adds tax to the taxable lines only, in proportion to their price', () => {
    const costs = lineCosts({ items: [{ price: 10, taxable: true }, { price: 10, taxable: false }], tax: 1.3 });
    expect(costs[0]).toBeCloseTo(11.3, 6);
    expect(costs[1]).toBeCloseTo(10, 6);
  });

  it('spreads the tip over every line when there is no total', () => {
    const costs = lineCosts({ items: [{ price: 10 }, { price: 30 }], tip: 4 });
    expect(costs).toEqual([11, 33]);
  });

  it('spreads any gap between the lines and the total', () => {
    const costs = lineCosts({ items: [{ price: 10 }, { price: 30 }] }, 46);
    // A 6 gap over 40 of lines: 10 gets 1.50 and 30 gets 4.50.
    expect(costs[0]).toBeCloseTo(11.5, 6);
    expect(costs[1]).toBeCloseTo(34.5, 6);
  });

  it('adds no tax when prices already include it', () => {
    const costs = lineCosts({ items: [{ price: 10 }, { price: 30 }], tax: 3, tax_included: true }, 40);
    expect(costs).toEqual([10, 30]);
  });

  it('returns zeros without dividing by zero when every line is free', () => {
    expect(lineCosts({ items: [{ price: 0 }], tip: 2 })).toEqual([0]);
  });
});

describe('detectStore', () => {
  it('matches a merchant with a branch number to the store name', () => {
    expect(detectStore('NO FRILLS #3411', STORES)).toBe('No Frills');
  });

  it('ignores spaces and case', () => {
    expect(detectStore('FRESHCO', STORES)).toBe('FreshCo');
    expect(detectStore('Food-Basics', STORES)).toBe('Food Basics');
  });

  it('returns null when no enabled store matches', () => {
    expect(detectStore('Corner Shop', STORES)).toBeNull();
    expect(detectStore(undefined, STORES)).toBeNull();
  });
});

describe('matchReceipt', () => {
  it('detects the store and matches each line to an ingredient', () => {
    const out = matchReceipt(
      receipt({ items: [{ name: 'PC boneless chicken breasts', original: 'PC BNLS CHKN BRST', price: 5.53, size: '0.840 kg @ $6.58/kg' }] }),
      STORES,
    );
    expect(out.store).toBe('No Frills');
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).toMatchObject({ index: 0, ingredientId: 'chicken-breast-boneless', unit: 'kg', include: true });
  });

  it('reads the printed size into base units and works out the price per unit', () => {
    const [line] = matchReceipt(
      receipt({ items: [{ name: 'PC boneless chicken breasts', price: 5.53, size: '0.840 kg @ $6.58/kg' }] }),
      STORES,
    ).lines;
    expect(line!.qty).toBeCloseTo(0.84, 6);
    expect(line!.pricePerUnit).toBeCloseTo(6.5833, 3);
  });

  it('reads a grams size as kilograms', () => {
    const [line] = matchReceipt(receipt({ items: [{ name: 'PC boneless chicken breasts', price: 9.07, size: '907 g' }] }), STORES).lines;
    expect(line!.qty).toBeCloseTo(0.907, 6);
    expect(line!.pricePerUnit).toBeCloseTo(10, 3);
  });

  it('uses the printed count for each-items with no size, and 1 for other lines with no size', () => {
    const [eggs, chicken] = matchReceipt(
      receipt({
        items: [
          { name: 'Large eggs', price: 6, qty: 2 },
          { name: 'PC boneless chicken breasts', price: 4 },
        ],
      }),
      STORES,
    ).lines;
    expect(eggs).toMatchObject({ unit: 'each', qty: 2, pricePerUnit: 3 });
    expect(chicken!.qty).toBe(1);
  });

  it('merges a negative line into the line above it instead of adding a line', () => {
    const out = matchReceipt(
      receipt({
        items: [
          { name: 'PC boneless chicken breasts', price: 10 },
          { name: 'Coupon', price: -2 },
          { name: 'Broccoli crowns', price: 3 },
        ],
      }),
      STORES,
    );
    expect(out.lines.map((l) => l.name)).toEqual(['PC boneless chicken breasts', 'Broccoli crowns']);
    expect(out.lines[0]!.price).toBe(8);
  });

  it('flags low-confidence matches for checking', () => {
    const [line] = matchReceipt(receipt({ items: [{ name: 'Bananas', price: 2 }] }), STORES).lines;
    expect(line!.ingredientId).toBe('bananas');
    expect(line!.confidence).toBeLessThan(LOW_CONFIDENCE);
    expect(isLowConfidence(line!)).toBe(true);
  });

  it('keeps a confident match unflagged', () => {
    const [line] = matchReceipt(receipt({ items: [{ name: 'Broccoli crowns', price: 3 }] }), STORES).lines;
    expect(isLowConfidence(line!)).toBe(false);
  });

  it('excludes non-food household items and unmatched lines', () => {
    const out = matchReceipt(
      receipt({
        items: [
          { name: 'Freezer bags 50 ct', price: 6 },
          { name: 'Mystery item', price: 4 },
        ],
      }),
      STORES,
    );
    expect(out.lines[0]).toMatchObject({ ingredientId: 'freezer-bags', include: false });
    expect(out.lines[1]).toMatchObject({ ingredientId: null, confidence: 0, pricePerUnit: null, include: false });
  });

  it('spreads tax over the taxable lines so the included lines add up to the total', () => {
    const out = matchReceipt(
      receipt({
        tax: 1.3,
        total: 21.3,
        items: [
          { name: 'Broccoli crowns', price: 10, taxable: true },
          { name: 'PC boneless chicken breasts', price: 10, taxable: true },
        ],
      }),
      STORES,
    );
    const sum = out.lines.reduce((a, l) => a + l.price, 0);
    expect(sum).toBeCloseTo(21.3, 2);
    expect(out.lines[0]!.price).toBeCloseTo(10.65, 2);
  });
});

describe('ReceiptCommitSchema and planReceiptCommit', () => {
  const line = {
    ingredientId: 'chicken-breast-boneless',
    name: 'PC boneless chicken breasts',
    original: 'PC BNLS CHKN BRST',
    qty: 0.84,
    unit: 'kg' as const,
    price: 5.53,
    pricePerUnit: 6.5833,
    addToPantry: true,
  };

  it('rejects a commit with no lines or no store', () => {
    expect(ReceiptCommitSchema.safeParse({ store: 'No Frills', lines: [] }).success).toBe(false);
    expect(ReceiptCommitSchema.safeParse({ store: '', lines: [line] }).success).toBe(false);
  });

  it('writes a price per line, a confirmed match for the printed text, and pantry items only where asked', () => {
    let n = 0;
    const rows = planReceiptCommit(
      {
        store: 'No Frills',
        date: '2026-11-12',
        lines: [line, { ...line, name: 'Broccoli crowns', original: undefined, ingredientId: 'broccoli', unit: 'each', qty: 1, pricePerUnit: null, addToPantry: false }],
      },
      '2026-11-03',
      () => `id-${++n}`,
    );

    expect(rows.prices).toEqual([{ ingredientId: 'chicken-breast-boneless', store: 'No Frills', date: '2026-11-12', pricePerUnit: 6.5833 }]);
    expect(rows.matches).toEqual([
      { rawKey: 'bnls chkn brst', ingredientId: 'chicken-breast-boneless', packQty: 0.84 },
      { rawKey: 'broccoli crowns', ingredientId: 'broccoli', packQty: 1 },
    ]);
    expect(rows.pantry).toHaveLength(1);
    expect(rows.pantry[0]).toMatchObject({
      id: 'id-1',
      ingredientId: 'chicken-breast-boneless',
      qty: 0.84,
      unit: 'kg',
      addedOn: '2026-11-12',
      source: 'receipt',
    });
    expect(rows.pantry[0]!.expiresOn > '2026-11-12').toBe(true);
  });

  it('defaults the date to today when none is given', () => {
    const rows = planReceiptCommit({ store: 'FreshCo', lines: [line] }, '2026-11-03', () => 'x');
    expect(rows.prices[0]!.date).toBe('2026-11-03');
    expect(rows.pantry[0]!.addedOn).toBe('2026-11-03');
  });

  it('throws on an unknown ingredient', () => {
    expect(() => planReceiptCommit({ store: 'FreshCo', lines: [{ ...line, ingredientId: 'not-real' }] }, '2026-11-03', () => 'x')).toThrow(
      'Unknown ingredient: not-real',
    );
  });
});

describe('detectStore with Flipp names', () => {
  it('matches a receipt printed with a Flipp name, and returns the store name', () => {
    const stores = [{ name: 'Real Canadian Superstore', flippNames: ['Superstore', 'RCSS'] }, { name: 'FreshCo' }];
    expect(detectStore('SUPERSTORE #3411', stores)).toBe('Real Canadian Superstore');
    expect(detectStore('RCSS', stores)).toBe('Real Canadian Superstore');
    expect(detectStore('FRESHCO', stores)).toBe('FreshCo');
  });

  it('does not match a store that has been removed', () => {
    expect(detectStore('Sunny Mart', [{ name: 'FreshCo' }])).toBeNull();
  });
});
