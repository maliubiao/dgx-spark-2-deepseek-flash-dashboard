// SQLite adapter: works under both Node (node:sqlite) and Bun (bun:sqlite).
// The central server previously imported node:sqlite directly, which Bun
// (>=1.0) does not implement — it only ships bun:sqlite. This module picks
// whichever is available so the same code runs on the Mac (node) and gen8
// (bun). The two drivers expose a compatible subset:
//   exec(sql), prepare(sql).run(...) / .get(...) / .all(...)

interface Stmt {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | null | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

export interface DbLike {
  exec(sql: string): void;
  prepare(sql: string): Stmt;
  close(): void;
}

type DbCtor = new (path: string) => DbLike;

let Database: DbCtor;
let driver: 'node' | 'bun' = 'node';

try {
  const ns = await import('node:sqlite');
  const Ctor = (ns as Record<string, unknown>).DatabaseSync as DbCtor;
  if (typeof Ctor === 'function') {
    Database = Ctor;
    driver = 'node';
  }
} catch {
  // node:sqlite unavailable (running under Bun) -> fall through to bun:sqlite
}

if (!Database) {
  const bs = await import('bun:sqlite');
  const Ctor = (bs as Record<string, unknown>).Database as DbCtor;
  if (typeof Ctor !== 'function') {
    throw new Error('no usable sqlite driver: node:sqlite and bun:sqlite both missing');
  }
  Database = Ctor;
  driver = 'bun';
}

export function openDb(path: string): DbLike {
  return new Database(path);
}

export function sqliteDriver(): string {
  return driver;
}

export function isBunDriver(): boolean {
  return driver === 'bun';
}
