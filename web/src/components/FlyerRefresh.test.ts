// The result sentence under the refresh button. Pure: no DOM.
import { describe, expect, it } from 'vitest';
import type { IngestRunSummary } from '@provisions/shared';
import { resultLine } from './FlyerRefresh';

const base: IngestRunSummary = {
  ok: true,
  mode: 'flyers',
  terms: 0,
  flyerCount: 3,
  items: 615,
  kept: 600,
  stored: 640,
  matched: 418,
  storeCounts: [
    { store: 'No Frills', count: 412 },
    { store: 'FreshCo', count: 203 },
  ],
  unmatchedSample: [],
  errors: [],
};

describe('resultLine', () => {
  it('names the flyers and the items per store in flyers mode', () => {
    expect(resultLine(base)).toBe('Found 615 items in 3 flyers (No Frills: 412, FreshCo: 203). 418 matched to ingredients.');
  });

  it('leaves out the store list when there are no stores', () => {
    expect(resultLine({ ...base, storeCounts: [], flyerCount: 0 })).toBe('Found 615 items in 0 flyers. 418 matched to ingredients.');
  });

  it('says the items came from a search in search mode', () => {
    expect(resultLine({ ...base, mode: 'search', terms: 30, flyerCount: 0, storeCounts: [] })).toBe(
      'Found 615 items by search. 418 matched to ingredients.',
    );
  });
});
