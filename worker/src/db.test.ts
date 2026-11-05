// The flyer queries and the latest run, against a real in-memory database.
import { describe, expect, it } from 'vitest';
import { currentFlyerItems, latestIngestRun, overlappingFlyerItems } from './db';
import { newTestDb } from './testing/d1';

function seeded() {
  const { DB, raw } = newTestDb();
  const flyer = (id: string, postal: string, from: string, to: string, store = 'No Frills') =>
    raw
      .prepare(
        `INSERT INTO flyer_items (postal_code, id, store, raw_name, price_text, valid_from, valid_to, source, fetched_at)
         VALUES (?, ?, ?, ?, '$1', ?, ?, 'flipp', 'now')`,
      )
      .run(postal, id, store, `Item ${id}`, from, to);
  flyer('on-day', 'M5V2T6', '2026-11-12', '2026-11-18');
  flyer('other-postal', 'K1A0B1', '2026-11-12', '2026-11-18');
  flyer('overlap', 'M5V2T6', '2026-11-17', '2026-11-23');
  flyer('ended', 'M5V2T6', '2026-10-01', '2026-10-31');
  return { DB, raw };
}

describe('currentFlyerItems', () => {
  it('selects flyer items for the postal code valid on the date: started on or before it, and not yet ended', async () => {
    const { DB } = seeded();
    const items = await currentFlyerItems(DB, 'M5V2T6', '2026-11-15');
    expect(items.map((i) => i.id)).toEqual(['on-day']);
  });
});

describe('overlappingFlyerItems', () => {
  it('selects the flyers of the postal code that overlap the range', async () => {
    const { DB } = seeded();
    const items = await overlappingFlyerItems(DB, 'M5V2T6', '2026-11-15', '2026-11-21');
    expect(items.map((i) => i.id).sort()).toEqual(['on-day', 'overlap']);
  });
});

describe('latestIngestRun', () => {
  function withRun(raw: ReturnType<typeof seeded>['raw'], postal: string) {
    raw
      .prepare(
        `INSERT INTO ingest_runs (id, postal_code, started_at, finished_at, ok, mode, terms, flyers, items, kept, stored, matched, errors, sample)
         VALUES ('run-1', ?, '2026-11-01T12:00:00.000Z', '2026-11-01T12:01:00.000Z', 1, 'flyers', 0, ?, 3, 3, 4, 3, ?, ?)`,
      )
      .run(
        postal,
        JSON.stringify([{ id: '7', merchant: 'NOFRILLS', name: 'Weekly', store: 'No Frills', items: 3 }]),
        JSON.stringify(['flyer list HTTP 500']),
        JSON.stringify([{ id: 1 }]),
      );
  }

  it('leaves out the sample and the flyer list unless debug is asked for', async () => {
    const { DB, raw } = seeded();
    withRun(raw, 'M5V2T6');
    const out = await latestIngestRun(DB, 'M5V2T6');
    expect(out).toEqual({
      id: 'run-1',
      startedAt: '2026-11-01T12:00:00.000Z',
      finishedAt: '2026-11-01T12:01:00.000Z',
      ok: true,
      mode: 'flyers',
      terms: 0,
      flyerCount: 1,
      items: 3,
      kept: 3,
      stored: 4,
      matched: 3,
      errors: ['flyer list HTTP 500'],
    });
  });

  it('adds the sample and the flyers in debug mode', async () => {
    const { DB, raw } = seeded();
    withRun(raw, 'M5V2T6');
    const out = await latestIngestRun(DB, 'M5V2T6', { debug: true });
    expect(out).toMatchObject({
      sample: [{ id: 1 }],
      flyers: [{ id: '7', merchant: 'NOFRILLS', name: 'Weekly', store: 'No Frills', items: 3 }],
    });
  });

  it('returns only the runs of the postal code asked for, and null when there are none', async () => {
    const { DB, raw } = seeded();
    withRun(raw, 'K1A0B1');
    expect(await latestIngestRun(DB, 'M5V2T6')).toBeNull();
    expect(await latestIngestRun(DB, 'K1A0B1')).toMatchObject({ id: 'run-1' });
  });
});
