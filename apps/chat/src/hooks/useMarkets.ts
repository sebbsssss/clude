import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import type { CompoundMarket, CompoundMarketsResponse, MarketCategory, MarketSortKey, CompoundPrediction, LiveMarket, isPrediction as isPred } from '../lib/types';
import { isPrediction } from '../lib/types';

export interface MarketFilters {
  category: MarketCategory | 'all';
  sort: MarketSortKey;
  source: 'memory' | 'live';
}

const DEFAULT_FILTERS: MarketFilters = {
  category: 'all',
  sort: 'edge',
  source: 'memory',
};

function sortMarkets(markets: CompoundMarket[], sort: MarketSortKey): CompoundMarket[] {
  return [...markets].sort((a, b) => {
    if (sort === 'edge') {
      const aEdge = isPrediction(a) ? (a as CompoundPrediction).edge ?? 0 : 0;
      const bEdge = isPrediction(b) ? (b as CompoundPrediction).edge ?? 0 : 0;
      return bEdge - aEdge;
    }
    if (sort === 'confidence') {
      const aC = isPrediction(a) ? (a as CompoundPrediction).confidence ?? 0 : 0;
      const bC = isPrediction(b) ? (b as CompoundPrediction).confidence ?? 0 : 0;
      return bC - aC;
    }
    if (sort === 'closeDate') {
      const aDate = new Date(a.closeDate || 0).getTime();
      const bDate = new Date(b.closeDate || 0).getTime();
      return aDate - bDate;
    }
    if (sort === 'volume') {
      const aVol = !isPrediction(a) ? (a as LiveMarket).volume ?? 0 : 0;
      const bVol = !isPrediction(b) ? (b as LiveMarket).volume ?? 0 : 0;
      return bVol - aVol;
    }
    return 0;
  });
}

export function useMarkets(autoRefreshSec = 0) {
  const [filters, setFilters] = useState<MarketFilters>(DEFAULT_FILTERS);
  const [data, setData] = useState<CompoundMarketsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = useCallback(async (f: MarketFilters) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getCompoundMarkets({
        source: f.source,
        category: f.category === 'all' ? undefined : f.category,
        limit: 50,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load markets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch(filters);
  }, [filters, fetch]);

  useEffect(() => {
    if (!autoRefreshSec) return;
    intervalRef.current = setInterval(() => fetch(filters), autoRefreshSec * 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefreshSec, filters, fetch]);

  const markets = data
    ? sortMarkets(data.markets, filters.sort)
    : [];

  return {
    markets,
    loading,
    error,
    filters,
    setFilters,
    refresh: () => fetch(filters),
    timestamp: data?.timestamp ?? null,
    source: data?.source ?? null,
  };
}
