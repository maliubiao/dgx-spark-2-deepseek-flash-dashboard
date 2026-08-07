export const fmt = (v: number | undefined, digits = 1): string =>
  v === undefined || Number.isNaN(v) ? '—' : v.toFixed(digits);

// format a seconds value as ms when tiny, else seconds
const s2s = (v: number): string => (v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`);

export const fmtLatency = (v: number | undefined): string =>
  v === undefined || Number.isNaN(v) || v === 0 ? '—' : s2s(v);

export const fmtRate = (v: number | undefined): string =>
  v === undefined ? '—' : `${v.toFixed(1)} tok/s`;

export const fmtPct = (v: number | undefined): string =>
  v === undefined || Number.isNaN(v) ? '—' : `${v.toFixed(1)}%`;

export const fmtBytesHR = (v: number | undefined): string => {
  if (v === undefined || Number.isNaN(v) || v <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
};

export const timeLabel = (tsSec: number): string =>
  new Date(tsSec * 1000).toLocaleTimeString('zh-CN', { hour12: false });
