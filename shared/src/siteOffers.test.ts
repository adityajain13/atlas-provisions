// Regular site prices as offers: the regular price, the window, and the order flyer > site > receipt for one
// ingredient at one store. Also the store location in the household schema and the banner each preset is on.
import { describe, expect, it } from 'vitest';
import { collectOffers, estimateOffers, siteOffers, type ReceiptPrice, type SitePrice } from './offers';
import type { MatchedItem } from './match';
import { HouseholdSchema, defaultHousehold } from './index';
import { isSiteBanner, siteBannerOf, SITE_BANNER_NAMES } from './stores';

const FROM = '2026-10-21';
const TO = '2026-11-04';

const site = (over: Partial<SitePrice>): SitePrice => ({
  ingredientId: 'ground-beef',
  store: 'No Frills',
  date: '2026-11-03',
  pricePerUnit: 12,
  onSale: false,
  packQty: 1,
  ...over,
});

describe('siteOffers', () => {
  it('uses the regular price when the site showed one, so a sale is not the usual price', () => {
    const [o] = siteOffers([site({ pricePerUnit: 9, onSale: true, regularPricePerUnit: 12 })], FROM, TO);
    expect(o).toEqual({
      ingredientId: 'ground-beef',
      store: 'No Frills',
      pricePerUnit: 12,
      packQty: 1,
      packPrice: 12,
      estimate: { basis: 'site', date: '2026-11-03' },
    });
  });

  it('uses the shelf price when it is not on sale', () => {
    expect(siteOffers([site({ pricePerUnit: 4, packQty: 0.5 })], FROM, TO)[0]).toMatchObject({ pricePerUnit: 4, packQty: 0.5, packPrice: 2 });
  });

  it('leaves out a sale with no regular price, since the sale price is no usual price', () => {
    expect(siteOffers([site({ pricePerUnit: 9, onSale: true })], FROM, TO)).toEqual([]);
  });

  it('keeps the latest day per ingredient and store, and ignores days outside the window', () => {
    const offers = siteOffers(
      [
        site({ date: '2026-10-25', pricePerUnit: 10 }),
        site({ date: '2026-11-02', pricePerUnit: 11 }),
        site({ date: '2026-10-01', pricePerUnit: 99 }),
        site({ date: '2026-11-10', pricePerUnit: 98 }),
      ],
      FROM,
      TO,
    );
    expect(offers.map((o) => [o.pricePerUnit, o.estimate?.date])).toEqual([[11, '2026-11-02']]);
  });

  it('prices one base unit when the pack size is unknown', () => {
    expect(siteOffers([site({ packQty: undefined })], FROM, TO)[0]).toMatchObject({ packQty: 1, packPrice: 12 });
  });
});

const flyer = (over: Partial<MatchedItem>): MatchedItem => ({
  id: 'f1',
  store: 'No Frills',
  rawName: 'Ground beef',
  priceText: '$7.99',
  validFrom: '2026-11-01',
  validTo: '2026-11-07',
  source: 'flyer',
  ingredientId: 'ground-beef',
  confidence: 0.9,
  packQty: 1,
  pricePerUnit: 7.99,
  packPrice: 7.99,
  ...over,
});

const all = () => true;

describe('offer priority for one ingredient at one store: flyer, then site, then receipt', () => {
  const receipt: ReceiptPrice[] = [{ ingredientId: 'ground-beef', store: 'No Frills', date: '2026-10-28', pricePerUnit: 6.5, packQty: 1 }];
  const siteOffer = siteOffers([site({ pricePerUnit: 12 })], FROM, TO);
  const receiptOffer = estimateOffers(receipt, '2026-08-01', TO);

  it('takes a flyer price over a site price, even a dearer one', () => {
    const got = collectOffers([], [flyer({})], all, [...siteOffer, ...receiptOffer]);
    expect(got.get('ground-beef')).toEqual([expect.objectContaining({ pricePerUnit: 7.99 })]);
    expect(got.get('ground-beef')?.[0]?.estimate).toBeUndefined();
  });

  it('takes a site price over a receipt price, even a cheaper receipt', () => {
    const got = collectOffers([], [], all, [...siteOffer, ...receiptOffer]);
    expect(got.get('ground-beef')).toEqual([
      expect.objectContaining({ pricePerUnit: 12, estimate: { basis: 'site', date: '2026-11-03' } }),
    ]);
  });

  it('takes a receipt price where no flyer or site price covers the store', () => {
    const got = collectOffers([], [], all, [...siteOffers([], FROM, TO), ...receiptOffer]);
    expect(got.get('ground-beef')).toEqual([expect.objectContaining({ pricePerUnit: 6.5, estimate: { basis: 'receipt', date: '2026-10-28' } })]);
  });

  it('keeps a site price for one store and a flyer price for another', () => {
    const got = collectOffers([], [flyer({ store: 'Metro', id: 'f2' })], all, [...siteOffer]);
    const byStore = Object.fromEntries((got.get('ground-beef') ?? []).map((o) => [o.store, o.estimate?.basis ?? 'flyer']));
    expect(byStore).toEqual({ Metro: 'flyer', 'No Frills': 'site' });
  });
});

describe('stores and the household schema', () => {
  it('maps the Loblaw-family presets to their banners, and leaves other stores out', () => {
    expect(siteBannerOf('no-frills')).toBe('nofrills');
    expect(siteBannerOf('real-canadian-superstore')).toBe('superstore');
    expect(siteBannerOf('tt-supermarket')).toBe('tandt');
    expect(siteBannerOf('metro')).toBeUndefined();
    expect(isSiteBanner('valumart')).toBe(true);
    expect(isSiteBanner('metro')).toBe(false);
    expect(SITE_BANNER_NAMES.nofrills).toBe('No Frills');
  });

  it('accepts a store with a picked location, and an old store without one', () => {
    const base = defaultHousehold();
    const withLocation = {
      ...base,
      stores: [{ id: 'no-frills', name: 'No Frills', enabled: true, priceMatches: true, siteStore: { banner: 'nofrills', storeId: '1234', label: 'No Frills · 1000 Dixie Rd, Mississauga' } }],
    };
    expect(HouseholdSchema.safeParse(withLocation).success).toBe(true);
    const old = { ...base, stores: [{ id: 'metro', name: 'Metro', enabled: true, priceMatches: false }] };
    expect(HouseholdSchema.safeParse(old).success).toBe(true);
  });

  it('rejects a location on a banner the app does not read', () => {
    const base = defaultHousehold();
    const bad = {
      ...base,
      stores: [{ id: 'metro', name: 'Metro', enabled: true, priceMatches: false, siteStore: { banner: 'metro', storeId: '1', label: 'x' } }],
    };
    expect(HouseholdSchema.safeParse(bad).success).toBe(false);
  });
});

