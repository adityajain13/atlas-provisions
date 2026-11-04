import { describe, expect, it } from 'vitest';
import { INGREDIENTS } from './catalog';
import {
  buildSearchTerms,
  collapseIssues,
  fallbackSearchTerms,
  isoDatePart,
  matchStoreName,
  normalizePostalCode,
  priceTextFrom,
  priceTextFromParts,
} from './flipp';
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

  it('skips merchants that are not household stores, and very short names', () => {
    expect(matchStoreName('Walmart', stores)).toBeNull();
    expect(matchStoreName('Food', stores)).toBeNull();
    expect(matchStoreName('', stores)).toBeNull();
  });

  it('matches a Flipp name alias and returns the store name', () => {
    const rcss = { name: 'Real Canadian Superstore', flippNames: ['Superstore', 'RCSS'] };
    expect(matchStoreName('Superstore', [rcss])).toBe('Real Canadian Superstore');
    expect(matchStoreName('RCSS', [rcss])).toBe('Real Canadian Superstore');
    expect(matchStoreName('Real Canadian Superstore #77', [rcss])).toBe('Real Canadian Superstore');
  });

  it('matches a custom store by a Flipp name that is not part of its own name', () => {
    const grocer = { name: 'Corner Grocer', flippNames: ['Sunny Mart'] };
    expect(matchStoreName('SUNNY MART #12', [grocer])).toBe('Corner Grocer');
    expect(matchStoreName('Corner Grocer', [grocer])).toBe('Corner Grocer');
    expect(matchStoreName('Sunny Mart Bakery Downtown', [grocer])).toBe('Corner Grocer');
  });

  it('never matches a store that is not in the list, even if it had a Flipp name', () => {
    expect(matchStoreName('Sunny Mart', [])).toBeNull();
    expect(matchStoreName('Sunny Mart', [{ name: 'FreshCo' }])).toBeNull();
  });

  it('matches a short alias only when it is the whole merchant name', () => {
    const rcss = { name: 'Real Canadian Superstore', flippNames: ['RCSS'] };
    expect(matchStoreName('RCSS', [rcss])).toBe('Real Canadian Superstore');
    expect(matchStoreName('RCSS Sudbury', [rcss])).toBeNull();
  });

  it('prefers an exact match over a substring one', () => {
    const big = { name: 'Loblaws', flippNames: ['Loblaws City Market'] };
    const small = { name: 'City Market', flippNames: [] };
    expect(matchStoreName('Loblaws City Market', [big, small])).toBe('Loblaws');
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

describe('fallbackSearchTerms', () => {
  const terms = fallbackSearchTerms();

  it('has at most 30 unique terms, proteins first, then common produce', () => {
    expect(terms.length).toBeLessThanOrEqual(30);
    expect(new Set(terms).size).toBe(terms.length);
    expect(terms[0]).toBe(buildSearchTerms(INGREDIENTS.filter((i) => i.category === 'meat').slice(0, 1))[0]);
    expect(terms).toContain('broccoli');
    expect(terms).toContain('carrot');
    // Every term is a meat or seafood term before any produce term.
    const firstProduce = terms.findIndex((t) => t === 'broccoli');
    const meat = INGREDIENTS.filter((i) => i.category === 'meat' || i.category === 'seafood' || i.protein === 'egg' || i.protein === 'tofu');
    const meatTerms = new Set(buildSearchTerms(meat));
    for (let i = 0; i < firstProduce; i++) expect(meatTerms.has(terms[i]!)).toBe(true);
  });

  it('takes a smaller limit when asked', () => {
    expect(fallbackSearchTerms(5)).toHaveLength(5);
  });
});

describe('collapseIssues', () => {
  it('keeps a single issue with its label', () => {
    expect(collapseIssues([{ label: 'chicken', message: 'HTTP 503' }], 'searches')).toEqual(['chicken: HTTP 503']);
  });

  it('merges identical messages into one line with a count, in first-seen order', () => {
    const msg = 'Too many subrequests by single Worker invocation';
    const issues = [
      { label: 'a', message: msg },
      { label: 'b', message: 'HTTP 404' },
      { label: 'c', message: msg },
      { label: 'd', message: msg },
    ];
    expect(collapseIssues(issues, 'searches')).toEqual([`${msg} (3 searches)`, 'b: HTTP 404']);
  });

  it('gives a bare message when there is no label', () => {
    expect(collapseIssues([{ message: 'Flyer list HTTP 500' }], 'requests')).toEqual(['Flyer list HTTP 500']);
  });
});

describe('priceTextFromParts', () => {
  it('builds text parsePrice reads, adding the slash to a bare unit', () => {
    expect(priceTextFromParts('', '$4.39', 'kg')).toBe('$4.39/kg');
    expect(priceTextFromParts('', '2/$5', '')).toBe('2/$5');
  });

  it('returns null when the result has no price', () => {
    expect(priceTextFromParts('', 'call', '')).toBeNull();
  });
});
