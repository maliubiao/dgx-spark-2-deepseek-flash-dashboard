import { useEffect, useState } from 'react';
import { getNodes, getSnapshot, type NodeInfo, type AllSnapshots } from './client';

export function useNodes(intervalMs = 10_000): { nodes: NodeInfo[]; refresh: () => void } {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const refresh = () => void getNodes().then(setNodes).catch(() => {});
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return { nodes, refresh };
}

export function useSnapshot(intervalMs = 5000): AllSnapshots {
  const [snap, setSnap] = useState<AllSnapshots>({});
  useEffect(() => {
    let stop = false;
    const load = () =>
      void getSnapshot()
        .then((d) => !stop && setSnap(d))
        .catch(() => {});
    load();
    const t = setInterval(load, intervalMs);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [intervalMs]);
  return snap;
}
