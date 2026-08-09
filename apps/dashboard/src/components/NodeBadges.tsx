import type { AllSnapshots } from '../api/client';

interface Props {
  snap: AllSnapshots;
  nodes: string[];
}

const COLORS = ['#4fc3f7', '#ffb74d', '#81c784'];

// 5-level health: agent ok? vllm reachable? gpu present?
function level(s: Record<string, number>): { color: string; text: string } {
  if (s['host.gpu.present'] === 1) return { color: '#6ee7a8', text: '正常' };
  if (!s['host.gpu.present'] && Object.keys(s).length > 0) return { color: '#ffb74d', text: '降级' };
  return { color: '#ef5350', text: '离线' };
}

// vLLM 状态：无 vllm.* 系列 = 该节点没接入 vLLM（如 worker）而非“空闲”。
function vllmState(s: Record<string, number>): string {
  if (!Object.keys(s).some((k) => k.startsWith('vllm.'))) return '未接入';
  return Number(s['vllm.decode_tok_s']) > 0 ? '活跃' : '空闲';
}

export function NodeBadges({ snap, nodes }: Props) {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {nodes.map((n, i) => {
        const s = snap[n] ?? {};
        const lv = level(s);
        return (
          <div
            key={n}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: '#111720', border: '1px solid #1e2836', borderRadius: 10,
              padding: '8px 14px',
            }}
          >
            <span
              style={{ width: 10, height: 10, borderRadius: 5, background: lv.color, boxShadow: `0 0 8px ${lv.color}` }}
            />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#e8eef8' }}>{n}</span>
            <span style={{ fontSize: 11, color: '#7c8aa0' }}>{lv.text}</span>
            <span style={{ fontSize: 11, color: COLORS[i % COLORS.length] }}>
              vLLM: {vllmState(s)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
