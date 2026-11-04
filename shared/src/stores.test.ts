import { describe, expect, it } from 'vitest';
import { HouseholdSchema, STORE_GROUPS, STORE_PRESETS, StoreSchema, defaultHousehold, slugifyName } from './index';

describe('STORE_PRESETS', () => {
  it('has unique ids and names, and only known groups', () => {
    const ids = STORE_PRESETS.map((p) => p.id);
    const names = STORE_PRESETS.map((p) => p.name.toLowerCase());
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    for (const p of STORE_PRESETS) expect(STORE_GROUPS).toContain(p.group);
  });

  it('lists the Ontario chains in their groups', () => {
    const groupOf = (name: string) => STORE_PRESETS.find((p) => p.name === name)?.group;
    expect(groupOf('Real Canadian Superstore')).toBe('Loblaw');
    expect(groupOf('Food Basics')).toBe('Metro');
    expect(groupOf('Longo\'s')).toBe('Sobeys');
    expect(groupOf('Costco')).toBe('Other');
  });

  it('defaults price matching on for No Frills, Real Canadian Superstore and Walmart only', () => {
    const matching = STORE_PRESETS.filter((p) => p.priceMatches).map((p) => p.name).sort();
    expect(matching).toEqual(['No Frills', 'Real Canadian Superstore', 'Walmart']);
  });

  it('gives Flipp names that are not blank and do not repeat within a store', () => {
    for (const p of STORE_PRESETS) {
      for (const n of p.flippNames ?? []) expect(n.trim()).not.toBe('');
      expect(new Set((p.flippNames ?? []).map((n) => n.toLowerCase())).size).toBe((p.flippNames ?? []).length);
    }
  });

  it('gives the Real Canadian Superstore the Superstore and RCSS names', () => {
    const rcss = STORE_PRESETS.find((p) => p.id === 'real-canadian-superstore');
    expect(rcss?.flippNames).toEqual(expect.arrayContaining(['Superstore', 'RCSS']));
  });
});

describe('slugifyName', () => {
  it('makes lowercase dashed ids and empty for no letters or digits', () => {
    expect(slugifyName('Nations Fresh Foods')).toBe('nations-fresh-foods');
    expect(slugifyName("Longo's")).toBe('longo-s');
    expect(slugifyName('!!!')).toBe('');
  });
});

describe('defaultHousehold stores', () => {
  it('keeps the four original stores, all off, with the same price-match defaults', () => {
    const stores = defaultHousehold().stores;
    expect(stores.map((s) => [s.name, s.enabled, s.priceMatches])).toEqual([
      ['No Frills', false, true],
      ['FreshCo', false, false],
      ['Food Basics', false, false],
      ['Walmart', false, true],
    ]);
  });

  it('gives each default store its group and Flipp names', () => {
    const noFrills = defaultHousehold().stores.find((s) => s.id === 'no-frills');
    expect(noFrills?.group).toBe('Loblaw');
    expect(noFrills?.flippNames).toEqual(['NOFRILLS']);
    expect(defaultHousehold().stores.every((s) => s.group !== undefined)).toBe(true);
  });

  it('parses a default household', () => {
    expect(HouseholdSchema.safeParse(defaultHousehold()).success).toBe(true);
  });
});

describe('StoreSchema', () => {
  it('still parses a store saved before groups and Flipp names existed', () => {
    const old = { id: 'freshco', name: 'FreshCo', enabled: true, priceMatches: false };
    const parsed = StoreSchema.parse(old);
    expect(parsed).toEqual(old);
  });

  it('keeps group and Flipp names when they are set', () => {
    const store = { id: 'x', name: 'Corner Grocer', enabled: true, priceMatches: false, group: 'Other', flippNames: ['Sunny Mart'] };
    expect(StoreSchema.parse(store)).toEqual(store);
  });

  it('rejects an unknown group, a blank Flipp name, and too many Flipp names', () => {
    const base = { id: 'x', name: 'X', enabled: true, priceMatches: false };
    expect(StoreSchema.safeParse({ ...base, group: 'Sobey' }).success).toBe(false);
    expect(StoreSchema.safeParse({ ...base, flippNames: ['  '] }).success).toBe(false);
    expect(StoreSchema.safeParse({ ...base, flippNames: Array.from({ length: 11 }, (_, i) => `n${i}`) }).success).toBe(false);
  });

  it('parses a household stored before the new fields', () => {
    const h = defaultHousehold();
    const older = {
      ...h,
      stores: h.stores.map(({ id, name, enabled, priceMatches }) => ({ id, name, enabled, priceMatches })),
    };
    expect(HouseholdSchema.safeParse(older).success).toBe(true);
  });
});
