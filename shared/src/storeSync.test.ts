// The per-store sync state: fresh, stale or none, the flyer's valid day, the labels and the relative times. Pure.
import { describe, expect, it } from 'vitest';
import { relativeAgo, storeSyncDetail, storeSyncLabel, storeSyncPartLine, storeSyncState, syncSourcesOf, type SyncSource } from './storeSync';

const NOW = new Date('2026-11-06T15:00:00.000Z'); // 10:00 on Nov 6 in Toronto
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number, base: Date = NOW) => new Date(base.getTime() - ms).toISOString();

const shelf = (at: string, count = 380): SyncSource => ({ source: 'shelf', at, count });
const flyer = (at: string, validTo: string, count = 142): SyncSource => ({ source: 'flyer', at, count, validTo });

describe('storeSyncState', () => {
  it('is none when no source has read the store', () => {
    expect(storeSyncState([], NOW)).toEqual({ state: 'none', lastAt: null, parts: [] });
  });

  it('ignores a shelf or T&T source with no prices', () => {
    expect(storeSyncState([{ source: 'tnt', at: ago(HOUR), count: 0 }], NOW)).toEqual({ state: 'none', lastAt: null, parts: [] });
  });

  it('is fresh when the newest read is recent', () => {
    const at = ago(3 * HOUR);
    expect(storeSyncState([shelf(at)], NOW)).toEqual({ state: 'fresh', lastAt: at, parts: [shelf(at)] });
  });

  it('is fresh at exactly seven days and stale a minute later', () => {
    expect(storeSyncState([shelf(ago(7 * DAY))], NOW).state).toBe('fresh');
    expect(storeSyncState([shelf(ago(7 * DAY + 60_000))], NOW).state).toBe('stale');
  });

  it('is stale when the newest read is older than seven days', () => {
    const at = ago(9 * DAY);
    expect(storeSyncState([shelf(at)], NOW)).toMatchObject({ state: 'stale', lastAt: at });
  });

  it('takes lastAt from the newest source, not the first', () => {
    const newest = ago(2 * HOUR);
    const result = storeSyncState([shelf(ago(DAY)), { source: 'tnt', at: newest, count: 9 }], NOW);
    expect(result.lastAt).toBe(newest);
    expect(result.state).toBe('fresh');
  });

  it('is fresh while the flyer is valid today', () => {
    expect(storeSyncState([flyer(ago(HOUR), '2026-11-06')], NOW).state).toBe('fresh');
    expect(storeSyncState([flyer(ago(HOUR), '2026-11-12')], NOW).state).toBe('fresh');
  });

  it('is stale when the flyer ended yesterday, even if the shelf read is recent', () => {
    const result = storeSyncState([flyer(ago(DAY), '2026-11-05'), shelf(ago(HOUR))], NOW);
    expect(result.state).toBe('stale');
    expect(result.lastAt).toBe(ago(HOUR));
  });

  it('uses the Toronto day for the flyer: 22:00 on Nov 5 in Toronto is still Nov 5', () => {
    const lateNight = new Date('2026-11-06T03:00:00.000Z');
    expect(storeSyncState([flyer(ago(HOUR, lateNight), '2026-11-05')], lateNight).state).toBe('fresh');
    expect(storeSyncState([flyer(ago(HOUR, lateNight), '2026-11-04')], lateNight).state).toBe('stale');
  });

  it('keeps an expired flyer in parts so the label can say so', () => {
    const f = flyer(ago(DAY), '2026-10-30', 0);
    const result = storeSyncState([f], NOW);
    expect(result).toEqual({ state: 'stale', lastAt: f.at, parts: [f] });
  });
});

describe('relativeAgo', () => {
  it('reads under a minute as just now, and a future time too', () => {
    expect(relativeAgo(ago(0), NOW)).toBe('just now');
    expect(relativeAgo(ago(59_000), NOW)).toBe('just now');
    expect(relativeAgo(ago(-5 * 60_000), NOW)).toBe('just now');
    expect(relativeAgo('not a time', NOW)).toBe('just now');
  });

  it('counts minutes, then hours, up to a day', () => {
    expect(relativeAgo(ago(60_000), NOW)).toBe('1 min ago');
    expect(relativeAgo(ago(5 * 60_000), NOW)).toBe('5 min ago');
    expect(relativeAgo(ago(59 * 60_000 + 59_000), NOW)).toBe('59 min ago');
    expect(relativeAgo(ago(HOUR), NOW)).toBe('1 h ago');
    expect(relativeAgo(ago(3 * HOUR), NOW)).toBe('3 h ago');
    expect(relativeAgo(ago(DAY - 60_000), NOW)).toBe('23 h ago');
  });

  it('counts days up to a week, then names the calendar day', () => {
    expect(relativeAgo(ago(DAY), NOW)).toBe('1 day ago');
    expect(relativeAgo(ago(2 * DAY), NOW)).toBe('2 days ago');
    expect(relativeAgo(ago(7 * DAY - HOUR), NOW)).toBe('6 days ago');
    expect(relativeAgo(ago(7 * DAY), NOW)).toBe('Oct 30');
    expect(relativeAgo(ago(30 * DAY), NOW)).toBe('Oct 7');
  });

  it('adds the year for a day in an earlier year', () => {
    const newYear = new Date('2027-01-03T15:00:00.000Z');
    expect(relativeAgo('2026-12-20T15:00:00.000Z', newYear)).toBe('Dec 20, 2026');
  });
});

describe('storeSyncLabel', () => {
  it('says synced with the relative time when fresh or stale', () => {
    expect(storeSyncLabel(storeSyncState([shelf(ago(3 * HOUR))], NOW), NOW)).toBe('Synced 3 h ago');
    expect(storeSyncLabel(storeSyncState([shelf(ago(9 * DAY))], NOW), NOW)).toBe('Synced Oct 28');
  });

  it('says the flyer expired when its valid day has passed', () => {
    expect(storeSyncLabel(storeSyncState([flyer(ago(DAY), '2026-11-05')], NOW), NOW)).toBe('Flyer expired');
  });

  it('says not synced when nothing is read', () => {
    expect(storeSyncLabel(storeSyncState([], NOW), NOW)).toBe('Not synced');
  });
});

describe('storeSyncDetail', () => {
  it('lists each source with its count, the calendar day and the flyer valid day', () => {
    const sources = [flyer('2026-11-05T13:00:00.000Z', '2026-11-12', 142), shelf('2026-11-04T13:00:00.000Z', 380)];
    expect(storeSyncDetail(storeSyncState(sources, NOW), NOW)).toBe(
      'Flyer: 142 items, fetched Nov 5, valid to Nov 12 · Regular prices: 380, Nov 4',
    );
  });

  it('is empty when nothing is read', () => {
    expect(storeSyncDetail(storeSyncState([], NOW), NOW)).toBe('');
  });
});

describe('storeSyncPartLine', () => {
  it('names the source, the count and the time, with the singular unit for one', () => {
    expect(storeSyncPartLine(flyer(ago(3 * HOUR), '2026-11-12', 142), NOW)).toBe('Flyers: 142 items, 3 h ago');
    expect(storeSyncPartLine({ source: 'tnt', at: ago(HOUR), count: 1 }, NOW)).toBe('T&T prices: 1 price, 1 h ago');
  });
});

describe('syncSourcesOf', () => {
  it('lists the sources a store has, in flyer, regular, T&T order', () => {
    expect(
      syncSourcesOf({
        tnt: { at: '2026-11-06T09:00:00.000Z', count: 3 },
        flyer: { at: '2026-11-05T12:00:00.000Z', count: 2, validTo: '2026-11-12' },
      }),
    ).toEqual([
      { source: 'flyer', at: '2026-11-05T12:00:00.000Z', count: 2, validTo: '2026-11-12' },
      { source: 'tnt', at: '2026-11-06T09:00:00.000Z', count: 3 },
    ]);
  });

  it('is empty for a store nothing has read', () => {
    expect(syncSourcesOf({})).toEqual([]);
  });
});
