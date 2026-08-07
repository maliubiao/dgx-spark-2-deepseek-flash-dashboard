// Typed API client for the central server.
export interface NodeInfo {
  id: string;
  url: string;
  hostname: string;
  ok: boolean;
  lastOkTs: number;
  rows: number;
}

export type Snapshot = Record<string, number>;
export type AllSnapshots = Record<string, Snapshot>;

export interface Point {
  ts: number;
  val: number;
}

export async function getNodes(): Promise<NodeInfo[]> {
  const r = await fetch('/api/nodes');
  if (!r.ok) throw new Error('nodes');
  const d = (await r.json()) as { agents: NodeInfo[] };
  return d.agents ?? [];
}

export async function getSnapshot(): Promise<AllSnapshots> {
  const r = await fetch('/api/snapshot');
  if (!r.ok) throw new Error('snapshot');
  return (await r.json()) as AllSnapshots;
}

export async function getRange(
  node: string,
  name: string,
  from: number,
  to: number,
  step: number
): Promise<Point[]> {
  const p = new URLSearchParams({ node, name, from: String(from), to: String(to), step: String(step) });
  const r = await fetch(`/api/range?${p}`);
  if (!r.ok) throw new Error(`range ${node}/${name}`);
  const d = (await r.json()) as { points: Point[] };
  return d.points ?? [];
}

export async function getRangeRaw(node: string, name: string): Promise<Point[]> {
  return getRange(node, name, 0, Date.now() / 1000, 0);
}

// ── 配置 CRUD ──
export interface NodeCfg {
  id: string;
  name: string;
  url: string;
  enabled: number;
  ok: boolean;
  hostname?: string;
  rows: number;
  lastOkTs: number;
  series: number;
}

export async function getConfig(): Promise<NodeCfg[]> {
  const r = await fetch('/api/config');
  if (!r.ok) throw new Error('config');
  const d = (await r.json()) as { nodes: NodeCfg[] };
  return d.nodes ?? [];
}

export async function saveNode(cfg: {
  id?: string;
  name?: string;
  url?: string;
  enabled?: number;
}): Promise<void> {
  const isEdit = !!cfg.id;
  const r = await fetch(isEdit ? `/api/config/nodes/${encodeURIComponent(cfg.id!)}` : '/api/config', {
    method: isEdit ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: isEdit
      ? JSON.stringify({ name: cfg.name, url: cfg.url, enabled: cfg.enabled })
      : JSON.stringify({ id: cfg.id, name: cfg.name, url: cfg.url, enabled: cfg.enabled }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error((d as { error?: string }).error ?? `HTTP ${r.status}`);
  }
}

export async function deleteNode(id: string): Promise<void> {
  const r = await fetch(`/api/config/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

