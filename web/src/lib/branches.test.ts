// Adding a branch as its chain's store, the address on a store, and keeping a store's fields when its Flipp names
// change. Pure: no DOM.
import { describe, expect, it } from 'vitest';
import { STORE_PRESETS, type Store } from '@provisions/shared';
import { addCustomStore, addressOf, storeFromPreset, withAddress, withBranch, withFlippNames, takesBranch } from './stores';

const preset = (id: string) => STORE_PRESETS.find((p) => p.id === id)!;
const NO_FRILLS_BRANCH = { banner: 'nofrills' as const, storeId: '1234', label: 'No Frills · 425 Bloor St W, Toronto' };

describe('withBranch', () => {
  it('adds a new chain enabled, from its preset, with the branch as its location', () => {
    const got = withBranch([], NO_FRILLS_BRANCH);
    expect(got).toEqual({
      stores: [
        {
          id: 'no-frills',
          name: 'No Frills',
          enabled: true,
          priceMatches: true,
          group: 'Loblaw',
          flippNames: ['NOFRILLS'],
          siteStore: { banner: 'nofrills', storeId: '1234', label: 'No Frills · 425 Bloor St W, Toronto' },
        },
      ],
      outcome: 'added',
      name: 'No Frills',
    });
  });

  it('replaces the branch of a chain already in the list, keeping its place and flags', () => {
    const existing: Store = {
      id: 'no-frills',
      name: 'No Frills',
      enabled: false,
      priceMatches: false,
      flippNames: ['NOFRILLS'],
      siteStore: { banner: 'nofrills', storeId: '9999', label: 'No Frills · Old Rd' },
    };
    const other: Store = { id: 'metro', name: 'Metro', enabled: true, priceMatches: false };
    const got = withBranch([other, existing], NO_FRILLS_BRANCH);
    expect(got?.outcome).toBe('updated');
    expect(got?.stores).toEqual([
      other,
      {
        ...existing,
        siteStore: { banner: 'nofrills', storeId: '1234', label: 'No Frills · 425 Bloor St W, Toronto' },
      },
    ]);
  });

  it('matches a chain already in the list by its name, so a custom store of that name is not doubled', () => {
    const custom: Store = { id: 'no-frills-store', name: 'no frills', enabled: true, priceMatches: false };
    const got = withBranch([custom], NO_FRILLS_BRANCH);
    expect(got?.stores).toHaveLength(1);
    expect(got?.stores[0]?.siteStore?.storeId).toBe('1234');
    expect(got?.outcome).toBe('updated');
  });

  it('keeps one branch per chain: adding a second branch of the same chain replaces the first', () => {
    const first = withBranch([], NO_FRILLS_BRANCH)!;
    const second = withBranch(first.stores, { banner: 'nofrills', storeId: '5555', label: 'No Frills · 1 Church St, Toronto' })!;
    expect(second.stores).toHaveLength(1);
    expect(second.stores[0]?.siteStore?.storeId).toBe('5555');
  });

  it('is null for T&T, which has no location list to take a branch from', () => {
    expect(withBranch([], { banner: 'tandt', storeId: '1', label: 'T&T' })).toBeNull();
  });
});

describe('addresses', () => {
  it('stores a typed address on a preset, trimmed, and leaves it off when blank', () => {
    expect(storeFromPreset(preset('metro'), '  1000 Dundas St  ')).toMatchObject({ id: 'metro', address: '1000 Dundas St' });
    expect(storeFromPreset(preset('metro'), '   ')).not.toHaveProperty('address');
    expect(storeFromPreset(preset('metro'))).not.toHaveProperty('address');
  });

  it('stores an address on a custom store, and leaves it off when blank', () => {
    const result = addCustomStore([], 'Corner Grocer', '', ' 12 Main St ');
    expect(result).toMatchObject({ ok: true, store: { id: 'corner-grocer', address: '12 Main St' } });
    const blank = addCustomStore([], 'Corner Grocer', '', '');
    expect(blank.ok && 'address' in blank.store).toBe(false);
  });

  it('shows the branch address for a chain store, and the typed address for another', () => {
    expect(addressOf({ id: 'no-frills', name: 'No Frills', enabled: true, priceMatches: true, ...{ siteStore: { banner: 'nofrills', storeId: '1', label: 'No Frills · X' } } })).toBe(
      'No Frills · X',
    );
    expect(addressOf({ id: 'metro', name: 'Metro', enabled: true, priceMatches: false, address: '1 Main' })).toBe('1 Main');
    expect(addressOf({ id: 'metro', name: 'Metro', enabled: true, priceMatches: false })).toBeUndefined();
  });

  it('replaces an address, and removes it when the text is blank', () => {
    const s: Store = { id: 'metro', name: 'Metro', enabled: true, priceMatches: false, address: 'Old' };
    expect(withAddress(s, ' New St ')).toEqual({ ...s, address: 'New St' });
    expect(withAddress(s, '  ')).toEqual({ id: 'metro', name: 'Metro', enabled: true, priceMatches: false });
  });

  it('takes a branch only for a Loblaw-family store', () => {
    expect(takesBranch('no-frills')).toBe(true);
    expect(takesBranch('tt-supermarket')).toBe(true);
    expect(takesBranch('metro')).toBe(false);
  });
});

describe('withFlippNames keeps the rest of the store', () => {
  it('keeps the location and the address when the Flipp names change', () => {
    const s: Store = {
      id: 'no-frills',
      name: 'No Frills',
      enabled: true,
      priceMatches: true,
      group: 'Loblaw',
      address: 'Typed',
      siteStore: { banner: 'nofrills', storeId: '1234', label: 'No Frills · 425 Bloor St W, Toronto' },
    };
    expect(withFlippNames(s, 'NOFRILLS, NF')).toEqual({ ...s, flippNames: ['NOFRILLS', 'NF'] });
    const cleared = withFlippNames({ ...s, flippNames: ['NF'] }, '');
    expect(cleared).toEqual(s);
    expect(cleared).not.toHaveProperty('flippNames');
  });
});
