import { describe, expect, it } from 'vitest';
import { INGREDIENTS } from './catalog';
import { buildSearchTerms, isoDatePart, matchStoreName, normalizePostalCode, priceTextFrom } from './flipp';
import { parsePrice } from './parse';

describe('buildSearchTerms', () => {
  const terms = buildSearchTerms();

  it('gives unique terms, at most 150, none under 3 characters or generic', () => {
    expect(new Set(terms).size).toBe(terms.length);
    expect(terms.length).toBeLessThanOrEqual(150);
    for (const t of terms) {
      expect(t.length).toBeGreaterThanOrEqual(3);
      expect(['egg', 'eggs', 'can', 'canned', 'fresh']).not.toContain(t);
    }
  });

  it('uses the shortest usable alias for each ingredient', () => {
    const chicken = INGREDIENTS.find((i) => i.id === 'chicken-thigh-boneless')!;
    expect(chicken.aliases).toContain('chicken thigh');
    expect(terms).toContain('chicken thigh');
    expect(terms).not.toContain('boneless skinless chicken thighs');
  });

  it('caps the list when there are more ingredients than the cap', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ aliases: [`item ${i}`] }));
    expect(buildSearchTerms(many)).toHaveLength(150);
  });
});

describe('normalizePostalCode', () => {
  it('stores uppercase with no space', () => {
    expect(normalizePostalCode('m5v 2t6')).toBe('M5V2T6');
    expect(normalizePostalCode('M5V-2T6')).toBe('M5V2T6');
  });

  it('rejects anything that is not a postal code', () => {
    expect(normalizePostalCode('12345')).toBeNull();
    expect(normalizePostalCode('M5V 2T')).toBeNull();
    expect(normalizePostalCode('')).toBeNull();
  });
});

describe('matchStoreName', () => {
  const stores = ['No Frills', 'FreshCo', 'Food Basics'];

  it('matches merchant spellings regardless of case, spaces and punctuation', () => {
    expect(matchStoreName('NOFRILLS', stores)).toBe('No Frills');
    expect(matchStoreName('No Frills #1234', stores)).toBe('No Frills');
    expect(matchStoreName('FreshCo.', stores)).toBe('FreshCo');
    expect(matchStoreName('Food Basics Inc', stores)).toBe('Food Basics');
  });

  it('skips merchants that are not household stores, and very short names', () => {
    expect(matchStoreName('Walmart', stores)).toBeNull();
    expect(matchStoreName('Food', stores)).toBeNull();
    expect(matchStoreName('', stores)).toBeNull();
  });
});

describe('isoDatePart', () => {
  it('takes the date part of an ISO datetime', () => {
    expect(isoDatePart('2026-11-12T00:00:00Z')).toBe('2026-11-12');
    expect(isoDatePart('2026-11-12')).toBe('2026-11-12');
    expect(isoDatePart('12/11/2026')).toBeNull();
    expect(isoDatePart(undefined)).toBeNull();
  });
});

describe('priceTextFrom', () => {
  it('builds a multi-buy price that parsePrice reads as 2.50 each', () => {
    const text = priceTextFrom({ pre_price_text: '2/', current_price: 5, post_price_text: '' });
    expect(text).toBe('2/$5');
    expect(parsePrice(text!)).toEqual({ amount: 2.5, per: 'each' });
  });

  it('adds a slash before a bare unit and reads a per-pound price', () => {
    const text = priceTextFrom({ current_price: 1.99, post_price_text: 'lb' });
    expect(text).toBe('$1.99/lb');
    expect(parsePrice(text!)).toEqual({ amount: 1.99, per: 'lb' });
  });

  it('keeps a post text that already has a slash', () => {
    expect(priceTextFrom({ current_price: 4.39, post_price_text: '/kg' })).toBe('$4.39/kg');
  });

  it('falls back to a price in the sale story when there is no current price', () => {
    expect(priceTextFrom({ current_price: null, sale_story: 'Save $1.50 on 2 lb' })).toBe('Save $1.50 on 2 lb');
    expect(priceTextFrom({ current_price: null, post_price_text: '$3.99/lb' })).toBe('$3.99/lb');
  });

  it('returns null when no price can be read', () => {
    expect(priceTextFrom({ current_price: null, sale_story: 'Ask in store' })).toBeNull();
    expect(priceTextFrom({})).toBeNull();
  });
});
