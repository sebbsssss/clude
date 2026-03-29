import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  Brain,
  ListChecks,
  Sparkles,
  Tag,
  Clock,
  BarChart2,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useMarketDetail } from '../hooks/useMarketDetail';
import type { MarketDetailResponse } from '../lib/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string }) {
  const styles =
    source === 'polymarket'
      ? 'bg-purple-500/15 text-purple-400 border-purple-500/25'
      : 'bg-blue-500/15 text-blue-400 border-blue-500/25';
  return (
    <span className={`text-[9px] uppercase tracking-wider border px-1.5 py-0.5 rounded ${styles}`}>
      {source === 'polymarket' ? 'Polymarket' : 'Manifold'}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="text-[9px] uppercase tracking-wider text-zinc-500 bg-zinc-800/50 px-1.5 py-0.5 rounded border border-zinc-800">
      {category}
    </span>
  );
}

function EdgeBadge({ edge, isValue }: { edge: number; isValue: boolean }) {
  if (edge >= 0.10 && isValue) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 px-2 py-0.5 rounded-full">
        <TrendingUp className="h-3 w-3" />
        +{Math.round(edge * 100)}pp value edge
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
    <span className="flex items-center gap-1 text-[10px] text-zinc-500 bg-zinc-800/50 px-2 py-0.5 rounded-full border border-zinc-800">
      <TrendingDown className="h-3 w-3" />
      {Math.round(edge * 100)}pp
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-1">
      <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</span>
      <span className={`text-xl font-semibold ${accent ? 'text-emerald-400' : 'text-zinc-100'}`}>
        {value}
      </span>
      {sub && <span className="text-[10px] text-zinc-600">{sub}</span>}
    </div>
  );
}

function ProbabilityBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: 'zinc' | 'emerald';
}) {
  const pctVal = Math.round(value * 100);
  const barColor = color === 'emerald' ? 'bg-emerald-500' : 'bg-zinc-500';
  const textColor = color === 'emerald' ? 'text-emerald-400' : 'text-zinc-300';

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-[11px] text-zinc-500">{label}</span>
        <span className={`text-[14px] font-semibold ${textColor}`}>{pctVal}%</span>
      </div>
      <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${barColor}`}
          initial={{ width: 0 }}
          animate={{ width: `${pctVal}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pctVal = Math.round(value * 100);
  const color =
    pctVal >= 75 ? 'bg-emerald-500' : pctVal >= 50 ? 'bg-amber-500' : 'bg-zinc-500';
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-[11px] text-zinc-500">Confidence</span>
        <span className="text-[14px] font-semibold text-zinc-300">{pctVal}%</span>
      </div>
      <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${pctVal}%` }}
          transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
        />
      </div>
    </div>
  );
}

function ResolutionBanner({ resolution }: { resolution: NonNullable<MarketDetailResponse['resolution']> }) {
  const correct = resolution.correct;
  return (
    <div
      className={`rounded-xl border p-4 flex items-start gap-3 ${
        correct
          ? 'bg-emerald-500/10 border-emerald-500/25'
          : 'bg-red-500/10 border-red-500/25'
      }`}
    >
      {correct ? (
        <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
      ) : (
        <XCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className={`text-[13px] font-semibold ${correct ? 'text-emerald-400' : 'text-red-400'}`}>
            {correct ? 'Prediction Correct' : 'Prediction Incorrect'}
          </span>
          <span className="text-[10px] text-zinc-500">
            Resolved {formatDate(resolution.resolvedAt)}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-4 flex-wrap">
          {resolution.outcome && (
            <span className="text-[11px] text-zinc-400">
              Outcome: <span className="text-zinc-200 font-medium">{resolution.outcome}</span>
            </span>
          )}
          <span className="text-[11px] text-zinc-400">
            Brier:{' '}
            <span className={`font-medium ${resolution.brierScore < 0.25 ? 'text-emerald-400' : 'text-red-400'}`}>
              {resolution.brierScore.toFixed(3)}
            </span>
            <span className="text-zinc-600"> (baseline 0.250)</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/50">
      <span className="text-zinc-500">{icon}</span>
      <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">{label}</span>
    </div>
  );
}

// ── Memory Insight Panel ───────────────────────────────────────────────────────

function MemoryInsightPanel({ market }: { market: MarketDetailResponse }) {
  const importancePct = Math.round(market.importance * 100);
  const decayPct = Math.round(market.decayFactor * 100);

  return (
    <section className="space-y-4" aria-label="Memory insight">
      <SectionHeader icon={<Brain className="h-4 w-4" />} label="Memory Insight" />

      <p className="text-[11px] text-zinc-500 leading-relaxed">
        This prediction is stored as a memory in Clude&apos;s persistent knowledge graph.
        The memory&apos;s importance and decay factor reflect how much weight the AI places on this
        evidence when making future predictions.
      </p>

      {/* Importance + Decay */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-1">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Importance</span>
          <div className="flex items-end gap-1">
            <span className="text-lg font-semibold text-zinc-100">{importancePct}%</span>
          </div>
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-emerald-500/70 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${importancePct}%` }}
              transition={{ duration: 0.6, ease: 'easeOut', delay: 0.2 }}
            />
          </div>
          <span className="text-[9px] text-zinc-600">How valuable this memory is to future reasoning</span>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-1">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Memory Strength</span>
          <div className="flex items-end gap-1">
            <span className="text-lg font-semibold text-zinc-100">{decayPct}%</span>
          </div>
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${decayPct > 70 ? 'bg-blue-500/70' : decayPct > 40 ? 'bg-amber-500/70' : 'bg-red-500/70'}`}
              initial={{ width: 0 }}
              animate={{ width: `${decayPct}%` }}
              transition={{ duration: 0.6, ease: 'easeOut', delay: 0.25 }}
            />
          </div>
          <span className="text-[9px] text-zinc-600">How much this memory has faded over time</span>
        </div>
      </div>

      {/* Tags */}
      {market.tags && market.tags.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <Tag className="h-3 w-3" />
            <span>Knowledge graph tags</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {market.tags.map((tag) => (
              <span
                key={tag}
                className={`text-[9px] px-2 py-0.5 rounded-full border ${
                  tag === 'compound'
                    ? 'bg-emerald-500/10 text-emerald-500/80 border-emerald-500/20'
                    : tag === 'prediction'
                    ? 'bg-blue-500/10 text-blue-400/80 border-blue-500/20'
                    : 'bg-zinc-800/50 text-zinc-500 border-zinc-800'
                }`}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
          <Clock className="h-3 w-3" />
          <span>Prediction lifecycle</span>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-500">Analyzed</span>
            <span className="text-zinc-400">{formatDateTime(market.analyzedAt)}</span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-500">Market closes</span>
            <span className="text-zinc-400">{formatDate(market.closeDate)}</span>
          </div>
          {market.resolution && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-zinc-500">Resolved</span>
              <span className={market.resolution.correct ? 'text-emerald-400' : 'text-red-400'}>
                {formatDate(market.resolution.resolvedAt)}
              </span>
            </div>
          )}
          {!market.resolution && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-zinc-500">Status</span>
              <span className="text-amber-400/80">Awaiting resolution</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function MarketDetail() {
  const { id } = useParams<{ id: string }>();
  const memoryId = id ? parseInt(id, 10) : null;
  const { data, loading, error, reload } = useMarketDetail(memoryId && !isNaN(memoryId) ? memoryId : null);

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/compound"
            className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"
            aria-label="Back to markets"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="text-[11px]">Markets</span>
          </Link>
          <span className="text-zinc-700">·</span>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            <span className="text-[13px] font-semibold text-zinc-100">Compound</span>
            <span className="text-[10px] text-zinc-600">Market Detail</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8">
        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 text-zinc-600 animate-spin" />
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <AlertCircle className="h-8 w-8 text-red-500/50" />
            <p className="text-[12px] text-zinc-500">{error}</p>
            <button
              onClick={() => reload()}
              className="text-[11px] text-zinc-400 hover:text-zinc-200 border border-zinc-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {/* Market detail */}
        {!loading && !error && data && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-8"
          >
            {/* Title section */}
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <h1 className="text-[16px] font-semibold text-zinc-100 leading-snug flex-1">
                  {data.question}
                </h1>
                {data.marketUrl && (
                  <a
                    href={data.marketUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 px-2.5 py-1.5 rounded-lg transition-colors"
                    aria-label="Open market on source platform"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View Market
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <SourceBadge source={data.source} />
                <CategoryBadge category={data.category} />
                <EdgeBadge edge={data.edge} isValue={data.isValue} />
              </div>
            </div>

            {/* Resolution banner */}
            {data.resolution && <ResolutionBanner resolution={data.resolution} />}

            {/* Stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                label="Market Odds"
                value={pct(data.marketOdds)}
                sub="What the crowd thinks"
              />
              <StatCard
                label="Compound Estimate"
                value={pct(data.estimatedProbability)}
                sub="Memory-augmented probability"
                accent
              />
              <StatCard
                label="Edge"
                value={`${data.edge >= 0 ? '+' : ''}${Math.round(data.edge * 100)}pp`}
                sub={data.isValue ? 'Value detected' : 'Below threshold'}
                accent={data.edge >= 0.10}
              />
              <StatCard
                label="Confidence"
                value={pct(data.confidence)}
                sub="Reasoning certainty"
                accent={data.confidence >= 0.75}
              />
            </div>

            {/* Probability visualization */}
            <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4" aria-label="Probability comparison">
              <SectionHeader icon={<BarChart2 className="h-4 w-4" />} label="Probability Comparison" />
              <ProbabilityBar label="Market Odds" value={data.marketOdds} color="zinc" />
              <ProbabilityBar label="Compound Estimate" value={data.estimatedProbability} color="emerald" />
              <ConfidenceBar value={data.confidence} />
              {data.edge !== 0 && (
                <div className="pt-2 border-t border-zinc-800/50 flex items-center justify-between text-[10px] text-zinc-500">
                  <span>Difference (edge)</span>
                  <span className={data.edge > 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {data.edge > 0 ? '+' : ''}{Math.round(data.edge * 100)} percentage points
                  </span>
                </div>
              )}
            </section>

            {/* Reasoning */}
            {data.reasoning && (
              <section className="space-y-3" aria-label="Reasoning">
                <SectionHeader icon={<Sparkles className="h-4 w-4" />} label="Compound Reasoning" />
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <p className="text-[12px] text-zinc-300 leading-relaxed">{data.reasoning}</p>
                </div>
              </section>
            )}

            {/* Evidence */}
            {data.evidence && data.evidence.length > 0 && (
              <section className="space-y-3" aria-label="Evidence">
                <SectionHeader icon={<ListChecks className="h-4 w-4" />} label={`Evidence (${data.evidence.length})`} />
                <ul className="space-y-2" role="list">
                  {data.evidence.map((item, i) => (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.15, delay: i * 0.04 }}
                      className="flex items-start gap-2.5 bg-zinc-900 border border-zinc-800 rounded-lg px-3.5 py-2.5"
                    >
                      <span className="text-emerald-500/60 mt-0.5 text-[10px] font-semibold shrink-0">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-[11px] text-zinc-400 leading-relaxed">{item}</span>
                    </motion.li>
                  ))}
                </ul>
              </section>
            )}

            {/* Memory insight */}
            <MemoryInsightPanel market={data} />
          </motion.div>
        )}
      </main>
    </div>
  );
}
