// Central server: dynamic agent configuration (CRUD) + pulls agent TSDBs over
// HTTP + serves REST API and the dashboard. Node list is managed via
// /api/config (Settings UI) and persisted in SQLite — nothing is hardcoded.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.ts';
import { ConfigStore, type NodeCfg } from './config.ts';
import { Puller } from './puller.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const PORT = Number(process.env.PORT ?? 8890);
const DB_PATH = process.env.DB ?? join(ROOT, 'data', 'central.db');
const DIST = process.env.DIST ?? join(ROOT, 'apps/dashboard/dist');

// ---- seed config from env AGENTS (only used when the config table is empty) --
const AGENTS_RAW = process.env.AGENTS ??
  '<HOST_A>=http://<IP_MGMT_A>:9100,<HOST_B>=http://<IP_MGMT_B>:9100';
function parseAgents(raw: string): NodeCfg[] {
  const out: NodeCfg[] = [];
  for (const part of raw.split(',')) {
    if (!part.trim()) continue;
    const eq = part.indexOf('=');
    const id = (eq >= 0 ? part.slice(0, eq) : part).trim();
    const url = (eq >= 0 ? part.slice(eq + 1) : '').trim();
    if (id && url) out.push({ id, name: '', url, enabled: 1 });
  }
  return out;
}

const store = new Store(DB_PATH);
const config = new ConfigStore(DB_PATH, parseAgents(AGENTS_RAW));
const puller = new Puller(() => config.list(), store);
puller.start();

const started = Date.now();

function sendJSON(res: import('node:http').ServerResponse, code: number, v: unknown) {
  const body = JSON.stringify(v);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req: import('node:http').IncomingMessage): Promise<any> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => {
      chunks.push(c as Buffer);
      if (Buffer.concat(chunks).length > 64 * 1024) {
        req.destroy();
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolveBody(JSON.parse(raw));
      } catch (e) {
        reject(e as Error);
      }
    });
    req.on('error', reject);
  });
}

function urlValid(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch {
    return false;
  }
}

function idValid(id: string): boolean {
  return /^[\w.-]{1,64}$/.test(id);
}

// live status merged into config for the Settings UI
function liveNodes(): (NodeCfg & {
  ok: boolean; hostname: string | undefined; rows: number; lastOkTs: number; series: number;
})[] {
  return config.list().map((c) => {
    const a = puller.list().find((x) => x.id === c.id);
    const snap = a ? store.snapshot(c.id) : (({ values: {} }) as any);
    return {
      ...c,
      ok: a?.ok ?? false,
      hostname: a?.hostname,
      rows: a?.rows ?? 0,
      lastOkTs: a?.lastOkTs ?? 0,
      series: Object.keys(snap.values ?? {}).length,
    };
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function serveStatic(res: import('node:http').ServerResponse, urlPath: string) {
  let p = join(DIST, decodeURIComponent(urlPath));
  if (!p.startsWith(DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(p) || extname(p) === '') p = join(DIST, 'index.html');
  if (!existsSync(p)) {
    res.writeHead(404);
    res.end('dashboard not built — run: pnpm --filter dashboard build');
    return;
  }
  const body = readFileSync(p);
  res.writeHead(200, {
    'Content-Type': MIME[extname(p)] ?? 'application/octet-stream',
    'Cache-Control': extname(p) === '.html' ? 'no-cache' : 'max-age=3600',
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = u.pathname.replace(/\/$/, '') || '/';
  const q = u.searchParams;
  const method = req.method ?? 'GET';

  // ---------- config CRUD ----------
  if (path === '/api/config' && method === 'GET') {
    sendJSON(res, 200, { nodes: liveNodes() });
    return;
  }
  if (path === '/api/config' && method === 'POST') {
    try {
      const body = await readBody(req);
      const id = String(body.id ?? '').trim();
      const url = String(body.url ?? '').trim();
      if (!idValid(id)) return sendJSON(res, 400, { error: 'id 非法：1-64 位字母数字/.-_' });
      if (!urlValid(url)) return sendJSON(res, 400, { error: 'url 非法：需 http(s)://...' });
      if (config.get(id)) return sendJSON(res, 409, { error: `节点 ${id} 已存在` });
      config.upsert({ id, name: String(body.name ?? '').trim(), url, enabled: body.enabled === 0 ? 0 : 1 });
      sendJSON(res, 200, { ok: true, nodes: liveNodes() });
    } catch (e) {
      sendJSON(res, 400, { error: '请求体解析失败: ' + (e as Error).message });
    }
    return;
  }
  const cfgMatch = path.match(/^\/api\/config\/nodes\/([^/]+)$/);
  if (cfgMatch && (method === 'PUT' || method === 'DELETE')) {
    const id = decodeURIComponent(cfgMatch[1]);
    const existing = config.get(id);
    if (!existing) return sendJSON(res, 404, { error: `节点 ${id} 不存在` });
    if (method === 'DELETE') {
      config.remove(id);
      sendJSON(res, 200, { ok: true, nodes: liveNodes() });
      return;
    }
    try {
      const body = await readBody(req);
      const next: NodeCfg = { ...existing };
      if (body.name !== undefined) next.name = String(body.name).trim();
      if (body.url !== undefined) {
        const url = String(body.url).trim();
        if (!urlValid(url)) return sendJSON(res, 400, { error: 'url 非法：需 http(s)://...' });
        next.url = url;
      }
      if (body.enabled !== undefined) next.enabled = body.enabled === 1 ? 1 : 0;
      config.upsert(next);
      sendJSON(res, 200, { ok: true, nodes: liveNodes() });
    } catch (e) {
      sendJSON(res, 400, { error: '请求体解析失败: ' + (e as Error).message });
    }
    return;
  }

  // ---------- read APIs ----------
  if (path === '/api/nodes') {
    sendJSON(res, 200, {
      agents: liveNodes()
        .filter((n) => n.enabled === 1)
        .map((n) => ({
          id: n.id, url: n.url, hostname: n.hostname, ok: n.ok,
          lastOkTs: n.lastOkTs, rows: n.rows,
        })),
    });
    return;
  }
  if (path === '/api/health') {
    sendJSON(res, 200, {
      ok: true, started, uptime_s: Math.round((Date.now() - started) / 1000),
      db_rows: store.count(), ts: Date.now() / 1000,
    });
    return;
  }
  if (path === '/api/snapshot') {
    const node = q.get('node') ?? '';
    if (node) {
      const snap = store.snapshot(node);
      sendJSON(res, 200, { node, ts: snap.ts, ...snap.values });
    } else {
      const out: Record<string, unknown> = {};
      for (const a of puller.list()) out[a.id] = store.snapshot(a.id).values;
      sendJSON(res, 200, out);
    }
    return;
  }
  if (path === '/api/series') {
    const node = q.get('node') ?? '';
    if (node) {
      sendJSON(res, 200, { node, series: store.seriesList(node) });
    } else {
      const out: Record<string, unknown> = {};
      for (const a of puller.list()) out[a.id] = store.seriesList(a.id);
      sendJSON(res, 200, out);
    }
    return;
  }
  if (path === '/api/range') {
    const node = q.get('node') ?? '';
    const name = q.get('name') ?? '';
    const from = Number(q.get('from') ?? 0);
    const to = Number(q.get('to') ?? Date.now() / 1000);
    const step = Number(q.get('step') ?? 0);
    if (!node || !name) {
      sendJSON(res, 400, { error: 'need node & name' });
      return;
    }
    sendJSON(res, 200, { node, name, points: store.range(node, name, from, to, step) });
    return;
  }
  if (path.startsWith('/api/')) {
    sendJSON(res, 404, { error: 'unknown api' });
    return;
  }
  serveStatic(res, path);
});

server.listen(PORT, () => {
  console.log(`[server] listening http://0.0.0.0:${PORT}`);
  console.log(`[server] config nodes: ${JSON.stringify(config.list().map((c) => c.id))}`);
  console.log(`[server] db: ${DB_PATH}`);
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
