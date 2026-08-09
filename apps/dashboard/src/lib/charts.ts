export interface SeriesDef {
  node?: string; // metric belongs to this node id; undefined → plot all nodes
  name: string;  // metric name
  label?: string;
  color?: string;
  scale?: number; // display multiplier after fetch (e.g. 0-1 rate → percent)
}

// node colors
const NODE_COLORS = ['#4fc3f7', '#ffb74d', '#81c784', '#f06292'];
const PCT_COLORS: Record<string, string> = { p50: '#4fc3f7', p90: '#ffb74d', p99: '#ef5350' };

export function seriesColor(nodeId: string, idx: number): string {
  return PCT_COLORS[nodeId] ?? NODE_COLORS[idx % NODE_COLORS.length];
}

export interface WindowDef {
  label: string;
  sec: number;
  step: number;
}

export const WINDOWS: WindowDef[] = [
  { label: '15分', sec: 15 * 60, step: 5 },
  { label: '1小时', sec: 3600, step: 10 },
  { label: '6小时', sec: 6 * 3600, step: 60 },
  { label: '24小时', sec: 86400, step: 300 },
  { label: '7天', sec: 7 * 86400, step: 1800 },
];

export const DEFAULT_WINDOW = 1;
