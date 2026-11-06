import { describe, expect, it } from 'vitest';
import { eachNoun, formatSize, neededQuantity, packLineQuantity, pluralize } from './quantity';

describe('formatSize', () => {
  it('reads grams, kilograms, millilitres and litres', () => {
    expect(formatSize(0.7, 'kg')).toBe('700 g');
    expect(formatSize(1.5, 'kg')).toBe('1.5 kg');
    expect(formatSize(0.25, 'l')).toBe('250 mL');
    expect(formatSize(2, 'l')).toBe('2 L');
    expect(formatSize(1, 'each')).toBe('1 each');
    expect(formatSize(3, 'each')).toBe('3 ct');
  });
});

describe('eachNoun and pluralize', () => {
  it('takes the noun from a catalogue label', () => {
    expect(eachNoun('one can')).toBe('can');
    expect(eachNoun('one loaf')).toBe('loaf');
    expect(eachNoun('one dozen carton')).toBe('carton');
    expect(eachNoun('one pack of tortillas')).toBe('pack');
    expect(eachNoun(undefined)).toBeUndefined();
  });

  it('pluralises the nouns the catalogue uses', () => {
    expect(pluralize('can', 1)).toBe('can');
    expect(pluralize('can', 2)).toBe('cans');
    expect(pluralize('loaf', 2)).toBe('loaves');
    expect(pluralize('bunch', 2)).toBe('bunches');
    expect(pluralize('carton', 3)).toBe('cartons');
  });
});

describe('neededQuantity', () => {
  it('counts an each item in its noun when it has one', () => {
    expect(neededQuantity(2, 'each', 'one dozen carton')).toBe('2 cartons');
    expect(neededQuantity(1, 'each', 'one can')).toBe('1 can');
  });

  it('falls back to the size otherwise', () => {
    expect(neededQuantity(2, 'each')).toBe('2 ct');
    expect(neededQuantity(0.7, 'kg')).toBe('700 g');
  });
});

describe('packLineQuantity', () => {
  it('states an each item as a count of its noun and the price of one', () => {
    expect(packLineQuantity({ unit: 'each', packs: 2, packQty: 1, packPrice: 1.5, eachLabel: 'one can' })).toBe('2 cans · $1.50 each');
  });

  it('says one item in its noun, without a per-item price', () => {
    expect(packLineQuantity({ unit: 'each', packs: 1, packQty: 1, packPrice: 1.5, eachLabel: 'one can' })).toBe('1 can');
  });

  it('counts the items in a multi-item pack', () => {
    expect(packLineQuantity({ unit: 'each', packs: 1, packQty: 12, packPrice: 6, eachLabel: 'one dozen carton' })).toBe('12 cartons · $0.50 each');
  });

  it('falls back to a multiplication sign without a label', () => {
    expect(packLineQuantity({ unit: 'each', packs: 2, packQty: 1, packPrice: 1.5 })).toBe('2 × $1.50 each');
    expect(packLineQuantity({ unit: 'each', packs: 1, packQty: 1, packPrice: 1.5 })).toBe('1 each');
  });

  it('shows one weight pack as its size', () => {
    expect(packLineQuantity({ unit: 'kg', packs: 1, packQty: 0.7, packPrice: 5.49 })).toBe('700 g');
  });

  it('shows several weight packs as a count, the size and the price of one', () => {
    expect(packLineQuantity({ unit: 'kg', packs: 2, packQty: 0.7, packPrice: 5.49 })).toBe('2 × 700 g · $5.49 each');
  });
});
