import { useSnapshot } from '../api/hooks';
import { StatCard } from '../components/StatCard';
import { MetricChart } from '../components/MetricChart';
import { NodeBadges } from '../components/NodeBadges';
import { fmt, fmtRate, fmtPct, fmtPctRate, fmtLatency } from '../lib/format';

interface Props {
  win: { sec: number; step: number };
  nodes: string[];
}

export function Overview({ win, nodes }: Props) {
  const snap = useSnapshot(5000);
  const head = nodes[0] ?? '';
  const headSnap = snap[head] ?? {};

  const gpuCards = nodes.map((n) => {
    const s = snap[n] ?? {};
    return (
      <StatCard
        key={n}
        label={`GPU ${n}`}
        value={`${fmt(s['host.gpu.util'])}%`}
        sub={`${fmt(s['host.gpu.temp_c'], 0)}°C · ${fmt(s['host.gpu.power_w'], 0)}W`}
        accent={Number(s['host.gpu.util']) > 60 ? '#ffb74d' : undefined}
      />
    );
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <NodeBadges snap={snap} nodes={nodes} />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <StatCard label="解码吞吐" value={fmtRate(headSnap['vllm.decode_tok_s'])} />
        <StatCard label="prefill 吞吐" value={fmtRate(headSnap['vllm.prompt_tok_s'])} />
        <StatCard label="KV cache 使用" value={fmtPct(headSnap['vllm.kv_usage_pct'])} />
        <StatCard label="prefix 命中率" value={fmtPctRate(headSnap['vllm.prefix_hit_rate'])} accent="#6ee7a8" />
        <StatCard label="投机接受率" value={fmtPctRate(headSnap['vllm.spec_accept_rate'])} />
        <StatCard label="平均接受长度" value={fmt(headSnap['vllm.spec_accept_len'], 1)} />
        <StatCard label="运行/等待" value={`${fmt(headSnap['vllm.running'], 0)} / ${fmt(headSnap['vllm.waiting'], 0)}`} />
        <StatCard label="TTFT p50" value={fmtLatency(headSnap['vllm.ttft_p50'])} />
        <StatCard label="单token延迟 p50" value={fmtLatency(headSnap['vllm.itl_p50'])} />
        {gpuCards}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <MetricChart
          title="GPU 利用率" unit="%"
          series={nodes.map((n) => ({ node: n, name: 'host.gpu.util' }))}
          window={win} nodes={nodes} refreshMs={10000} height={210}
        />
        <MetricChart
          title="解码吞吐" unit="tok/s"
          series={[{ node: head, name: 'vllm.decode_tok_s', label: 'decode tok/s' }]}
          window={win} nodes={nodes} refreshMs={10000} height={210}
        />
        <MetricChart
          title="KV cache 使用率" unit="%"
          series={[{ node: head, name: 'vllm.kv_usage_pct' }]}
          window={win} nodes={nodes} refreshMs={10000} height={210}
        />
        <MetricChart
          title="运行/等待请求数" unit="req"
          series={[
            { node: head, name: 'vllm.running', label: 'running', color: '#4fc3f7' },
            { node: head, name: 'vllm.waiting', label: 'waiting', color: '#ffb74d' },
          ]}
          window={win} nodes={nodes} refreshMs={10000} height={210}
        />
      </div>
    </div>
  );
}
