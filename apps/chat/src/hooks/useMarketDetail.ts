import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { MarketDetailResponse } from '../lib/types';

export function useMarketDetail(memoryId: number | null) {
  const [data, setData] = useState<MarketDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getMarketDetail(id);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load market detail');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (memoryId != null) {
      load(memoryId);
    }
  }, [memoryId, load]);

  return { data, loading, error, reload: () => memoryId != null && load(memoryId) };
}
