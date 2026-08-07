import { useEffect, useState } from 'react';
import { useNodes } from './api/hooks';
import { Overview } from './pages/Overview';
import { GpuHost } from './pages/GpuHost';
import { ThroughputLatency } from './pages/ThroughputLatency';
import { SpecDecode } from './pages/SpecDecode';
import { CacheQueue } from './pages/CacheQueue';
import { Network } from './pages/Network';
import { Settings } from './pages/Settings';
import { WINDOWS, DEFAULT_WINDOW } from './lib/charts';
import { WindowPicker } from './components/WindowPicker';

type Tab = 'overview' | 'gpu' | 'throughput' | 'spec' | 'cache' | 'network' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: '总览' },
  { id: 'gpu', label: 'GPU/主机' },
  { id: 'throughput', label: '吞吐/延迟' },
  { id: 'spec', label: '投机解码' },
  { id: 'cache', label: '缓存/队列' },
  { id: 'network', label: '网络' },
  { id: 'settings', label: '节点配置' },
];

export default function App() {
  const [tab, setTabState] = useState<Tab>(
    (window.location.hash.slice(1).replace(/^\//, '') as Tab) || 'overview'
  );
  const [winIdx, setWinIdx] = useState(DEFAULT_WINDOW);
  const { nodes } = useNodes(10_000);
  const ids = nodes.map((n) => n.id);
  const win = WINDOWS[winIdx];

  const setTab = (t: Tab) => {
    setTabState(t);
    window.location.hash = '/' + t;
  };

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.slice(1).replace(/^\//, '') as Tab;
      if (TABS.some((t) => t.id === h)) setTabState(h);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#0b0e14' }}>
      <header
        style={{
          display: 'flex', alignItems: 'center', gap: 18, padding: '12px 20px',
          borderBottom: '1px solid #1e2836', background: '#0e1320',
          position: 'sticky', top: 0, zIndex: 10,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 16, color: '#e8eef8' }}>
          DGX Spark 集群监控
          <span style={{ fontSize: 11, color: '#5f7190', marginLeft: 10, fontWeight: 400 }}>
            DeepSeek-V4-Flash · TP2
          </span>
        </div>
        <nav style={{ display: 'flex', gap: 4, flex: 1 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                border: 'none', background: tab === t.id ? '#1c2638' : 'transparent',
                color: tab === t.id ? '#e8eef8' : '#94a3bb', borderRadius: 8,
                padding: '6px 14px', fontSize: 13, cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <WindowPicker idx={winIdx} onChange={setWinIdx} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
          {nodes.map((n) => (
            <span key={n.id} style={{ color: n.ok ? '#6ee7a8' : '#ef5350' }} title={n.url}>
              ● {n.id}
              {n.hostname && n.hostname !== n.id ? ` (${n.hostname})` : ''}
            </span>
          ))}
        </div>
      </header>
      <main style={{ padding: 18, maxWidth: 1400, margin: '0 auto' }}>
        {tab === 'overview' && <Overview win={win} nodes={ids} />}
        {tab === 'gpu' && <GpuHost win={win} nodes={ids} />}
        {tab === 'throughput' && <ThroughputLatency win={win} nodes={ids} />}
        {tab === 'spec' && <SpecDecode win={win} nodes={ids} />}
        {tab === 'cache' && <CacheQueue win={win} nodes={ids} />}
        {tab === 'network' && <Network win={win} nodes={ids} />}
        {tab === 'settings' && <Settings />}
      </main>
    </div>
  );
}
