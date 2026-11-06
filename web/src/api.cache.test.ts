// The week screen's household and ratings reads: one fetch serves repeat reads, a save here drops the cached value,
// and a rating read through getRatings refreshes it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultHousehold, type Rating } from '@provisions/shared';

const RATING: Rating = { id: 'r1', mealName: 'Dal', personId: 'p1', rating: 'up', ingredientIds: [], date: '2026-11-06' };

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('cached household and ratings reads', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  // The cache lives in the module, so each test loads a fresh copy of it.
  let api: typeof import('./api');

  beforeEach(async () => {
    vi.resetModules();
    api = await import('./api');
    fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/household') && init?.method === 'PUT') return json(defaultHousehold());
      if (input.endsWith('/household')) return json(defaultHousehold());
      if (input.endsWith('/ratings') && init?.method === 'POST') return json(RATING);
      if (input.endsWith('/ratings')) return json([RATING]);
      throw new Error(`unexpected ${input}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const calls = (suffix: string) => fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith(suffix) && (init as RequestInit | undefined)?.method !== 'POST' && (init as RequestInit | undefined)?.method !== 'PUT').length;

  it('serves repeat household reads from one fetch', async () => {
    await api.getHouseholdCached();
    await api.getHouseholdCached();
    expect(calls('/household')).toBe(1);
  });

  it('fetches the household again after it is saved', async () => {
    await api.getHouseholdCached();
    await api.saveHousehold(defaultHousehold());
    await api.getHouseholdCached();
    expect(calls('/household')).toBe(2);
  });

  it('serves repeat rating reads from one fetch, and a rating save drops the cache', async () => {
    expect(await api.getRatingsCached()).toEqual([RATING]);
    await api.getRatingsCached();
    expect(calls('/ratings')).toBe(1);
    await api.saveRating({ mealName: 'Dal', personId: 'p1', rating: 'up', ingredientIds: [] });
    await api.getRatingsCached();
    expect(calls('/ratings')).toBe(2);
  });

  it('keeps the rating a getRatings call read, so the next cached read does not fetch again', async () => {
    await api.getRatings();
    await api.getRatingsCached();
    expect(calls('/ratings')).toBe(1);
  });

  it('reads again once the cached value is a minute old', async () => {
    vi.useFakeTimers();
    await api.getHouseholdCached();
    vi.setSystemTime(Date.now() + 61_000);
    await api.getHouseholdCached();
    expect(calls('/household')).toBe(2);
  });
});
