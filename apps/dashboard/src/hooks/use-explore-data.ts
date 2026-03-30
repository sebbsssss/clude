import { useState, useCallback, useEffect } from 'react';
import { api } from '../lib/api';
import type { MemoryLink } from '../types/memory';

interface GraphNode {
  id: number;
  type: string;
  summary: string;
  content: string;
  tags: string[];
  importance: number;
  decay: number;
  valence: number;
  accessCount: number;
  source: string;
  createdAt: string;
}

export function useExploreData() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<MemoryLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getMemoryGraph({ limit: 50000 });
      setNodes(result.nodes);
      setLinks(result.links);
    } catch (err: any) {
      setError(err.message || 'Failed to load graph');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (cancelled) return;
      await loadGraph();
    };
    load();
    const unsub = api.onRefresh(load);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [loadGraph]);

  return { nodes, links, loading, error, reload: loadGraph };
}
