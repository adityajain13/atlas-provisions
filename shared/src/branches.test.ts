// The store fields and banner helpers the branch search and the address rules rely on. Pure.
import { describe, expect, it } from 'vitest';
import { SITE_BANNER_IDS, StoreSchema, presetIdOfBanner, siteBannerOf } from './index';

describe('banner helpers', () => {
  it('lists the Loblaw-family banners whose regular prices are read, not T&T (its site blocks automated lookups)', () => {
    expect(SITE_BANNER_IDS).toEqual(['loblaws', 'nofrills', 'superstore', 'zehrs', 'independent', 'fortinos', 'valumart']);
    expect(siteBannerOf('tt-supermarket')).toBeUndefined();
  });

  it('gives the preset id of a banner, the inverse of siteBannerOf', () => {
    expect(presetIdOfBanner('nofrills')).toBe('no-frills');
    expect(presetIdOfBanner('valumart')).toBe('valu-mart');
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
