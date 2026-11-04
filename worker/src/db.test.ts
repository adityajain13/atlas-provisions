// The flyer query prices a plan week from the flyers valid on its Sunday. No real D1 here.
import { describe, expect, it } from 'vitest';
import { currentFlyerItems } from './db';

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
