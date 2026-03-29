import { Link } from 'react-router-dom';
import { RefreshCw, MessageSquare, TrendingUp, AlertCircle, Loader2, Target } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMarkets } from '../hooks/useMarkets';
import { MarketCard } from './MarketCard';
import type { MarketCategory, MarketSortKey } from '../lib/types';

const CATEGORIES: { value: MarketCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'politics', label: 'Politics' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'sports', label: 'Sports' },
  { value: 'tech', label: 'Tech' },
  { value: 'science', label: 'Science' },
  { value: 'entertainment', label: 'Entertainment' },
];

const SORT_OPTIONS: { value: MarketSortKey; label: string }[] = [
  { value: 'edge', label: 'Edge Size' },
  { value: 'confidence', label: 'Confidence' },
  { value: 'closeDate', label: 'Closing Soon' },
  { value: 'volume', label: 'Volume' },
];

export function CompoundDashboard() {
  const { markets, loading, error, filters, setFilters, refresh, timestamp } = useMarkets();

  const lastUpdated = timestamp
    ? new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Top nav */}
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
            aria-label="Back to chat"
          >
            <MessageSquare className="h-4 w-4" />
          </Link>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            <span className="text-[13px] font-semibold text-zinc-100">Compound</span>
            <span className="text-[10px] text-zinc-600">Prediction Markets</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/compound/accuracy"
            className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-emerald-400 transition-colors"
            title="Accuracy Scorecard"
          >
            <Target className="h-3.5 w-3.5" />
            Accuracy
          </Link>
          {lastUpdated && (
            <span className="text-[10px] text-zinc-600">Updated {lastUpdated}</span>
          )}
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1.5 text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-40"
            aria-label="Refresh markets"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          {/* Source toggle */}
          <div className="flex items-center gap-0.5 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
            {(['memory', 'live'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilters((f) => ({ ...f, source: s }))}
                className={`text-[10px] px-2 py-1 rounded transition-colors ${
                  filters.source === s
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {s === 'memory' ? 'Analysis' : 'Live'}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="border-b border-zinc-800/50 px-4 py-2.5 flex items-center justify-between gap-4 flex-wrap">
        {/* Category pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {CATEGORIES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFilters((f) => ({ ...f, category: value }))}
              className={`text-[10px] px-3 py-1 rounded-full transition-colors ${
                filters.category === value
                  ? 'bg-zinc-700 text-zinc-100 border border-zinc-600'
                  : 'text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-600">Sort:</span>
          <select
            value={filters.sort}
            onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as MarketSortKey }))}
            className="text-[10px] bg-zinc-900 border border-zinc-800 text-zinc-400 rounded px-2 py-1 outline-none focus:border-zinc-600"
          >
            {SORT_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 px-4 py-6">
        {/* Error state */}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <AlertCircle className="h-8 w-8 text-red-500/50" />
            <p className="text-[12px] text-zinc-500">{error}</p>
            <button
              onClick={refresh}
              className="text-[11px] text-zinc-400 hover:text-zinc-200 border border-zinc-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 text-zinc-600 animate-spin" />
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && markets.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <TrendingUp className="h-8 w-8 text-zinc-700" />
            <p className="text-[12px] text-zinc-500">No markets found</p>
            <p className="text-[10px] text-zinc-700 max-w-xs text-center">
              {filters.source === 'memory'
                ? 'Compound has not analyzed any markets yet. Check back after the next scan.'
                : 'No live markets match the current filters.'}
            </p>
          </div>
        )}

        {/* Market grid */}
        {!loading && !error && markets.length > 0 && (
          <>
            <div className="mb-4 flex items-center gap-2">
              <span className="text-[10px] text-zinc-600">
                {markets.length} market{markets.length !== 1 ? 's' : ''}
                {filters.category !== 'all' ? ` · ${filters.category}` : ''}
              </span>
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={`${filters.category}-${filters.sort}-${filters.source}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
              >
                {markets.map((market, i) => (
                  <motion.div
                    key={'memoryId' in market ? market.memoryId : market.sourceId}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15, delay: i * 0.03 }}
                  >
                    <MarketCard market={market} />
                  </motion.div>
                ))}
              </motion.div>
            </AnimatePresence>
          </>
        )}
      </main>
    </div>
  );
}
