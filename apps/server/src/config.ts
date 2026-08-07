// Persistent node/agent configuration (SQLite). This is the source of truth
// for what the panel tracks — no hardcoding. Seeded once from env AGENTS if
// the table is empty, then fully managed via the CRUD API / Settings UI.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface NodeCfg {
  id: string;
  name: string;
  url: string;
  enabled: number;
}

export class ConfigStore {
  private db: DatabaseSync;
  constructor(path: string, seed: NodeCfg[]) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;`);
    this.db.exec(`
CREATE TABLE IF NOT EXISTS config_nodes(
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL DEFAULT '',
  url     TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
) WITHOUT ROWID;`);
    const c = this.db.prepare('SELECT COUNT(*) c FROM config_nodes').get() as { c: number };
    if (c.c === 0 && seed.length) {
      const ins = this.db.prepare('INSERT INTO config_nodes(id, name, url, enabled) VALUES(?,?,?,1)');
      this.db.exec('BEGIN');
      try {
        for (const n of seed) ins.run(n.id, n.name, n.url);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    }
  }

  list(): NodeCfg[] {
    return this.db.prepare('SELECT id, name, url, enabled FROM config_nodes ORDER BY id').all() as NodeCfg[];
  }

  get(id: string): NodeCfg | undefined {
    return this.db.prepare('SELECT id, name, url, enabled FROM config_nodes WHERE id=?').get(id) as
      | NodeCfg
      | undefined;
  }

  upsert(cfg: NodeCfg): void {
    this.db
      .prepare('INSERT OR REPLACE INTO config_nodes(id, name, url, enabled) VALUES(?,?,?,?)')
      .run(cfg.id, cfg.name, cfg.url, cfg.enabled === 0 ? 0 : 1);
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM config_nodes WHERE id=?').run(id);
  }
}
