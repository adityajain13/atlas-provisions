import { describe, expect, it } from 'vitest';
import { STORE_PRESETS, defaultHousehold, type Store } from '@provisions/shared';
import {
  addCustomStore,
  addFlippName,
  clampMaxStores,
  groupOf,
  groupPresets,
  maxStoresLimit,
  orderStores,
  parseFlippNames,
  readsSitePrices,
  removeFlippName,
  presetsNotInList,
  storeFromPreset,
  withFlippNames,
} from './stores';

const store = (over: Partial<Store> & { id: string; name: string }): Store => ({
  enabled: false,
  priceMatches: false,
  ...over,
});

describe('presetsNotInList', () => {
  it('leaves out presets already in the list, by id or by name ignoring case', () => {
    const stores = [store({ id: 'custom-freshco', name: 'freshco' }), store({ id: 'no-frills', name: 'No Frills' })];
    const left = presetsNotInList(stores, STORE_PRESETS).map((p) => p.id);
    expect(left).not.toContain('freshco');
    expect(left).not.toContain('no-frills');
    expect(left).toContain('metro');
    expect(left.length).toBe(STORE_PRESETS.length - 2);
  });

  it('offers everything for an empty list', () => {
    expect(presetsNotInList([], STORE_PRESETS)).toHaveLength(STORE_PRESETS.length);
  });
});

describe('groupPresets', () => {
  it('groups in Loblaw, Metro, Sobeys, Other order and drops empty groups', () => {
    const groups = groupPresets(STORE_PRESETS.filter((p) => p.group !== 'Metro'));
    expect(groups.map((g) => g.group)).toEqual(['Loblaw', 'Sobeys', 'Other']);
    const all = groupPresets(STORE_PRESETS);
    expect(all.map((g) => g.group)).toEqual(['Loblaw', 'Metro', 'Sobeys', 'Other']);
  });
});

describe('storeFromPreset', () => {
  it('adds a preset enabled, with its price-match default and Flipp names', () => {
    const rcss = STORE_PRESETS.find((p) => p.id === 'real-canadian-superstore')!;
    expect(storeFromPreset(rcss)).toEqual({
      id: 'real-canadian-superstore',
      name: 'Real Canadian Superstore',
      enabled: true,
      priceMatches: true,
      group: 'Loblaw',
      flippNames: ['Superstore', 'RCSS'],
    });
  });
});

describe('parseFlippNames', () => {
  it('splits on commas, trims, and drops blanks and repeats ignoring case', () => {
    expect(parseFlippNames(' RCSS, Superstore ,, rcss,  ')).toEqual(['RCSS', 'Superstore']);
    expect(parseFlippNames('   ')).toEqual([]);
  });

  it('keeps at most 10 names', () => {
    const text = Array.from({ length: 12 }, (_, i) => `n${i}`).join(',');
    expect(parseFlippNames(text)).toHaveLength(10);
  });
});

describe('addCustomStore', () => {
  const list = defaultHousehold().stores;

  it('adds a store in group Other, enabled, with no price match and an id from its name', () => {
    const result = addCustomStore(list, '  Corner Grocer ', 'Sunny Mart, CG');
    expect(result).toEqual({
      ok: true,
      store: {
        id: 'corner-grocer',
        name: 'Corner Grocer',
        enabled: true,
        priceMatches: false,
        group: 'Other',
        flippNames: ['Sunny Mart', 'CG'],
      },
    });
  });

  it('leaves out Flipp names when none are typed', () => {
    const result = addCustomStore(list, 'Corner Grocer', '');
    expect(result.ok && 'flippNames' in result.store).toBe(false);
  });

  it('rejects a blank name', () => {
    expect(addCustomStore(list, '   ', '')).toEqual({ ok: false, error: 'Type a store name.' });
  });

  it('rejects a name with no letters or digits', () => {
    expect(addCustomStore(list, '!!!', '')).toEqual({ ok: false, error: 'Use letters or numbers in the store name.' });
  });

  it('rejects a name already in the list, ignoring case', () => {
    expect(addCustomStore(list, 'freshco', '')).toEqual({ ok: false, error: '"FreshCo" is already in your list.' });
  });

  it('rejects a name that would reuse an id already in the list', () => {
    const withTt = [store({ id: 'tt-supermarket', name: 'T&T Supermarket' })];
    const result = addCustomStore(withTt, 'TT Supermarket', '');
    expect(result.ok).toBe(false);
  });

  it('rejects a name over 40 characters', () => {
    expect(addCustomStore(list, 'x'.repeat(41), '').ok).toBe(false);
  });
});

describe('withFlippNames and removal', () => {
  it('sets Flipp names, and clears them when the text is blank', () => {
    const s = store({ id: 'a', name: 'A', group: 'Other' });
    expect(withFlippNames(s, 'AA, A2')).toEqual({ id: 'a', name: 'A', enabled: false, priceMatches: false, group: 'Other', flippNames: ['AA', 'A2'] });
    expect(withFlippNames({ ...s, flippNames: ['AA'] }, '')).toEqual(s);
  });

  it('keeps the enabled and price-match flags', () => {
    const s = store({ id: 'a', name: 'A', enabled: true, priceMatches: true });
    expect(withFlippNames(s, 'X')).toMatchObject({ enabled: true, priceMatches: true });
  });
});

describe('groupOf', () => {
  it('uses the stored group, or the preset group for a store saved before groups', () => {
    expect(groupOf(store({ id: 'x', name: 'X', group: 'Sobeys' }))).toBe('Sobeys');
    expect(groupOf(store({ id: 'food-basics', name: 'Food Basics' }))).toBe('Metro');
    expect(groupOf(store({ id: 'mystery', name: 'Mystery Mart' }))).toBeUndefined();
  });
});

describe('per-trip limit', () => {
  it('is the enabled count, capped at 5, or 5 when none are enabled', () => {
    const off = [store({ id: 'a', name: 'A' }), store({ id: 'b', name: 'B' })];
    expect(maxStoresLimit(off)).toBe(5);
    expect(maxStoresLimit([store({ id: 'a', name: 'A', enabled: true })])).toBe(1);
    const many = Array.from({ length: 7 }, (_, i) => store({ id: `s${i}`, name: `S${i}`, enabled: true }));
    expect(maxStoresLimit(many)).toBe(5);
  });

  it('clamps the per-trip count into 1 and the limit', () => {
    const one = [store({ id: 'a', name: 'A', enabled: true })];
    expect(clampMaxStores(2, one)).toBe(1);
    expect(clampMaxStores(0, one)).toBe(1);
    expect(clampMaxStores(3, [])).toBe(3);
  });
});

describe('Flipp name editing', () => {
  it('adds a name without repeating one already there, ignoring case', () => {
    const s = store({ id: 'a', name: 'A', flippNames: ['AA'] });
    expect(addFlippName(s, 'A2').flippNames).toEqual(['AA', 'A2']);
    expect(addFlippName(s, 'aa').flippNames).toEqual(['AA']);
    expect(addFlippName(store({ id: 'a', name: 'A' }), '  X ').flippNames).toEqual(['X']);
  });

  it('removes one name, ignoring case, and drops the list when none are left', () => {
    const s = store({ id: 'a', name: 'A', flippNames: ['AA', 'A2'] });
    expect(removeFlippName(s, 'aa').flippNames).toEqual(['A2']);
    expect('flippNames' in removeFlippName({ ...s, flippNames: ['AA'] }, 'AA')).toBe(false);
  });
});

describe('orderStores', () => {
  it('lists the stores shopped at first, each group alphabetical, and does not change the input', () => {
    const input = [
      store({ id: 'z', name: 'Zehrs' }),
      store({ id: 'm', name: 'Metro', enabled: true }),
      store({ id: 'c', name: 'Costco', enabled: true }),
      store({ id: 'f', name: 'Fortinos' }),
    ];
    expect(orderStores(input).map((s) => s.name)).toEqual(['Costco', 'Metro', 'Fortinos', 'Zehrs']);
    expect(input[0]!.name).toBe('Zehrs');
  });
});

describe('readsSitePrices', () => {
  it('never counts T&T, whose site blocks automated lookups, even with a location saved from before', () => {
    expect(readsSitePrices(store({ id: 'tt-supermarket', name: 'T&T Supermarket', enabled: true }))).toBe(false);
    expect(
      readsSitePrices(store({ id: 'tt-supermarket', name: 'T&T Supermarket', enabled: true, siteStore: { banner: 'nofrills', storeId: '1', label: 'x' } })),
    ).toBe(false);
  });

  it('reads a Loblaw-family store only once its location is picked', () => {
    expect(readsSitePrices(store({ id: 'no-frills', name: 'No Frills', enabled: true }))).toBe(false);
    const picked = store({ id: 'no-frills', name: 'No Frills', enabled: true, siteStore: { banner: 'nofrills', storeId: '1234', label: 'No Frills · X' } });
    expect(readsSitePrices(picked)).toBe(true);
  });

  it('does not read a store whose chain has no regular price feed', () => {
    expect(readsSitePrices(store({ id: 'metro', name: 'Metro', enabled: true }))).toBe(false);
  });
});
