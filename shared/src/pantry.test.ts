import { describe, expect, it } from 'vitest';
import { INGREDIENT_BY_ID } from './catalog';
import {
  PantryItemSchema,
  PantryPatchSchema,
  defaultExpiry,
  expiringSoon,
  formatUseBy,
  subtractPantry,
  torontoDate,
  usableItems,
  type PantryItem,
} from './pantry';

function item(over: Partial<PantryItem> & Pick<PantryItem, 'id' | 'ingredientId' | 'qty'>): PantryItem {
  return {
    unit: 'kg',
    addedOn: '2026-11-01',
    expiresOn: '2026-11-20',
    source: 'manual',
    ...over,
  };
}

describe('defaultExpiry', () => {
  it('adds the ingredient shelf life to the day it was added', () => {
    const shelf = INGREDIENT_BY_ID['broccoli']!.shelfLifeDays;
    const expected = new Date(Date.UTC(2026, 10, 1 + shelf)).toISOString().slice(0, 10);
    expect(defaultExpiry('broccoli', '2026-11-01')).toBe(expected);
  });

  it('falls back to a week for an unknown ingredient', () => {
    expect(defaultExpiry('not-a-real-food', '2026-11-01')).toBe('2026-11-08');
  });
});

describe('expiringSoon', () => {
  const today = '2026-11-10';
  const items = [
    item({ id: 'a', ingredientId: 'x', qty: 1, expiresOn: '2026-11-20' }),
    item({ id: 'b', ingredientId: 'x', qty: 1, expiresOn: '2026-11-13' }),
    item({ id: 'c', ingredientId: 'x', qty: 1, expiresOn: '2026-11-12' }),
    item({ id: 'd', ingredientId: 'x', qty: 1, expiresOn: '2026-11-09' }), // already past
  ];

  it('returns items due within 3 days, soonest first, including ones already past', () => {
    expect(expiringSoon(items, today).map((i) => i.id)).toEqual(['d', 'c', 'b']);
  });

  it('takes a window in days', () => {
    expect(expiringSoon(items, today, 1).map((i) => i.id)).toEqual(['d']);
  });
});

describe('usableItems', () => {
  it('drops items past their use-by date, keeping the day itself', () => {
    const items = [
      item({ id: 'old', ingredientId: 'x', qty: 1, expiresOn: '2026-11-09' }),
      item({ id: 'today', ingredientId: 'x', qty: 1, expiresOn: '2026-11-10' }),
    ];
    expect(usableItems(items, '2026-11-10').map((i) => i.id)).toEqual(['today']);
  });
});

describe('subtractPantry', () => {
  it('takes stock off the need and reports what was used', () => {
    const pantry = [item({ id: 'p1', ingredientId: 'onion', qty: 0.5 })];
    const { remaining, used } = subtractPantry([{ ingredientId: 'onion', qty: 0.8 }], pantry);
    expect(remaining).toEqual([{ ingredientId: 'onion', qty: 0.3 }]);
    expect(used).toEqual([{ pantryItemId: 'p1', ingredientId: 'onion', qty: 0.5 }]);
  });

  it('drops a need the pantry covers fully', () => {
    const pantry = [item({ id: 'p1', ingredientId: 'onion', qty: 2 })];
    const { remaining } = subtractPantry([{ ingredientId: 'onion', qty: 0.8 }], pantry);
    expect(remaining).toEqual([]);
  });

  it('uses the soonest-expiring stock first', () => {
    const pantry = [
      item({ id: 'later', ingredientId: 'milk', qty: 1, unit: 'l', expiresOn: '2026-11-25' }),
      item({ id: 'sooner', ingredientId: 'milk', qty: 1, unit: 'l', expiresOn: '2026-11-12' }),
    ];
    const { used } = subtractPantry([{ ingredientId: 'milk', qty: 1.5 }], pantry);
    expect(used).toEqual([
      { pantryItemId: 'sooner', ingredientId: 'milk', qty: 1 },
      { pantryItemId: 'later', ingredientId: 'milk', qty: 0.5 },
    ]);
  });

  it('keeps needs for ingredients the pantry does not hold, in input order', () => {
    const { remaining, used } = subtractPantry(
      [
        { ingredientId: 'rice', qty: 1 },
        { ingredientId: 'beans', qty: 2 },
      ],
      [item({ id: 'p1', ingredientId: 'beans', qty: 0.5 })],
    );
    expect(remaining).toEqual([
      { ingredientId: 'rice', qty: 1 },
      { ingredientId: 'beans', qty: 1.5 },
    ]);
    expect(used).toHaveLength(1);
  });

  it('does not reuse stock across two needs for the same ingredient', () => {
    const pantry = [item({ id: 'p1', ingredientId: 'rice', qty: 1 })];
    const { remaining } = subtractPantry(
      [
        { ingredientId: 'rice', qty: 0.6 },
        { ingredientId: 'rice', qty: 0.6 },
      ],
      pantry,
    );
    expect(remaining).toEqual([{ ingredientId: 'rice', qty: 0.2 }]);
  });
});

describe('PantryItemSchema and PantryPatchSchema', () => {
  const valid = { id: 'p1', ingredientId: 'onion', qty: 1, unit: 'each', addedOn: '2026-11-01', expiresOn: '2026-11-10', source: 'manual' };

  it('accepts a valid item and rejects bad dates, units and quantities', () => {
    expect(PantryItemSchema.safeParse(valid).success).toBe(true);
    expect(PantryItemSchema.safeParse({ ...valid, expiresOn: '2026-02-30' }).success).toBe(false);
    expect(PantryItemSchema.safeParse({ ...valid, unit: 'g' }).success).toBe(false);
    expect(PantryItemSchema.safeParse({ ...valid, qty: 0 }).success).toBe(false);
  });

  it('needs at least one field to patch', () => {
    expect(PantryPatchSchema.safeParse({}).success).toBe(false);
    expect(PantryPatchSchema.safeParse({ qty: 2 }).success).toBe(true);
    expect(PantryPatchSchema.safeParse({ expiresOn: '2026-11-14' }).success).toBe(true);
  });
});

describe('dates for people', () => {
  it('formats a use-by date', () => {
    expect(formatUseBy('2026-11-14')).toBe('Nov 14');
  });

  it('gives the Toronto calendar date, not the UTC one', () => {
    // 03:00 UTC on 12 Nov is still 11 Nov in Toronto.
    expect(torontoDate(new Date('2026-11-12T03:00:00Z'))).toBe('2026-11-11');
    expect(torontoDate(new Date('2026-11-12T17:00:00Z'))).toBe('2026-11-12');
  });
});
