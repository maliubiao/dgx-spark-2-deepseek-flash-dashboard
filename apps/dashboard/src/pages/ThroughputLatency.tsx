import { MetricChart } from '../components/MetricChart';

interface Props {
  win: { sec: number; step: number };
  nodes: string[];
}

export function ThroughputLatency({ win, nodes }: Props) {
  const head = nodes[0] ?? '';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <MetricChart title="解码吞吐" unit="tok/s" series={[{ node: head, name: 'vllm.decode_tok_s', label: 'decode' }, { node: head, name: 'vllm.prompt_tok_s', label: 'prefill' }, { node: head, name: 'vllm.iter_tok_s', label: 'engine step' }]} window={win} nodes={nodes} refreshMs={15000} />
      <MetricChart title="TTFT" unit="s" series={[{ node: head, name: 'vllm.ttft_p50', label: 'p50' }, { node: head, name: 'vllm.ttft_p90', label: 'p90' }, { node: head, name: 'vllm.ttft_p99', label: 'p99' }]} window={win} nodes={nodes} refreshMs={15000} />
      <MetricChart title="单 token 延迟 (ITL)" unit="s" series={[{ node: head, name: 'vllm.itl_p50', label: 'p50' }, { node: head, name: 'vllm.itl_p90', label: 'p90' }, { node: head, name: 'vllm.itl_p99', label: 'p99' }]} window={win} nodes={nodes} refreshMs={15000} />
      <MetricChart title="端到端延迟" unit="s" series={[{ node: head, name: 'vllm.e2e_p50', label: 'p50' }, { node: head, name: 'vllm.e2e_p90', label: 'p90' }, { node: head, name: 'vllm.e2e_p99', label: 'p99' }]} window={win} nodes={nodes} refreshMs={15000} />
      <MetricChart title="排队时间" unit="s" series={[{ node: head, name: 'vllm.queue_p50', label: 'p50' }, { node: head, name: 'vllm.queue_p90', label: 'p90' }, { node: head, name: 'vllm.queue_p99', label: 'p99' }]} window={win} nodes={nodes} refreshMs={15000} />
      <MetricChart title="累计 token" unit="" series={[{ node: head, name: 'vllm.gen_tok_total', label: 'generation' }, { node: head, name: 'vllm.prompt_tok_total', label: 'prompt' }]} window={win} nodes={nodes} refreshMs={15000} />
      <div style={{ gridColumn: '1 / -1', fontSize: 12, color: '#7c8aa0' }}>
        延迟指标来自 vLLM 的直方图分位数（每采集周期一次），单位秒；吞吐为采集窗口内的增量速率。
      </div>
    </div>
  );
}
