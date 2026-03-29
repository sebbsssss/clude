import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from './AuthContext';
import { api } from '../lib/api';
import type { MemoryStats, MemorySummary } from '../lib/types';

export function useMemory() {
  const { authenticated } = useAuthContext();
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [recent, setRecent] = useState<MemorySummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authenticated) {
      setStats(null);
      setRecent([]);
      return;
    }
    setLoading(true);
    Promise.all([
      api.getMemoryStats().catch(() => null),
      api.getRecentMemories(20).catch(() => []),
    ]).then(([s, r]) => {
      setStats(s);
      setRecent(r);
    }).finally(() => setLoading(false));
  }, [authenticated]);

  const importPack = useCallback(async (pack: any): Promise<number> => {
    const result = await api.importMemoryPack(pack);
    const [s, r] = await Promise.all([
      api.getMemoryStats().catch(() => null),
      api.getRecentMemories(20).catch(() => []),
    ]);
    setStats(s);
    setRecent(r);
    return result.imported;
  }, []);

  return { stats, recent, loading, importPack };
}
