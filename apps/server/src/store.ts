// Central time-series store: mirrors agent data (node, name, ts, val).
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDb, type DbLike } from './sqlite.ts';

export interface Row {
  n: string; // metric name
  t: number; // unix ts
  v: number; // value
}

export class Store {
  private db: DbLike;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = openDb(path);
    this.db.exec(`PRAGMA journal_mode=WAL;`);
    this.db.exec(`
CREATE TABLE IF NOT EXISTS series(
  node TEXT NOT NULL,
  name TEXT NOT NULL,
  ts   INTEGER NOT NULL,
  val  REAL NOT NULL,
  PRIMARY KEY(node, name, ts)
) WITHOUT ROWID;`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_series_ts ON series(node, ts);`);
    this.db.exec(`
CREATE TABLE IF NOT EXISTS latest(
  node TEXT NOT NULL,
  name TEXT NOT NULL,
  ts   INTEGER NOT NULL,
  val  REAL NOT NULL,
  PRIMARY KEY(node, name)
) WITHOUT ROWID;`);
  }

  lastTs(node: string): number {
    const r = this.db.prepare('SELECT MAX(ts) m FROM series WHERE node = ?').get(node) as { m: number | null };
    return r?.m ?? 0;
  }

  insert(node: string, rows: Row[]): number {
    if (!rows.length) return 0;
    const insSeries = this.db.prepare(
      'INSERT OR REPLACE INTO series(node, name, ts, val) VALUES(?,?,?,?)'
    );
    const insLatest = this.db.prepare(
      'INSERT OR REPLACE INTO latest(node, name, ts, val) VALUES(?,?,?,?)'
    );
    this.db.exec('BEGIN');
    try {
      for (const r of rows) {
        insSeries.run(node, r.n, r.t, r.v);
        insLatest.run(node, r.n, r.t, r.v);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return rows.length;
  }

  offlineUpsert(node: string, rows: Row[]): number {
    return this.insert(node, rows);
  }

  snapshot(node: string): { ts: number; values: Record<string, number> } {
    const rows = this.db.prepare('SELECT name, ts, val FROM latest WHERE node = ?').all(node) as {
      name: string; ts: number; val: number;
    }[];
    const values: Record<string, number> = {};
    let ts = 0;
    for (const r of rows) {
      values[r.name] = r.val;
      if (r.ts > ts) ts = r.ts;
    }
    return { ts, values };
  }

  seriesList(node: string): { name: string; ts: number; val: number }[] {
    return this.db.prepare('SELECT name, ts, val FROM latest WHERE node = ? ORDER BY name').all(node) as {
      name: string; ts: number; val: number;
    }[];
  }

  range(node: string, name: string, from: number, to: number, step: number): { ts: number; val: number }[] {
    // ponytail: node:sqlite binds JS numbers as REAL, so `ts / step` becomes
    // float division and (ts/step)*step round-trips to ts → bucketing never
    // applies → two nodes' ts never align → frontend lines render as M..Z dots.
    // Bind step/from/to as BigInt so SQLite does integer division.
    let q: string;
    let args: (string | number | bigint)[];
    if (step > 0) {
      const s = BigInt(step);
      const f = BigInt(Math.floor(from));
      const t = BigInt(Math.ceil(to));
      q = `SELECT (ts / ?) * ? ts, AVG(val) val FROM series
           WHERE node = ? AND name = ? AND ts >= ? AND ts <= ?
           GROUP BY ts / ? ORDER BY ts`;
      args = [s, s, node, name, f, t, s];
    } else {
      q = `SELECT ts, val FROM series WHERE node = ? AND name = ? AND ts >= ? AND ts <= ? ORDER BY ts`;
      args = [node, name, from, to];
    }
    return this.db.prepare(q).all(...args) as { ts: number; val: number }[];
  }

  count(): number {
    const r = this.db.prepare('SELECT COUNT(*) c FROM series').get() as { c: number };
    return r.c;
  }
}
