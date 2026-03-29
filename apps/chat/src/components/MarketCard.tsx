import { Link } from 'react-router-dom';
import { ExternalLink, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { CompoundMarket, CompoundPrediction } from '../lib/types';
import { isPrediction } from '../lib/types';

function formatOdds(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

function formatDate(d: string): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function EdgeBadge({ edge, isValue }: { edge: number; isValue: boolean }) {
  if (edge >= 0.10 && isValue) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 px-2 py-0.5 rounded-full">
        <TrendingUp className="h-3 w-3" />
        +{Math.round(edge * 100)}pp value
      </span>
    );
  }
  if (edge >= 0.05) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/25 px-2 py-0.5 rounded-full">
        <Minus className="h-3 w-3" />
        +{Math.round(edge * 100)}pp edge
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] text-zinc-500 bg-zinc-800/50 px-2 py-0.5 rounded-full">
      <TrendingDown className="h-3 w-3" />
      {Math.round(edge * 100)}pp
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  const styles =
    source === 'polymarket'
      ? 'bg-purple-500/15 text-purple-400 border-purple-500/25'
      : 'bg-blue-500/15 text-blue-400 border-blue-500/25';
  return (
    <span className={`text-[9px] uppercase tracking-wider border px-1.5 py-0.5 rounded ${styles}`}>
      {source === 'polymarket' ? 'Poly' : 'Manifold'}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="text-[9px] uppercase tracking-wider text-zinc-500 bg-zinc-800/50 px-1.5 py-0.5 rounded">
      {category}
    </span>
  );
}

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-zinc-500';
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[9px] text-zinc-500">
        <span>Confidence</span>
        <span className="text-zinc-400">{pct}%</span>
      </div>
      <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ProbabilityBars({ marketOdds, estimate }: { marketOdds: number; estimate: number }) {
  return (
    <div className="space-y-1.5">
      <div className="space-y-0.5">
        <div className="flex justify-between text-[9px]">
          <span className="text-zinc-500">Market</span>
          <span className="text-zinc-400 font-medium">{formatOdds(marketOdds)}</span>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-zinc-500 rounded-full transition-all duration-500"
            style={{ width: `${marketOdds * 100}%` }}
          />
        </div>
      </div>
      <div className="space-y-0.5">
        <div className="flex justify-between text-[9px]">
          <span className="text-zinc-500">Compound</span>
          <span className="text-emerald-400 font-medium">{formatOdds(estimate)}</span>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${estimate * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

interface Props {
  market: CompoundMarket;
}

export function MarketCard({ market }: Props) {
  const pred = isPrediction(market) ? (market as CompoundPrediction) : null;
  const url = pred ? pred.marketUrl : (market as any).url;
  const volume = pred ? null : (market as any).volume;
  const odds = pred ? pred.marketOdds : (market as any).currentOdds;

  const card = (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3 transition-colors ${pred ? 'hover:border-zinc-600 cursor-pointer' : 'hover:border-zinc-700'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-zinc-100 font-medium leading-snug line-clamp-3">
            {market.question}
          </p>
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-zinc-600 hover:text-zinc-400 transition-colors mt-0.5"
            aria-label="Open market"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {/* Badges */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <SourceBadge source={market.source} />
        <CategoryBadge category={market.category} />
        {pred && <EdgeBadge edge={pred.edge} isValue={pred.isValue} />}
      </div>

      {/* Probability comparison (prediction only) */}
      {pred ? (
        <>
          <ProbabilityBars marketOdds={pred.marketOdds} estimate={pred.estimatedProbability} />
          <ConfidenceMeter value={pred.confidence} />
        </>
      ) : (
        /* Live market: just show odds + volume */
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-500">Market odds</span>
          <span className="text-zinc-200 font-semibold">{formatOdds(odds ?? 0)}</span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-[9px] text-zinc-600 pt-1 border-t border-zinc-800/50">
        <span>Closes {formatDate(market.closeDate)}</span>
        {volume != null && <span>{formatVolume(volume)} vol</span>}
        {pred && <span>Analyzed {formatDate(pred.analyzedAt)}</span>}
      </div>
    </div>
  );

  if (pred) {
    return (
      <Link to={`/compound/markets/${pred.memoryId}`} className="block">
        {card}
      </Link>
    );
  }
  return card;
}
