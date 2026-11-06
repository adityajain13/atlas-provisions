// The T&T sync's pricing rules, as pure functions: a pack price per base unit from its size, a weight price per kilogram,
// the first in-stock match, the results' caps, and where a household's T&T prices are listed. No network.
import { describe, expect, it } from 'vitest';
import { INGREDIENT_BY_ID, defaultHousehold, normaliseTntItem, type Household, type Store } from '@provisions/shared';
import { pickTntResult, tntLocations, tntPackPrice, tntResultsProblem } from './tntSync';

const TNT: Store = { id: 'tt-supermarket', name: 'T&T Supermarket', group: 'Other', enabled: true, priceMatches: false };
const item = (name: string, price: number, over: Record<string, unknown> = {}) =>
  normaliseTntItem({
    id: 1,
    sku: name,
    name,
    stock_status: 'IN_STOCK',
    price: { regularPrice: { amount: { value: price } } },
    price_range: { minimum_price: { final_price: { value: price } } },
    was_price: null,
    uom_type: null,
    weight_uom: null,
    ...over,
  });

describe('tntPackPrice', () => {
  it('prices a pack per base unit from the size in its name', () => {
    const p = item('Firm Tofu 454g', 2.99)!;
    const hit = tntPackPrice(p, 'kg');
    expect(hit?.packQty).toBeCloseTo(0.454, 6);
    expect(hit?.pricePerUnit).toBeCloseTo(2.99 / 0.454, 6);
    expect(hit?.onSale).toBe(false);
    expect(hit?.regularPerUnit).toBeNull();
  });

  it('gives the regular price per unit when the pack is on sale', () => {
    const p = item('Firm Tofu 454g', 2.49, { was_price: 2.99, price: { regularPrice: { amount: { value: 2.99 } } } })!;
    const hit = tntPackPrice(p, 'kg');
    expect(hit?.onSale).toBe(true);
    expect(hit?.regularPerUnit).toBeCloseTo(2.99 / 0.454, 6);
  });

  it('takes a weight-priced product per kilogram, converting pounds', () => {
    const perLb = item('Ground Beef', 4.5, { uom_type: 'WEIGHT', weight_uom: 'LB' })!;
    expect(tntPackPrice(perLb, 'kg')?.pricePerUnit).toBeCloseTo(4.5 / 0.4536, 6);
    const perKg = item('Pork Belly', 12, { uom_type: 'WEIGHT', weight_uom: 'KG' })!;
    expect(tntPackPrice(perKg, 'kg')?.pricePerUnit).toBe(12);
    expect(tntPackPrice(perKg, 'l')).toBeNull();
  });

  it('gives nothing for a pack with no size in its name', () => {
    expect(tntPackPrice(item('Free Range Eggs', 5.49)!, 'each')).toBeNull();
  });
});

describe('pickTntResult', () => {
  it('takes the first in-stock product that is the ingredient', () => {
    const ing = INGREDIENT_BY_ID['tofu-firm']!;
    const out = item('Firm Tofu 454g', 2.99, { stock_status: 'OUT_OF_STOCK' })!;
    const inStock = item('Firm Tofu 340g', 3.49)!;
    const hit = pickTntResult([out, inStock], ing);
    expect(hit?.packQty).toBeCloseTo(0.34, 6);
  });
});

describe('tntResultsProblem', () => {
  it('takes a well-formed body', () => {
    expect(tntResultsProblem({ results: [{ ingredientId: 'eggs-large', term: 'eggs', items: [] }] })).toBeNull();
    expect(tntResultsProblem({ results: [] })).toBeNull();
  });

  it('refuses a body that is not a results list, and says why', () => {
    expect(tntResultsProblem(null)).toMatchObject({ status: 400 });
    expect(tntResultsProblem({ results: 'x' })).toMatchObject({ status: 400 });
    expect(tntResultsProblem({ results: [{ ingredientId: 1, term: 'x', items: [] }] })).toMatchObject({ status: 400 });
  });
});

describe('tntLocations', () => {
  const household = (over: Partial<Household> = {}): Household => ({ ...defaultHousehold(), postalCode: 'L5L 3T4', stores: [TNT], ...over });

  it('lists the T&T row for the region of an enabled T&T store', () => {
    expect(tntLocations(household())).toEqual([{ store: 'T&T Supermarket', storeId: 'tnt-ON' }]);
    expect(tntLocations(household({ postalCode: 'V6B 1A1' }))).toEqual([{ store: 'T&T Supermarket', storeId: 'tnt-BC' }]);
  });

  it('lists nothing when T&T is disabled, or the postal code has no covered region', () => {
    expect(tntLocations(household({ stores: [{ ...TNT, enabled: false }] }))).toEqual([]);
    expect(tntLocations(household({ postalCode: 'B3H 1A1' }))).toEqual([]);
  });
});
