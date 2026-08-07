import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
}

export function StatCard({ label, value, sub, accent }: Props) {
  return (
    <div
      style={{
        background: '#111720',
        border: '1px solid #1e2836',
        borderRadius: 10,
        padding: '12px 14px',
        minWidth: 130,
        flex: '1 1 0',
      }}
    >
      <div style={{ fontSize: 11, color: '#7c8aa0', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, marginTop: 6, color: accent ?? '#e8eef8' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: '#8fa0b8', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
