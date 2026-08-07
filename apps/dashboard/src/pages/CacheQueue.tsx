import { MetricChart } from '../components/MetricChart';
import { useSnapshot } from '../api/hooks';
import { StatCard } from '../components/StatCard';
import { fmtPct } from '../lib/format';

interface Props {
  win: { sec: number; step: number };
  nodes: string[];
}

export function CacheQueue({ win, nodes }: Props) {
  const head = nodes[0] ?? '';
  const snap = useSnapshot(5000);
  const s = snap[head] ?? {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <StatCard label="prefix 命中率" value={fmtPct(s['vllm.prefix_hit_rate'])} accent="#6ee7a8" />
        <StatCard label="prefill 缓存占比" value={fmtPct(s['vllm.prompt_cached_pct'])} accent="#6ee7a8" />
        <StatCard label="KV cache 使用" value={fmtPct(s['vllm.kv_usage_pct'])} />
        <StatCard label="运行中请求" value={String(s['vllm.running'] ?? '—')} />
        <StatCard label="等待请求" value={String(s['vllm.waiting'] ?? '—')} />
        <StatCard label="抢占累计" value={String(s['vllm.preemptions'] ?? '—')} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <MetricChart title="prefix 命中率" unit="%" series={[{ node: head, name: 'vllm.prefix_hit_rate', label: '命中率' }]} window={win} nodes={nodes} refreshMs={15000} />
        <MetricChart title="prefill 缓存占比" unit="%" series={[{ node: head, name: 'vllm.prompt_cached_pct', label: 'cached%' }]} window={win} nodes={nodes} refreshMs={15000} />
        <MetricChart title="KV cache 使用率" unit="%" series={[{ node: head, name: 'vllm.kv_usage_pct', label: 'KV%' }]} window={win} nodes={nodes} refreshMs={15000} />
        <MetricChart title="运行/等待" unit="req" series={[{ node: head, name: 'vllm.running', label: 'running' }, { node: head, name: 'vllm.waiting', label: 'waiting' }]} window={win} nodes={nodes} refreshMs={15000} />
        <MetricChart title="抢占累计" unit="" series={[{ node: head, name: 'vllm.preemptions', label: 'preemptions' }]} window={win} nodes={nodes} refreshMs={15000} />
        <MetricChart title="prefix 命中/查询累计" unit="" series={[{ node: head, name: 'vllm.prefix_hits_total', label: 'hits' }, { node: head, name: 'vllm.prefix_queries_total', label: 'queries' }]} window={win} nodes={nodes} refreshMs={15000} />
      </div>
    </div>
  );
}
