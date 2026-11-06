// The result sentence under the regular-price button. Pure: no DOM.
import { describe, expect, it } from 'vitest';
import { SITE_AUTH_LINE, siteResultLine } from './SitePrices';

const run = { ok: true, lookups: 38, matched: 31, errors: [], authNeeded: false };

describe('siteResultLine', () => {
  it('says what was looked up, at how many stores, and how many matched', () => {
    expect(siteResultLine(run, 2)).toBe('Looked up 38 items at 2 stores, matched 31.');
  });

  it('says store in the singular for one store', () => {
    expect(siteResultLine(run, 1)).toBe('Looked up 38 items at 1 store, matched 31.');
  });

  it('names the sign-in need in full, so the reader knows why there are no prices', () => {
    expect(SITE_AUTH_LINE).toBe("Loblaw's site needs a PC id sign-in for price search, so regular prices aren't available yet.");
  });
});
