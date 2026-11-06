import { describe, expect, it } from 'vitest';
import type { ItemRule, Store } from '@provisions/shared';
import { dropIndex, moveStore, moveStoreTo, parseMinSaving, pinStoreOptions, withPinnedStore } from './stores';

const store = (name: string, enabled = true): Store => ({
  id: name.toLowerCase(),
  name,
  enabled,
  priceMatches: false,
});
const names = (stores: Store[]) => stores.map((s) => s.name);

describe('moveStore', () => {
  const list = [store('A'), store('B'), store('C')];

  it('moves a store one place up or down', () => {
    expect(names(moveStore(list, 'b', -1))).toEqual(['B', 'A', 'C']);
    expect(names(moveStore(list, 'b', 1))).toEqual(['A', 'C', 'B']);
  });

  it('leaves the list alone at either end, or for an unknown store', () => {
    expect(moveStore(list, 'a', -1)).toBe(list);
    expect(moveStore(list, 'c', 1)).toBe(list);
    expect(moveStore(list, 'zzz', 1)).toBe(list);
  });

  it('does not change the list it is given', () => {
    moveStore(list, 'b', -1);
    expect(names(list)).toEqual(['A', 'B', 'C']);
  });
});

describe('moveStoreTo', () => {
  const list = [store('A'), store('B'), store('C')];

  it('drops a store above a row further down the list', () => {
    expect(names(moveStoreTo(list, 'a', 2))).toEqual(['B', 'A', 'C']);
    expect(names(moveStoreTo(list, 'a', 3))).toEqual(['B', 'C', 'A']);
  });

  it('drops a store above a row further up the list', () => {
    expect(names(moveStoreTo(list, 'c', 0))).toEqual(['C', 'A', 'B']);
    expect(names(moveStoreTo(list, 'c', 1))).toEqual(['A', 'C', 'B']);
  });

  it('changes nothing when a store is dropped where it already is', () => {
    expect(names(moveStoreTo(list, 'b', 1))).toEqual(['A', 'B', 'C']);
    expect(names(moveStoreTo(list, 'b', 2))).toEqual(['A', 'B', 'C']);
  });

  it('clamps a drop past either end', () => {
    expect(names(moveStoreTo(list, 'a', 99))).toEqual(['B', 'C', 'A']);
    expect(names(moveStoreTo(list, 'c', -4))).toEqual(['C', 'A', 'B']);
  });
});

describe('dropIndex', () => {
  it('counts the rows whose middle is above the pointer', () => {
    const middles = [28, 84, 140];
    expect(dropIndex(middles, 10)).toBe(0);
    expect(dropIndex(middles, 100)).toBe(2);
    expect(dropIndex(middles, 500)).toBe(3);
  });
});

describe('pinStoreOptions', () => {
  it('offers the enabled stores, in list order', () => {
    expect(pinStoreOptions([store('B'), store('A', false), store('C')])).toEqual(['B', 'C']);
  });
});

describe('withPinnedStore', () => {
  const rule: ItemRule = { id: 'r1', name: 'eggs', rule: 'always', except: ['x'] };

  it('sets the store and keeps the other fields', () => {
    expect(withPinnedStore(rule, 'Costco')).toEqual({ id: 'r1', name: 'eggs', rule: 'always', except: ['x'], store: 'Costco' });
  });

  it('clears the store for cheapest, without leaving an empty field behind', () => {
    const pinned = withPinnedStore(rule, 'Costco');
    expect(withPinnedStore(pinned, undefined)).toEqual({ id: 'r1', name: 'eggs', rule: 'always', except: ['x'] });
    expect(Object.keys(withPinnedStore({ id: 'r2', name: 'milk', rule: 'always' }, undefined))).toEqual(['id', 'name', 'rule']);
  });

  it('keeps the catalogue ingredient of a pin rule', () => {
    expect(withPinnedStore({ id: 'p', name: 'Eggs', rule: 'pin', store: 'A', ingredientId: 'eggs-large' }, 'B')).toEqual({
      id: 'p',
      name: 'Eggs',
      rule: 'pin',
      store: 'B',
      ingredientId: 'eggs-large',
    });
  });
});

describe('parseMinSaving', () => {
  it('reads a whole or cents amount from 0 to 50', () => {
    expect(parseMinSaving('3')).toBe(3);
    expect(parseMinSaving(' 2.5 ')).toBe(2.5);
    expect(parseMinSaving('0')).toBe(0);
    expect(parseMinSaving('50')).toBe(50);
  });

  it('refuses anything else', () => {
    expect(parseMinSaving('')).toBeNull();
    expect(parseMinSaving('51')).toBeNull();
    expect(parseMinSaving('-1')).toBeNull();
    expect(parseMinSaving('1.234')).toBeNull();
    expect(parseMinSaving('three')).toBeNull();
  });
});
