import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { getRange, type Point } from '../api/client';
import { seriesColor, type SeriesDef } from '../lib/charts';

interface Props {
  title: string;
  unit?: string;
  series: SeriesDef[];
  window: { sec: number; step: number };
  nodes: string[];       // node ids to plot (for node-less defs)
  refreshMs?: number;    // >0 → live auto refresh
  height?: number;
  yDomain?: [number | 'auto', number | 'auto'];
  timeFmt?: (v: number) => string;
}

type Row = Record<string, number | string>;

function keyFor(s: SeriesDef): string {
  return [s.node ?? '*', s.name].join('@');
}

function mergeRows(data: Map<string, { ts: number; val: number }[]>): Row[] {
  const byTs = new Map<number, Row>();
  for (const [key, pts] of data) {
    for (const p of pts) {
      let row = byTs.get(p.ts);
      if (!row) {
        row = { ts: p.ts };
        byTs.set(p.ts, row);
      }
      row[key] = +p.val.toFixed(2);
    }
  }
  return [...byTs.values()].sort((a, b) => (a.ts as number) - (b.ts as number));
}

export function MetricChart({
  title, unit, series, window, nodes, refreshMs, height = 230, yDomain, timeFmt,
}: Props) {
  const [data, setData] = useState<Row[]>([]);

  const resolved = useMemo(() => {
    const out: { key: string; label: string; color: string; name: string; node: string }[] = [];
    for (const s of series) {
      const targets = s.node ? [s.node] : nodes;
      targets.forEach((n, i) => {
        out.push({
          key: keyFor({ ...s, node: n }),
          label: s.label ?? `${s.name}@${n}`,
          color: s.color ?? seriesColor(s.node ?? n, i),
          name: s.name,
          node: n,
        });
      });
    }
    return out;
  }, [series, nodes.join(',')]);

  const keySig = JSON.stringify(resolved.map((r) => r.key));

  useEffect(() => {
    let stop = false;
    async function load() {
      const to = Math.floor(Date.now() / 1000);
      const from = to - window.sec;
      const results: [string, Point[]][] = await Promise.all(
        resolved.map((r) =>
          getRange(r.node, r.name, from, to, window.step)
            .then((pts) => [r.key, pts] as [string, Point[]])
            .catch(() => [r.key, [] as Point[]] as [string, Point[]])
        )
      );
      if (stop) return;
      setData(mergeRows(new Map(results)));
    }
    void load();
    if (refreshMs && refreshMs > 0) {
      const t = setInterval(load, refreshMs);
      return () => {
        stop = true;
        clearInterval(t);
      };
    }
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keySig, window.sec, window.step, refreshMs]);

  const axisTick = (v: number) =>
    timeFmt ? timeFmt(v) : new Date(v * 1000).toLocaleTimeString('zh-CN', { hour12: false });
  const fmtBody =
    unit === '%'
      ? (v: number) => `${v.toFixed(1)}%`
      : unit === 'tok/s'
        ? (v: number) => v.toFixed(0)
        : (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));

  return (
    <div style={{ background: '#111720', border: '1px solid #1e2836', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#cfd8e6' }}>{title}</span>
        {unit && <span style={{ fontSize: 11, color: '#7c8aa0' }}>{unit}</span>}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
          <CartesianGrid stroke="#1e2836" strokeDasharray="3 3" />
          <XAxis
            dataKey="ts"
            tickFormatter={axisTick}
            stroke="#5a6a84"
            fontSize={10}
            minTickGap={40}
            tick={{ fill: '#7c8aa0' }}
          />
          <YAxis
            stroke="#5a6a84"
            fontSize={10}
            tick={{ fill: '#7c8aa0' }}
            tickFormatter={fmtBody}
            domain={yDomain ?? ['auto', 'auto']}
            width={54}
          />
          <Tooltip
            labelFormatter={(l) => axisTick(l as number)}
            contentStyle={{ background: '#0b0e14', border: '1px solid #2a3648', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#cfd8e6' }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: '#9fb0c8' }} />
          {resolved.map((r) => (
            <Line
              key={r.key}
              dataKey={r.key}
              name={r.label}
              stroke={r.color}
              strokeWidth={1.6}
              dot={false}
              isAnimationActive={false}
              type="monotone"
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
