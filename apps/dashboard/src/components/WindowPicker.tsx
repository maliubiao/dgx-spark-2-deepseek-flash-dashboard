import { WINDOWS } from '../lib/charts';

interface Props {
  idx: number;
  onChange: (idx: number) => void;
}

export function WindowPicker({ idx, onChange }: Props) {
  return (
    <div style={{ display: 'flex', gap: 4, background: '#141a26', padding: 3, borderRadius: 8 }}>
      {WINDOWS.map((w, i) => (
        <button
          key={w.label}
          onClick={() => onChange(i)}
          style={{
            border: 'none',
            borderRadius: 6,
            padding: '4px 12px',
            cursor: 'pointer',
            fontSize: 12,
            color: i === idx ? '#0b0e14' : '#9fb0c8',
            background: i === idx ? '#4fc3f7' : 'transparent',
          }}
        >
          {w.label}
        </button>
      ))}
    </div>
  );
}
