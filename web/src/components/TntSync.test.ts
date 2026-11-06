// The T&T sync's wording and key storage, as pure functions. No DOM.
import { describe, expect, it } from 'vitest';
import { BOOKMARK_WARNING, deviceLabel, lastSyncedLine, lastUsedLine, syncDoneLine, syncProgressLine } from './TntSync';

const NOW = Date.parse('2026-11-05T12:00:00.000Z');
const twoDaysAgo = new Date(NOW - 2 * 86_400_000).toISOString();

describe('lastSyncedLine', () => {
  it('says it is loading, never synced, or when it last synced with the prices count', () => {
    expect(lastSyncedLine(null, NOW)).toBe('Loading…');
    expect(lastSyncedLine({ enabled: true, lastRun: null, prices: 0 }, NOW)).toBe('Never synced');
    const line = lastSyncedLine({ enabled: true, lastRun: { finishedAt: twoDaysAgo, ok: true, lookups: 38, matched: 34 }, prices: 34 }, NOW);
    expect(line).toMatch(/^Last synced .+ · 34 prices$/);
  });

  it('says price in the singular for one price', () => {
    const line = lastSyncedLine({ enabled: true, lastRun: { finishedAt: twoDaysAgo, ok: true, lookups: 1, matched: 1 }, prices: 1 }, NOW);
    expect(line.endsWith('· 1 price')).toBe(true);
  });
});

describe('sync wording', () => {
  it('shows how far the search has got', () => {
    expect(syncProgressLine({ done: 12, total: 38 })).toBe('Searching 12 of 38…');
  });

  it('says what was saved, in the singular where it is one', () => {
    expect(syncDoneLine({ stored: 31, searched: 38 })).toBe('Saved 31 prices from 38 searches.');
    expect(syncDoneLine({ stored: 1, searched: 1 })).toBe('Saved 1 price from 1 search.');
  });

  it('shows the reason when there was nothing to look up', () => {
    expect(syncDoneLine({ stored: 0, searched: 0, reason: "T&T isn't one of your stores" })).toBe("T&T isn't one of your stores");
  });

  it('warns that the bookmark carries the household key, and says how to stop it', () => {
    expect(BOOKMARK_WARNING).toBe("This bookmark contains your household's sync key. Don't share it; revoke it under Devices if you do.");
  });
});

describe('deviceLabel', () => {
  it('names the browser and the system from the user agent', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0')).toBe('Firefox on Windows');
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36')).toBe('Chrome on Android');
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15')).toBe('Safari on Mac');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0')).toBe('Edge on Windows');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iPhone');
  });

  it('falls back when nothing is recognised', () => {
    expect(deviceLabel('')).toBe('This browser');
  });
});

describe('lastUsedLine', () => {
  it('says when a key was last used, or that it never was', () => {
    expect(lastUsedLine(null, NOW)).toBe('Never used');
    expect(lastUsedLine(twoDaysAgo, NOW)).toMatch(/^Last used .+/);
  });
});
