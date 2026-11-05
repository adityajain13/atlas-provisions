// An in-memory D1 for tests: the real migrations run on node:sqlite, and the statements are the Worker's own.
// Only the D1 surface the Worker uses is here: prepare/bind, first, all, run, batch.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

// Loaded through require: Vite 5 does not resolve node:sqlite as a built-in, and this only runs under Node.
const { DatabaseSync } = createRequire(`${process.cwd()}/`)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType;
};
type DatabaseSync = DatabaseSyncType;

type Value = string | number | bigint | null | Uint8Array;

/** The directory the migrations are in, relative to the repo root (the directory vitest runs from). */
const MIGRATIONS_DIR = 'worker/migrations';

/** Migration files in order, with their SQL. */
export function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
    .map((name) => ({ name, sql: readFileSync(`${MIGRATIONS_DIR}/${name}`, 'utf8') }));
}

/** Applies the migrations in order. With `upTo`, only those whose file name starts with a number at or below it. */
export function applyMigrations(raw: DatabaseSync, upTo?: string): void {
  for (const { name, sql } of migrationFiles()) {
    if (upTo !== undefined && name > upTo) break;
    raw.exec(sql);
  }
}

const toParam = (v: unknown): Value | boolean => {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v as Value;
};

class Statement {
  constructor(
    private readonly raw: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(this.raw, this.sql, values.map(toParam));
  }

  /** Runs the statement now. Used by batch() and by the methods below. */
  exec(): { changes: number } {
    const info = this.raw.prepare(this.sql).run(...(this.params as never[]));
    return { changes: Number(info.changes) };
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.raw.prepare(this.sql).get(...(this.params as never[]));
    if (!row) return null;
    if (column !== undefined) return (row[column] ?? null) as T;
    return row as T;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true; meta: Record<string, never> }> {
    const results = this.raw.prepare(this.sql).all(...(this.params as never[])) as T[];
    return { results, success: true, meta: {} };
  }

  async run(): Promise<{ success: true; results: never[]; meta: { changes: number } }> {
    return { success: true, results: [], meta: { changes: this.exec().changes } };
  }
}

/** A D1Database over an open node:sqlite handle. Batches run in one transaction, as in D1. */
export function d1Over(raw: DatabaseSync): D1Database {
  const db = {
    prepare: (sql: string) => new Statement(raw, sql),
    async batch(statements: Statement[]) {
      raw.exec('BEGIN');
      try {
        const results = statements.map((s) => ({ success: true, results: [], meta: { changes: s.exec().changes } }));
        raw.exec('COMMIT');
        return results;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
    async exec(sql: string) {
      raw.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
  return db as unknown as D1Database;
}

/** A fresh in-memory database with every migration applied. */
export function newTestDb(upTo?: string): { raw: DatabaseSync; DB: D1Database } {
  const raw = new DatabaseSync(':memory:');
  applyMigrations(raw, upTo);
  return { raw, DB: d1Over(raw) };
}
