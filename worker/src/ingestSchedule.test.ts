// The Sunday job: which postal code is refreshed each hour, the household stores that feed it, the manual
// refresh cooldown is in ingest.test.ts. Real in-memory database, stubbed fetch, no network.
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { defaultHousehold, planWeekOf, type Household, type StoreMatchInput } from '@provisions/shared';
import worker, { runSunday } from './index';
import { pickStalestPostal, postalStatus, postalTargets, runScheduledIngest, type PostalStatus, type PostalTarget } from './ingest';
import { count, setup } from './testing/app';

const NO_WAIT = { sleep: async () => {}, spacingMs: 0, retryDelayMs: 0 };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
/** A Flipp that has no flyers and no search results: each run takes the search path and writes a run row. */
const emptyFlipp = () => vi.fn(async () => json({ flyers: [], items: [] }));

const WEDNESDAY_UTC = new Date('2026-11-04T10:00:00.000Z');
const SUNDAY_11PM_UTC = new Date('2026-11-01T23:00:00.000Z');

function household(over: Partial<Household> = {}): Household {
  const h = defaultHousehold();
  return { ...h, postalCode: 'M5V2T6', stores: h.stores.map((s) => ({ ...s, enabled: s.name === 'No Frills' })), ...over };
}

/** Stores a household document directly (the job reads every household's document). */
function addHousehold(raw: DatabaseSync, id: string, doc: unknown) {
  raw.prepare("INSERT INTO households (id, name, data, created_at, updated_at) VALUES (?, ?, ?, 'now', 'now')").run(id, id, JSON.stringify(doc));
}

describe('pickStalestPostal', () => {
  const t = (postal: string): PostalTarget => ({ postal, stores: [{ name: 'No Frills' }] });

  it('returns nothing when every postal code is fresh this week', () => {
    const status = new Map<string, PostalStatus>([['M5V2T6', { lastAttempt: '2026-11-02T10:00:00Z', fresh: true }]]);
    expect(pickStalestPostal([t('M5V2T6')], status)).toBeUndefined();
  });

  it('picks a postal code that has never been attempted before one that has', () => {
    const status = new Map<string, PostalStatus>([['M5V2T6', { lastAttempt: '2026-10-25T10:00:00Z', fresh: false }]]);
    expect(pickStalestPostal([t('M5V2T6'), t('K1A0B1')], status)?.postal).toBe('K1A0B1');
  });

  it('picks the one attempted longest ago', () => {
    const status = new Map<string, PostalStatus>([
      ['M5V2T6', { lastAttempt: '2026-11-02T10:00:00Z', fresh: false }],
      ['K1A0B1', { lastAttempt: '2026-10-28T10:00:00Z', fresh: false }],
    ]);
    expect(pickStalestPostal([t('M5V2T6'), t('K1A0B1')], status)?.postal).toBe('K1A0B1');
  });

  it('does not keep choosing a postal code whose refresh keeps failing, since its attempt is recent', () => {
    const status = new Map<string, PostalStatus>([
      ['M5V2T6', { lastAttempt: '2026-11-01T11:00:00Z', fresh: false }], // failed an hour ago
      ['K1A0B1', { lastAttempt: '2026-10-25T10:00:00Z', fresh: false }], // a week old
    ]);
    expect(pickStalestPostal([t('M5V2T6'), t('K1A0B1')], status)?.postal).toBe('K1A0B1');
  });
});

describe('postalTargets', () => {
  it('lists each postal code once, with the enabled stores of every household that uses it', async () => {
    const { raw, DB } = await setup([], {});
    addHousehold(raw, 'h_a', household({ postalCode: 'M5V2T6' }));
    addHousehold(
      raw,
      'h_b',
      household({
        postalCode: 'M5V2T6',
        stores: [
          { id: 'freshco', name: 'FreshCo', enabled: true, priceMatches: false, flippNames: ['Fresh Co'] },
          { id: 'walmart', name: 'Walmart', enabled: false, priceMatches: false },
        ],
      }),
    );
    addHousehold(raw, 'h_c', household({ postalCode: 'K1A0B1', stores: [] }));
    addHousehold(raw, 'h_d', household({ postalCode: undefined }));
    raw.prepare("INSERT INTO households (id, name, data, created_at, updated_at) VALUES ('h_bad', 'bad', 'not json', 'now', 'now')").run();

    const targets = await postalTargets(DB);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.postal).toBe('M5V2T6');
    const named = (s: StoreMatchInput) => (typeof s === 'string' ? { name: s } : s);
    expect(targets[0]!.stores.map((s) => named(s).name).sort()).toEqual(['FreshCo', 'No Frills']);
    expect(targets[0]!.stores.map(named).find((s) => s.name === 'FreshCo')).toEqual({ name: 'FreshCo', flippNames: ['Fresh Co'] });
  });
});

describe('runScheduledIngest (the hourly Sunday job)', () => {
  it('refreshes the one stale postal code, and does not delete old weeks before 23:00 UTC', async () => {
    const { raw, DB } = await setup([], {});
    addHousehold(raw, 'h_a', household());
    raw.prepare("INSERT INTO meal_plans (household_id, week_of, data, created_at) VALUES ('h_a', '2026-08-02', '{}', 'old')").run();
    const fetchMock = emptyFlipp();

    const out = await runScheduledIngest({ DB }, WEDNESDAY_UTC, fetchMock as unknown as typeof fetch, NO_WAIT);

    expect(out.postal).toBe('M5V2T6');
    expect(out.summary?.ok).toBe(true);
    expect(out.pruned).toBeNull();
    expect(count(raw, 'meal_plans')).toBe(1);
    expect(raw.prepare('SELECT postal_code FROM ingest_runs').all()).toEqual([{ postal_code: 'M5V2T6' }]);
  });

  it('deletes plans and ticks past the retention window in the 23:00 UTC run', async () => {
    const { raw, DB } = await setup([], {});
    addHousehold(raw, 'h_a', household());
    raw.prepare("INSERT INTO meal_plans (household_id, week_of, data, created_at) VALUES ('h_a', '2026-08-02', '{}', 'old')").run();
    raw.prepare("INSERT INTO meal_plans (household_id, week_of, data, created_at) VALUES ('h_a', '2026-10-25', '{}', 'kept')").run();
    raw.prepare("INSERT INTO checks (household_id, week_of, kind, item_id, checked, updated_at) VALUES ('h_a', '2026-08-02', 'list', 'x', 1, 'old')").run();

    const out = await runScheduledIngest({ DB }, SUNDAY_11PM_UTC, emptyFlipp() as unknown as typeof fetch, NO_WAIT);

    expect(out.postal).toBe('M5V2T6');
    expect(out.pruned).toEqual({ plans: 1, checks: 1 });
    expect(raw.prepare('SELECT week_of FROM meal_plans ORDER BY week_of').all()).toEqual([{ week_of: '2026-10-25' }]);
    expect(count(raw, 'checks')).toBe(0);
  });

  it('does nothing else when every postal code is fresh, and still runs the retention pass', async () => {
    const { raw, DB } = await setup([], {});
    addHousehold(raw, 'h_a', household());
    raw
      .prepare(
        `INSERT INTO ingest_runs (id, postal_code, started_at, finished_at, ok, mode, terms, flyers, items, kept, stored, matched, errors, sample)
         VALUES ('r', 'M5V2T6', ?, ?, 1, 'flyers', 0, '[]', 0, 0, 0, 0, '[]', '[]')`,
      )
      .run(`${planWeekOf(WEDNESDAY_UTC)}T11:00:00.000Z`, `${planWeekOf(WEDNESDAY_UTC)}T11:01:00.000Z`);
    raw.prepare("INSERT INTO meal_plans (household_id, week_of, data, created_at) VALUES ('h_a', '2026-08-02', '{}', 'old')").run();
    const fetchMock = emptyFlipp();

    const out = await runScheduledIngest({ DB }, WEDNESDAY_UTC, fetchMock as unknown as typeof fetch, NO_WAIT);

    expect(out).toEqual({ postal: null, summary: null, pruned: { plans: 1, checks: 0 } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(count(raw, 'meal_plans')).toBe(0);
  });

  it('takes the postal codes in turn, one per run, so every household gets its flyers', async () => {
    const { raw, DB } = await setup([], {});
    addHousehold(raw, 'h_a', household({ postalCode: 'M5V2T6' }));
    addHousehold(raw, 'h_b', household({ postalCode: 'K1A0B1' }));
    const fetchMock = emptyFlipp();
    const env = { DB };

    const first = await runScheduledIngest(env, WEDNESDAY_UTC, fetchMock as unknown as typeof fetch, NO_WAIT);
    const second = await runScheduledIngest(env, new Date('2026-11-04T11:00:00.000Z'), fetchMock as unknown as typeof fetch, NO_WAIT);
    const third = await runScheduledIngest(env, new Date('2026-11-04T12:00:00.000Z'), fetchMock as unknown as typeof fetch, NO_WAIT);

    expect([first.postal, second.postal].sort()).toEqual(['K1A0B1', 'M5V2T6']);
    expect(third.postal).toBeNull();
  });

  it('is what the Worker runs on its scheduled event, with the event time', async () => {
    const { raw, DB, env } = await setup([], {});
    raw.prepare("INSERT INTO meal_plans (household_id, week_of, data, created_at) VALUES ('h_a', '2026-08-02', '{}', 'old')").run();
    const waitUntil = vi.fn();
    worker.scheduled({ scheduledTime: SUNDAY_11PM_UTC.getTime() } as unknown as ScheduledEvent, { ...(env as object), DB } as never, {
      waitUntil,
    } as unknown as ExecutionContext);
    const promise = waitUntil.mock.calls[0]![0] as Promise<unknown>;
    await expect(promise).resolves.toEqual({ postal: null, summary: null, pruned: { plans: 1, checks: 0 } });
    expect(count(raw, 'meal_plans')).toBe(0);
  });

  it('keeps the retention pass callable on its own', async () => {
    const { raw, DB } = await setup([], {});
    raw.prepare("INSERT INTO meal_plans (household_id, week_of, data, created_at) VALUES ('h_a', '2026-08-02', '{}', 'old')").run();
    await expect(runSunday({ DB } as never, SUNDAY_11PM_UTC)).resolves.toMatchObject({ postal: null, pruned: { plans: 1 } });
    expect(count(raw, 'meal_plans')).toBe(0);
  });
});

describe('the cron', () => {
  it('runs hourly on Sundays, as wrangler.jsonc sets it', () => {
    const config = readFileSync('wrangler.jsonc', 'utf8');
    expect(config).toContain('"crons": ["0 * * * SUN"]');
  });
});

describe('postalStatus', () => {
  it('marks a postal code fresh only with a successful run since the week started', async () => {
    const { raw, DB } = await setup([], {});
    const insert = (id: string, postal: string, startedAt: string, ok: number) =>
      raw
        .prepare(
          `INSERT INTO ingest_runs (id, postal_code, started_at, finished_at, ok, mode, terms, flyers, items, kept, stored, matched, errors, sample)
           VALUES (?, ?, ?, ?, ?, 'flyers', 0, '[]', 0, 0, 0, 0, '[]', '[]')`,
        )
        .run(id, postal, startedAt, startedAt, ok);
    insert('old-ok', 'M5V2T6', '2026-10-25T11:00:00.000Z', 1);
    insert('new-fail', 'K1A0B1', '2026-11-02T11:00:00.000Z', 0);
    const status = await postalStatus(DB, '2026-11-01');
    expect(status.get('M5V2T6')).toEqual({ lastAttempt: '2026-10-25T11:00:00.000Z', fresh: false });
    expect(status.get('K1A0B1')).toEqual({ lastAttempt: '2026-11-02T11:00:00.000Z', fresh: false });
  });
});
