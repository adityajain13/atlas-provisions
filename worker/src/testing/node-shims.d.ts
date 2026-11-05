// Minimal typings for the Node built-ins the test harness uses. @types/node is not installed in this repo,
// and these modules are only reached from tests (vitest runs them on Node 22, which ships node:sqlite).
declare module 'node:sqlite' {
  export interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }
  export class StatementSync {
    run(...params: unknown[]): StatementResultingChanges;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string): string[];
}

declare module 'node:module' {
  export function createRequire(path: string | URL): (id: string) => unknown;
}

// The test process (vitest runs from the repo root).
declare const process: { cwd(): string };
