// The store fields and banner helpers the branch search and the address rules rely on. Pure.
import { describe, expect, it } from 'vitest';
import { LOCATION_BANNER_IDS, StoreSchema, hasLocationList, presetIdOfBanner, siteBannerOf } from './index';

describe('banner helpers', () => {
  it('lists every banner except T&T as searchable', () => {
    expect(LOCATION_BANNER_IDS).toEqual(['loblaws', 'nofrills', 'superstore', 'zehrs', 'independent', 'fortinos', 'valumart']);
    expect(hasLocationList('nofrills')).toBe(true);
    expect(hasLocationList('tandt')).toBe(false);
  });

  it('gives the preset id of a banner, the inverse of siteBannerOf', () => {
    expect(presetIdOfBanner('nofrills')).toBe('no-frills');
    expect(presetIdOfBanner('tandt')).toBe('tt-supermarket');
    expect(siteBannerOf(presetIdOfBanner('superstore')!)).toBe('superstore');
  });
});

describe('the store address field', () => {
  const base = { id: 'metro', name: 'Metro', enabled: true, priceMatches: false };

  it('parses a store with an address, trimmed', () => {
    expect(StoreSchema.parse({ ...base, address: '  1000 Dundas St W  ' })).toMatchObject({ address: '1000 Dundas St W' });
  });

  it('parses a store saved before addresses existed', () => {
    expect(StoreSchema.parse(base)).toEqual(base);
  });

  it('refuses an address longer than 160 characters, and a blank one', () => {
    expect(StoreSchema.safeParse({ ...base, address: 'x'.repeat(161) }).success).toBe(false);
    expect(StoreSchema.safeParse({ ...base, address: '   ' }).success).toBe(false);
  });
});
