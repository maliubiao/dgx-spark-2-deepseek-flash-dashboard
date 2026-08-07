import { MetricChart } from '../components/MetricChart';
import { useSnapshot } from '../api/hooks';
import { StatCard } from '../components/StatCard';
import { fmt, fmtBytesHR } from '../lib/format';

interface Props {
  win: { sec: number; step: number };
  nodes: string[];
}

const FABRIC = ['enp1s0f0np0', 'enp1s0f1np1', 'enP2p1s0f0np0', 'enP2p1s0f1np1'];

export function Network({ win, nodes }: Props) {
  const snap = useSnapshot(5000);
  const totalRx = (n: string) =>
    FABRIC.reduce((acc, f) => acc + Number(snap[n]?.[`host.net.${f}.rx_bps`] ?? 0), 0);
  const totalTx = (n: string) =>
    FABRIC.reduce((acc, f) => acc + Number(snap[n]?.[`host.net.${f}.tx_bps`] ?? 0), 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {nodes.map((n) => (
          <StatCard
            key={n}
            label={`${n} RoCE 链路`}
            value={`${fmt(snap[n]?.['host.roce.active'], 0)} / 2`}
            sub={`⇣ ${fmtBytesHR(totalRx(n))}/s ⇡ ${fmtBytesHR(totalTx(n))}/s`}
            accent={Number(snap[n]?.['host.roce.active']) >= 2 ? '#6ee7a8' : '#ef5350'}
          />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <MetricChart
          title="RoCE 活跃链路" unit=""
          series={nodes.map((n) => ({ node: n, name: 'host.roce.active' }))}
          window={win} nodes={nodes} refreshMs={15000}
        />
        {FABRIC.map((f) => (
          <MetricChart
            key={f}
            title={`${f} 吞吐`} unit="bps"
            series={nodes.map((n) => [
              { node: n, name: `host.net.${f}.rx_bps`, label: `rx@${n}` },
              { node: n, name: `host.net.${f}.tx_bps`, label: `tx@${n}` },
            ]).flat()}
            window={win} nodes={nodes} refreshMs={15000}
            timeFmt={(v: number) => new Date(v * 1000).toLocaleTimeString('zh-CN', { hour12: false })}
          />
        ))}
      </div>
    </div>
  );
}
