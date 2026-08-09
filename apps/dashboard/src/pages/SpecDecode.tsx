import { MetricChart } from '../components/MetricChart';

interface Props {
  win: { sec: number; step: number };
  nodes: string[];
}

const PCT = ['#4fc3f7', '#ffb74d', '#81c784', '#f06292', '#ba68c8', '#26a69a'];

export function SpecDecode({ win, nodes }: Props) {
  const head = nodes[0] ?? '';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <MetricChart
        title="投机接受率 (accepted/draft)" unit="%"
        series={[{ node: head, name: 'vllm.spec_accept_rate', label: '接受率', scale: 100 }]}
        window={win} nodes={nodes} refreshMs={15000}
        yDomain={[0, 100]}
      />
      <MetricChart
        title="平均接受长度" unit="tok"
        series={[{ node: head, name: 'vllm.spec_accept_len', label: 'accept len' }]}
        window={win} nodes={nodes} refreshMs={15000}
      />
      <MetricChart
        title="draft / accepted 吞吐" unit="tok/s"
        series={[
          { node: head, name: 'vllm.spec_draft_total', label: 'draft(tot)' },
          { node: head, name: 'vllm.spec_accept_total', label: 'accepted(tot)' },
        ]}
        window={win} nodes={nodes} refreshMs={15000}
      />
      <MetricChart
        title="MTP 各位置接受率" unit="%"
        series={[0, 1, 2, 3, 4].map((k) => ({ // 与本模型实际发布的 MTP 档位一致（agent 动态采集）
          node: head,
          name: `vllm.spec_pos_${k}_rate`,
          label: `pos${k}`,
          color: PCT[k % PCT.length],
          scale: 100,
        }))}
        window={win} nodes={nodes} refreshMs={15000}
        yDomain={[0, 100]}
      />
    </div>
  );
}
