// The flyer query prices a plan week from the flyers valid on its Sunday. No real D1 here.
import { describe, expect, it } from 'vitest';
import { currentFlyerItems, latestIngestRun } from './db';

describe('currentFlyerItems', () => {
  it('selects flyer items valid on the date: started on or before it, and not yet ended', () => {
    const calls: { sql: string; args: unknown[] }[] = [];
    const db = {
      prepare(sql: string) {
        let args: unknown[] = [];
        const stmt = {
          bind(...values: unknown[]) {
            args = values;
            return stmt;
          },
          async all() {
            calls.push({ sql, args });
            return { results: [] };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;

    return currentFlyerItems(db, '2026-11-15').then(() => {
      expect(calls).toHaveLength(1);
      expect(calls[0]!.sql).toContain('valid_from <= ?');
      expect(calls[0]!.sql).toContain('valid_to >= ?');
      expect(calls[0]!.args).toEqual(['2026-11-15', '2026-11-15']);
    });
  });
});

describe('latestIngestRun', () => {
  const row = {
    id: 'run-1',
    started_at: '2026-11-01T12:00:00.000Z',
    finished_at: '2026-11-01T12:01:00.000Z',
    ok: 1,
    mode: 'flyers',
    terms: 0,
    flyers: JSON.stringify([{ id: '7', merchant: 'NOFRILLS', name: 'Weekly', store: 'No Frills', items: 3 }]),
    items: 3,
    kept: 3,
    stored: 4,
    matched: 3,
    errors: JSON.stringify(['flyer list HTTP 500']),
    sample: JSON.stringify([{ id: 1 }]),
  };

  function dbReturning(r: unknown) {
    const sqls: string[] = [];
    const db = {
      prepare(sql: string) {
        sqls.push(sql);
        return { first: async () => r };
      },
    } as unknown as D1Database;
    return { db, sqls };
  }

  it('leaves out the sample and the flyer list unless debug is asked for', async () => {
    const { db, sqls } = dbReturning(row);
    const out = await latestIngestRun(db);
    expect(sqls[0]).not.toContain('sample');
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
    const { db, sqls } = dbReturning(row);
    const out = await latestIngestRun(db, { debug: true });
    expect(sqls[0]).toContain('sample');
    expect(out).toMatchObject({
      sample: [{ id: 1 }],
      flyers: [{ id: '7', merchant: 'NOFRILLS', name: 'Weekly', store: 'No Frills', items: 3 }],
    });
  });

  it('returns null when there has been no run', async () => {
    const { db } = dbReturning(null);
    expect(await latestIngestRun(db)).toBeNull();
  });
});
