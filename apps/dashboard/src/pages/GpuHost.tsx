import { MetricChart } from '../components/MetricChart';

interface Props {
  win: { sec: number; step: number };
  nodes: string[];
}

export function GpuHost({ win, nodes }: Props) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <MetricChart title="GPU 利用率" unit="%" series={nodes.map((n) => ({ node: n, name: 'host.gpu.util' }))} window={win} nodes={nodes} refreshMs={15000} />
      <MetricChart title="GPU 温度" unit="°C" series={nodes.map((n) => ({ node: n, name: 'host.gpu.temp_c' }))} window={win} nodes={nodes} refreshMs={15000} />
      <MetricChart title="GPU 功耗" unit="W" series={nodes.map((n) => ({ node: n, name: 'host.gpu.power_w' }))} window={win} nodes={nodes} refreshMs={15000} />
      <MetricChart title="SM 时钟" unit="MHz" series={nodes.map((n) => ({ node: n, name: 'host.gpu.sm_mhz' }))} window={win} nodes={nodes} refreshMs={15000} />
      <MetricChart title="CPU 利用率" unit="%" series={nodes.map((n) => ({ node: n, name: 'host.cpu.util' }))} window={win} nodes={nodes} refreshMs={15000} />
      <MetricChart title="负载 (load1)" unit="" series={nodes.map((n) => ({ node: n, name: 'host.load1' }))} window={win} nodes={nodes} refreshMs={15000} />
      <MetricChart title="内存使用" unit="%" series={nodes.map((n) => ({ node: n, name: 'host.mem.used_pct' }))} window={win} nodes={nodes} refreshMs={15000} />
      <MetricChart title="磁盘使用" unit="%" series={nodes.map((n) => ({ node: n, name: 'host.disk.used_pct' }))} window={win} nodes={nodes} refreshMs={15000} />
      <MetricChart title="vLLM 容器 CPU" unit="%" series={nodes.map((n) => ({ node: n, name: 'host.container.cpu_pct' }))} window={win} nodes={nodes} refreshMs={15000} />
      <MetricChart title="vLLM 容器内存" unit="MB" series={nodes.map((n) => ({ node: n, name: 'host.container.mem_mb' }))} window={win} nodes={nodes} refreshMs={15000} />
    </div>
  );
}
