import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw,
  MessageSquare,
  TrendingUp,
  AlertCircle,
  Loader2,
  Target,
  BarChart2,
  Activity,
  Award,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api';
import type { CompoundAccuracy, CompoundTimeline, TimelinePeriod } from '../lib/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function formatPeriodLabel(period: string): string {
  const parts = period.split('-');
  // YYYY-MM → YY/MM, YYYY-MM-DD → MM/DD
  if (parts.length === 2) return `${parts[0].slice(2)}/${parts[1]}`;
  return `${parts[1]}/${parts[2]}`;
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

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
      <span className={`text-2xl font-semibold ${accent ? 'text-emerald-400' : 'text-zinc-100'}`}>
        {value}
      </span>
      {sub && <span className="text-[10px] text-zinc-600">{sub}</span>}
    </div>
  );
}

function BrierCard({ score }: { score: number }) {
  const baseline = 0.25;
  const improvement = baseline - score;
  const pctBetter = improvement > 0 ? Math.round((improvement / baseline) * 100) : 0;
  const good = score < baseline;
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-1">
      <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Avg Brier Score</span>
      <span className={`text-2xl font-semibold ${good ? 'text-emerald-400' : 'text-amber-400'}`}>
        {score.toFixed(3)}
      </span>
      <span className="text-[10px] text-zinc-600">
        {good
          ? `${pctBetter}% better than random (0.25 baseline)`
          : 'Above 0.25 baseline — more data needed'}
      </span>
    </div>
  );
}

// ── SVG Trend Chart ───────────────────────────────────────────────────────────

const W = 600;
const H = 180;
const PAD = { top: 16, right: 28, bottom: 32, left: 36 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

function xPos(i: number, total: number): number {
  if (total <= 1) return PAD.left + INNER_W / 2;
  return PAD.left + (i / (total - 1)) * INNER_W;
}

function yPos(v: number): number {
  return PAD.top + (1 - Math.max(0, Math.min(1, v))) * INNER_H;
}

function TrendChart({ data }: { data: TimelinePeriod[] }) {
  const valid = data.filter((d) => d.cumulativeAccuracy !== null);

  if (valid.length < 2) {
    return (
      <div className="flex items-center justify-center h-44 text-[11px] text-zinc-600">
        Not enough resolved predictions to show trend
      </div>
    );
  }

  const n = valid.length;
  const gridLevels = [0.25, 0.5, 0.75, 1.0];
  const labelStep = Math.max(1, Math.floor(n / 5));

  const linePath = valid
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i, n).toFixed(1)} ${yPos(d.cumulativeAccuracy!).toFixed(1)}`)
    .join(' ');

  const firstX = xPos(0, n).toFixed(1);
  const lastX = xPos(n - 1, n).toFixed(1);
  const bottomY = yPos(0).toFixed(1);
  const areaPath = `${linePath} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Cumulative accuracy trend over time"
    >
      {/* Grid lines */}
      {gridLevels.map((v) => (
        <line
          key={v}
          x1={PAD.left}
          x2={W - PAD.right}
          y1={yPos(v)}
          y2={yPos(v)}
          stroke="#27272a"
          strokeWidth="1"
        />
      ))}

      {/* Y-axis labels */}
      {gridLevels.map((v) => (
        <text key={v} x={PAD.left - 4} y={yPos(v) + 3} fill="#52525b" fontSize="9" textAnchor="end">
          {Math.round(v * 100)}%
        </text>
      ))}

      {/* 50% reference line */}
      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={yPos(0.5)}
        y2={yPos(0.5)}
        stroke="#52525b"
        strokeWidth="1"
        strokeDasharray="4 2"
      />

      {/* Area fill */}
      <path d={areaPath} fill="#10b98110" />

      {/* Accuracy line */}
      <path
        d={linePath}
        fill="none"
        stroke="#34d399"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Data points */}
      {valid.map((d, i) => (
        <circle
          key={i}
          cx={xPos(i, n)}
          cy={yPos(d.cumulativeAccuracy!)}
          r={3}
          fill="#34d399"
        />
      ))}

      {/* X-axis labels */}
      {valid.map((d, i) => {
        if (i !== 0 && i !== n - 1 && i % labelStep !== 0) return null;
        return (
          <text
            key={i}
            x={xPos(i, n)}
            y={H - PAD.bottom + 14}
            fill="#52525b"
            fontSize="8"
            textAnchor="middle"
          >
            {formatPeriodLabel(d.period)}
          </text>
        );
      })}
    </svg>
  );
}

// ── Category Breakdown ────────────────────────────────────────────────────────

const CATEGORY_BAR: Record<string, string> = {
  politics: 'bg-blue-500',
  crypto: 'bg-amber-500',
  sports: 'bg-emerald-500',
  tech: 'bg-purple-500',
  science: 'bg-cyan-500',
  entertainment: 'bg-pink-500',
  other: 'bg-zinc-500',
};

function CategoryRow({
  category,
  count,
  correct,
  avgBrier,
}: {
  category: string;
  count: number;
  correct: number;
  avgBrier: number;
}) {
  const accuracy = count > 0 ? correct / count : 0;
  const barColor = CATEGORY_BAR[category] ?? 'bg-zinc-500';
  const accuracyPct = Math.round(accuracy * 100);
  const textColor =
    accuracyPct >= 60 ? 'text-emerald-400' : accuracyPct >= 50 ? 'text-amber-400' : 'text-zinc-400';

  return (
    <div className="flex flex-col gap-1.5 py-3 border-b border-zinc-800/50 last:border-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full shrink-0 ${barColor}`} />
          <span className="text-[12px] text-zinc-200 capitalize">{category}</span>
        </div>
        <div className="flex items-center gap-4 text-[11px]">
          <span className="text-zinc-500">{count} resolved</span>
          <span className={`font-semibold w-8 text-right ${textColor}`}>{accuracyPct}%</span>
          <span className="text-zinc-600 w-20 text-right">Brier {avgBrier.toFixed(3)}</span>
        </div>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} opacity-75 transition-all duration-700`}
          style={{ width: `${accuracyPct}%` }}
        />
      </div>
    </div>
  );
}

// ── Comparison Panel ──────────────────────────────────────────────────────────

function ComparisonPanel({
  accuracy,
  brierScore,
}: {
  accuracy: number;
  brierScore: number;
}) {
  const accDelta = accuracy - 0.5;
  const brierDelta = 0.25 - brierScore; // positive = better
  const accSign = accDelta >= 0 ? '+' : '';
  const brierBetter = brierDelta >= 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {/* Directional accuracy */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Directional Accuracy</div>
        <div className="space-y-2">
          <div>
            <div className="flex justify-between text-[9px] text-zinc-500 mb-1">
              <span>Compound</span>
              <span className="text-emerald-400 font-semibold">{pct(accuracy)}</span>
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-700"
                style={{ width: `${accuracy * 100}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-[9px] text-zinc-500 mb-1">
              <span>Baseline (coin flip)</span>
              <span className="text-zinc-500">50%</span>
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-zinc-600 rounded-full" style={{ width: '50%' }} />
            </div>
          </div>
        </div>
        <div
          className={`text-[10px] font-semibold ${accDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
        >
          {accSign}{Math.round(accDelta * 100)}pp vs random baseline
        </div>
      </div>

      {/* Brier score */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <div className="text-[10px] text-zinc-500 uppercase tracking-wider">
          Calibration — Brier Score{' '}
          <span className="normal-case text-zinc-700">(lower is better)</span>
        </div>
        <div className="flex items-end gap-6">
          <div>
            <div className="text-[9px] text-zinc-600 mb-0.5">Compound</div>
            <div className={`text-2xl font-semibold ${brierBetter ? 'text-emerald-400' : 'text-amber-400'}`}>
              {brierScore.toFixed(3)}
            </div>
          </div>
          <div>
            <div className="text-[9px] text-zinc-600 mb-0.5">Baseline</div>
            <div className="text-2xl font-semibold text-zinc-500">0.250</div>
          </div>
        </div>
        <div
          className={`text-[10px] font-semibold ${brierBetter ? 'text-emerald-400' : 'text-red-400'}`}
        >
          {brierBetter
            ? `${Math.round((brierDelta / 0.25) * 100)}% better calibrated than random`
            : `${Math.round((-brierDelta / 0.25) * 100)}% below baseline — more data needed`}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

type IntervalMode = 'day' | 'week' | 'month';

export function CompoundAccuracyScorecard() {
  const [accuracy, setAccuracy] = useState<CompoundAccuracy | null>(null);
  const [timeline, setTimeline] = useState<CompoundTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intervalMode, setIntervalMode] = useState<IntervalMode>('week');

  const load = useCallback(async (inv: IntervalMode) => {
    setLoading(true);
    setError(null);
    try {
      const [acc, tl] = await Promise.all([
        api.getCompoundAccuracy(),
        api.getCompoundTimeline({ interval: inv }),
      ]);
      setAccuracy(acc);
      setTimeline(tl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load accuracy data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(intervalMode);
  }, [intervalMode, load]);

  const hasData = accuracy !== null && accuracy.totalResolved > 0;
  const categories = accuracy?.byCategory
    ? Object.entries(accuracy.byCategory)
        .filter(([, v]) => v.count > 0)
        .sort(([, a], [, b]) => b.count - a.count)
    : [];

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
            aria-label="Back to chat"
          >
            <MessageSquare className="h-4 w-4" />
          </Link>
          <Link
            to="/compound"
            className="text-zinc-500 hover:text-zinc-300 transition-colors text-[11px]"
          >
            <span className="flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5" />
              Compound
            </span>
          </Link>
          <span className="text-zinc-700 text-[11px]">/</span>
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-emerald-400" />
            <span className="text-[13px] font-semibold text-zinc-100">Accuracy Scorecard</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Interval toggle */}
          <div className="flex items-center gap-0.5 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
            {(['day', 'week', 'month'] as const).map((inv) => (
              <button
                key={inv}
                onClick={() => setIntervalMode(inv)}
                className={`text-[10px] px-2 py-1 rounded transition-colors capitalize ${
                  intervalMode === inv
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {inv}
              </button>
            ))}
          </div>

          <button
            onClick={() => load(intervalMode)}
            disabled={loading}
            className="flex items-center gap-1.5 text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-40"
            aria-label="Refresh accuracy data"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 px-4 py-6 max-w-5xl mx-auto w-full">
        {/* Error */}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <AlertCircle className="h-8 w-8 text-red-500/50" />
            <p className="text-[12px] text-zinc-500">{error}</p>
            <button
              onClick={() => load(intervalMode)}
              className="text-[11px] text-zinc-400 hover:text-zinc-200 border border-zinc-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 text-zinc-600 animate-spin" />
          </div>
        )}

        {/* No resolved data yet */}
        {!loading && !error && accuracy && !hasData && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <BarChart2 className="h-8 w-8 text-zinc-700" />
            <p className="text-[12px] text-zinc-500">No resolved predictions yet</p>
            <p className="text-[10px] text-zinc-700 max-w-xs text-center">
              Accuracy data appears once Compound's predictions have been resolved against real
              market outcomes.
            </p>
            {accuracy.totalPredictions > 0 && (
              <p className="text-[10px] text-emerald-600">
                {accuracy.totalPredictions} prediction
                {accuracy.totalPredictions !== 1 ? 's' : ''} tracked — awaiting resolution
              </p>
            )}
          </div>
        )}

        {/* Scorecard */}
        {!loading && !error && hasData && (
          <AnimatePresence mode="wait">
            <motion.div
              key="scorecard"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              {/* Stat cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard
                  label="Total Predictions"
                  value={accuracy.totalPredictions.toLocaleString()}
                  sub="markets analyzed"
                />
                <StatCard
                  label="Resolved"
                  value={accuracy.totalResolved.toLocaleString()}
                  sub={`of ${accuracy.totalPredictions} tracked`}
                />
                <StatCard
                  label="Directional Accuracy"
                  value={pct(accuracy.accuracy)}
                  sub={`${accuracy.correctCount} correct calls`}
                  accent
                />
                <BrierCard score={accuracy.avgBrierScore} />
              </div>

              {/* Comparison */}
              <section>
                <h2 className="text-[11px] text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Award className="h-3.5 w-3.5" />
                  Compound vs Baseline
                </h2>
                <ComparisonPanel accuracy={accuracy.accuracy} brierScore={accuracy.avgBrierScore} />
              </section>

              {/* Trend chart */}
              <section>
                <h2 className="text-[11px] text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Activity className="h-3.5 w-3.5" />
                  Accuracy Trend
                  <span className="normal-case text-zinc-700 font-normal">
                    cumulative {intervalMode === 'day' ? 'daily' : intervalMode === 'week' ? 'weekly' : 'monthly'}
                  </span>
                </h2>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <TrendChart data={timeline?.timeline ?? []} />
                  <div className="flex items-center gap-4 mt-2 pl-8">
                    <div className="flex items-center gap-1.5 text-[9px] text-zinc-500">
                      <div className="h-2 w-4 rounded-sm bg-emerald-500/60" />
                      Compound accuracy
                    </div>
                    <div className="flex items-center gap-1.5 text-[9px] text-zinc-500">
                      <div className="h-0 w-4 border-t border-dashed border-zinc-500" />
                      50% baseline
                    </div>
                  </div>
                </div>
              </section>

              {/* Category breakdown */}
              {categories.length > 0 && (
                <section>
                  <h2 className="text-[11px] text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <BarChart2 className="h-3.5 w-3.5" />
                    Accuracy by Category
                  </h2>
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-1">
                    {categories.map(([cat, stats]) => (
                      <CategoryRow
                        key={cat}
                        category={cat}
                        count={stats.count}
                        correct={stats.correct}
                        avgBrier={stats.avgBrier}
                      />
                    ))}
                  </div>
                </section>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </main>
    </div>
  );
}
