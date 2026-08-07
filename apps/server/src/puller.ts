// Puller: periodically syncs each configured agent's local TSDB into the
// central store over plain HTTP (no SSH in the runtime data path).
// Targets are dynamic — reconciled from the config store on every cycle,
// so adding/editing/removing nodes via the Settings UI takes effect live.
import { Store } from './store.ts';
import type { NodeCfg } from './config.ts';

export interface Agent {
  id: string;       // e.g. head / worker / node-a
  name?: string;    // display name
  url: string;      // e.g. http://<IP_MGMT_A>:9100
  hostname?: string;// reported by the agent itself
  ok: boolean;
  lastOkTs: number;
  rows: number;     // rows pulled in last sync
}

export class Puller {
  private agents = new Map<string, Agent>();
  private getCfg: () => NodeCfg[];
  private store: Store;
  private intervalMs: number;

  constructor(getCfg: () => NodeCfg[], store: Store, intervalMs = 10_000) {
    this.getCfg = getCfg;
    this.store = store;
    this.intervalMs = intervalMs;
  }

  start() {
    void this.syncAll();
    setInterval(() => void this.syncAll(), this.intervalMs);
  }

  // Reconcile in-memory targets with the persisted config (add/update/remove).
  private reconcile(): void {
    const cfgs = this.getCfg().filter((c) => c.enabled === 1);
    const want = new Set(cfgs.map((c) => c.id));
    for (const id of [...this.agents.keys()]) {
      if (!want.has(id)) this.agents.delete(id);
    }
    for (const c of cfgs) {
      let a = this.agents.get(c.id);
      if (!a) {
        a = { id: c.id, name: c.name, url: c.url, ok: false, lastOkTs: 0, rows: 0 };
        this.agents.set(c.id, a);
      }
      a.name = c.name;
      if (a.url !== c.url) a.url = c.url;
    }
  }

  async syncAll(): Promise<void> {
    this.reconcile();
    await Promise.all([...this.agents.values()].map((a) => this.syncOne(a)));
  }

  private async syncOne(a: Agent): Promise<void> {
    try {
      const since = this.store.lastTs(a.id);
      const res = await fetch(`${a.url}/changes?since=${since}&limit=500000`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { rows: { n: string; t: number; v: number }[] };
      const rows = data.rows ?? [];
      const fresh = rows.filter((r) => r.t > since);
      a.rows = this.store.insert(a.id, fresh);
      a.ok = true;
      a.lastOkTs = Date.now();
      if (!a.hostname || a.hostname === a.id) {
        const h = await fetch(`${a.url}/health`, { signal: AbortSignal.timeout(3000) }).then((r) =>
          r.json()
        );
        a.hostname = h?.hostname ?? undefined;
      }
    } catch (err) {
      a.ok = false;
      console.warn(`puller[${a.id}] ${a.url}:`, (err as Error).message);
    }
  }

  list(): Agent[] {
    return [...this.agents.values()];
  }
}
