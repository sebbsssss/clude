import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { NeuralCanvas } from '../components/NeuralCanvas';
import { ActivityFeed } from '../components/ActivityFeed';
import { useAgentContext } from '../context/AgentContext';
import { useAuthContext } from '../hooks/AuthContext';
import type { Memory, MemoryStats } from '../types/memory';

// ── Helpers ──────────────────────────────────────

function useCounter(target: number, ms = 1400) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!target) { setV(0); return; }
    const t0 = performance.now();
    let f: number;
    const step = (now: number) => {
      const p = Math.min((now - t0) / ms, 1);
      const eased = 1 - Math.pow(1 - p, 4);
      setV(Math.floor(eased * target));
      if (p < 1) f = requestAnimationFrame(step);
    };
    f = requestAnimationFrame(step);
    return () => cancelAnimationFrame(f);
  }, [target, ms]);
  return v;
}

function filterByAgent(memories: Memory[], agentId: string | null, agentName: string | null): Memory[] {
  if (!agentId) return memories;
  return memories.filter((m) =>
    m.related_user === agentId ||
    (agentName && m.source?.includes(agentName)) ||
    (agentName && (m.metadata as any)?.agentName === agentName),
  );
}

function formatNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

const TYPE_META: Record<string, { color: string; label: string; short: string }> = {
  episodic:   { color: '#2244ff', label: 'Episodic',   short: 'EPI'  },
  semantic:   { color: '#10b981', label: 'Semantic',   short: 'SEM'  },
  procedural: { color: '#f59e0b', label: 'Procedural', short: 'PRO'  },
  self_model: { color: '#8b5cf6', label: 'Self-Model', short: 'SELF' },
};

const SECTION_HEADER: React.CSSProperties = {
  fontSize: 8, letterSpacing: 3, textTransform: 'uppercase',
  color: 'var(--text-faint)', fontWeight: 700,
};

// ── Sparkline (upgraded) ─────────────────────────

function Sparkline({ data, color = '#2244ff', height = 48 }: {
  data: number[]; color?: string; height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(200);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.floor(w));
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  if (data.length < 2) return <div ref={containerRef} style={{ width: '100%', height }} />;

  const max = Math.max(...data, 1);
  const pad = 2;
  const step = (width - pad * 2) / (data.length - 1);
  const points = data.map((v, i) =>
    `${pad + i * step},${height - pad - (v / max) * (height - pad * 2 - 4)}`
  ).join(' ');
  const areaPoints = `${pad},${height} ${points} ${width - pad},${height}`;
  const lastX = pad + (data.length - 1) * step;
  const lastY = height - pad - (data[data.length - 1] / max) * (height - pad * 2 - 4);

  const gradId = `sparkGrad_${color.replace('#', '')}`;

  return (
    <div ref={containerRef} style={{ width: '100%', height, position: 'relative' }}>
      <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.12} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <polygon points={areaPoints} fill={`url(#${gradId})`} />
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity={0.7}
        />
        {/* Bars underneath */}
        {data.map((v, i) => {
          const barH = (v / max) * (height - pad * 2 - 4);
          const x = pad + i * step;
          return (
            <rect
              key={i}
              x={x - 1.5}
              y={height - barH}
              width={3}
              height={barH}
              fill={color}
              opacity={0.06}
              rx={1}
            />
          );
        })}
        {/* End pulse */}
        <circle cx={lastX} cy={lastY} r={3} fill={color} opacity={0.8}>
          <animate attributeName="r" values="3;5;3" dur="2.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.8;0.3;0.8" dur="2.5s" repeatCount="indefinite" />
        </circle>
        <circle cx={lastX} cy={lastY} r={1.5} fill={color} />
      </svg>
    </div>
  );
}

// ── Ring Chart ────────────────────────────────────

function TypeRing({ data, size = 52 }: {
  data: { type: string; value: number }[];
  size?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - 6) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const strokeW = 5;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const segments = data.map((d) => {
    const pct = d.value / total;
    const seg = { ...d, pct, dashOffset: offset, dashLength: pct * circumference };
    offset += pct * circumference;
    return seg;
  });

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={strokeW} />
      {segments.map((seg) => (
        <circle
          key={seg.type}
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={TYPE_META[seg.type]?.color || '#999'}
          strokeWidth={strokeW}
          strokeDasharray={`${seg.dashLength} ${circumference - seg.dashLength}`}
          strokeDashoffset={-seg.dashOffset}
          strokeLinecap="butt"
          style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.16, 1, 0.3, 1)' }}
        />
      ))}
    </svg>
  );
}

// ── Memory Timeline ──────────────────────────────

function useMemoryTimeline(memories: Memory[]): number[] {
  return useMemo(() => {
    const buckets = new Array(24).fill(0);
    const now = Date.now();
    for (const m of memories) {
      const age = (now - new Date(m.created_at).getTime()) / 3600000;
      const bucket = Math.min(23, Math.floor(age));
      buckets[23 - bucket]++;
    }
    return buckets;
  }, [memories]);
}

// ── Card Wrapper ─────────────────────────────────

function Card({ area, delay = 0, children, style, className }: {
  area: string;
  delay?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={`fade-in ${className || ''}`}
      style={{
        gridArea: area,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 3,
        animationDelay: `${delay}s`,
        position: 'relative',
        overflow: 'hidden',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function CardHeader({ children, right, noBorder }: {
  children: React.ReactNode;
  right?: React.ReactNode;
  noBorder?: boolean;
}) {
  return (
    <div style={{
      padding: '11px 16px',
      borderBottom: noBorder ? 'none' : '1px solid var(--border)',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span style={SECTION_HEADER}>{children}</span>
      {right && <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>{right}</div>}
    </div>
  );
}

// ── Main Dashboard ───────────────────────────────

export function Dashboard() {
  const { authMode, walletAddress, ready } = useAuthContext();
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [inferenceStats, setInferenceStats] = useState<any>(null);
  const [recentMemories, setRecentMemories] = useState<Memory[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const uptime = useMemo(() => {
    if (!stats?.newestMemory) return '—';
    const ms = Date.now() - new Date(stats.newestMemory).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }, [stats?.newestMemory]);
  const { agents, selectedAgent } = useAgentContext();

  // Fetch all data — re-runs when authMode, wallet, or ready changes
  const fetchAll = useCallback(() => {
    if (!ready) return;

    // Ensure api mode matches current auth context
    if (authMode === 'cortex') {
      const savedKey = localStorage.getItem('cortex_api_key');
      if (savedKey) {
        api.setMode('cortex');
        api.setToken(savedKey);
      }
    } else if (authMode === 'privy') {
      api.setMode('legacy');
      api.setWalletAddress(walletAddress);
      if (!walletAddress) return;
    } else {
      return;
    }

    Promise.all([
      api.getStats().catch(() => null),
      api.getInferenceStats().catch(() => null),
      api.getMemories({ hours: 168, limit: 50 }).catch(() => ({ memories: [], scoped_to: null })),
    ]).then(([s, v, m]) => {
      const memResult = m as { memories: Memory[]; scoped_to?: string | null };
      if (api.verifyScope(s || memResult)) {
        setStats(s);
        setRecentMemories(memResult.memories || []);
      }
      setInferenceStats(v);
      setInitialLoad(false);
    });
  }, [authMode, walletAddress, ready]);

  // Clear and re-fetch on mount, auth changes, and refresh signals
  useEffect(() => {
    setStats(null);
    setRecentMemories([]);
    setInferenceStats(null);
    setInitialLoad(true);
    fetchAll();
    const unsubscribe = api.onRefresh(() => {
      setStats(null);
      setRecentMemories([]);
      setInferenceStats(null);
      setInitialLoad(true);
      fetchAll();
    });
    return unsubscribe;
  }, [fetchAll]);

  // Silent polling — stats every 30s, memories every 15s, venice every 60s
  // Each poll syncs api mode first to prevent stale endpoint issues
  useEffect(() => {
    function syncMode() {
      if (!ready) return;
      if (authMode === 'cortex') {
        const key = localStorage.getItem('cortex_api_key');
        if (key) { api.setMode('cortex'); api.setToken(key); }
      } else if (authMode === 'privy' && walletAddress) {
        api.setMode('legacy'); api.setWalletAddress(walletAddress);
      }
    }

    const refreshStats = () => {
      syncMode();
      api.getStats().then(s => {
        if (api.verifyScope(s)) setStats(s);
      }).catch(() => {});
    };
    const refreshMemories = () => {
      syncMode();
      api.getMemories({ hours: 168, limit: 50 }).then(m => {
        const result = m as { memories: Memory[]; scoped_to?: string | null };
        if (api.verifyScope(result)) setRecentMemories(result.memories || []);
      }).catch(() => {});
    };
    const refreshInference = () => {
      syncMode();
      api.getInferenceStats().then(v => setInferenceStats(v)).catch(() => {});
    };

    const statsInterval = setInterval(refreshStats, 30000);
    const memInterval = setInterval(refreshMemories, 15000);
    const inferenceInterval = setInterval(refreshInference, 60000);
    return () => {
      clearInterval(statsInterval);
      clearInterval(memInterval);
      clearInterval(inferenceInterval);
    };
  }, [authMode, walletAddress, ready]);

  const agentMemories = filterByAgent(
    recentMemories,
    selectedAgent?.id || null,
    selectedAgent?.name || null,
  );

  const total = useCounter(stats?.total || 0);
  const episodic = useCounter(stats?.byType?.episodic || 0);
  const semantic = useCounter(stats?.byType?.semantic || 0);
  const procedural = useCounter(stats?.byType?.procedural || 0);
  const selfModel = useCounter(stats?.byType?.self_model || 0);

  const sparkData = useMemoryTimeline(recentMemories);
  const memoriesPerHour = recentMemories.length > 0
    ? (recentMemories.length / 24).toFixed(1)
    : '0';

  const isOnline = stats !== null;
  const embeddedPct = stats && stats.total > 0
    ? Math.round((stats.embeddedCount / stats.total) * 100)
    : 0;

  const typeData = [
    { type: 'episodic', value: stats?.byType?.episodic || 0 },
    { type: 'semantic', value: stats?.byType?.semantic || 0 },
    { type: 'procedural', value: stats?.byType?.procedural || 0 },
    { type: 'self_model', value: stats?.byType?.self_model || 0 },
  ];

  const activeAgents = agents.filter(a => {
    const lastActive = new Date(a.last_active).getTime();
    return Date.now() - lastActive < 300000; // 5 minutes, consistent with AgentSelector
  }).length || (isOnline ? 1 : 0);

  // ── Loading State ──
  if (initialLoad) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: '60vh', gap: 24,
      }}>
        <NeuralCanvas height={80} opacity={0.2} count={12} />
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 10, color: 'var(--text-faint)',
          letterSpacing: 4, textTransform: 'uppercase',
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', background: 'var(--episodic)',
            animation: 'breathe 2s ease-in-out infinite',
          }} />
          Mapping cortex
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '100%' }}>

      {/* ── Top Status Bar ── */}
      <div className="fade-in" style={{
        display: 'flex', alignItems: 'center', gap: 14,
        marginBottom: 20, padding: '0 2px',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7,
          background: isOnline ? 'rgba(16, 185, 129, 0.06)' : 'rgba(239, 68, 68, 0.06)',
          padding: '4px 12px 4px 8px',
          borderRadius: 2,
          border: `1px solid ${isOnline ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)'}`,
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: isOnline ? '#10b981' : '#ef4444',
            boxShadow: isOnline ? '0 0 6px #10b98150' : 'none',
            animation: isOnline ? 'breathe 3s ease-in-out infinite' : 'none',
          }} />
          <span style={{
            fontSize: 8, letterSpacing: 2, textTransform: 'uppercase',
            color: isOnline ? '#10b981' : '#ef4444', fontWeight: 700,
          }}>
            {isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 500 }}>
          {selectedAgent ? selectedAgent.name : 'All Agents'}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{
          fontSize: 8, color: 'var(--text-faint)', letterSpacing: 1.5,
          fontVariantNumeric: 'tabular-nums', textTransform: 'uppercase',
        }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </span>
      </div>

      {/* ── Bento Grid ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gridTemplateRows: 'auto auto auto auto',
        gridTemplateAreas: `
          "agents  memories memories spark"
          "status  activity activity graph"
          "status  activity activity graph"
          "types   tags     concepts logs"
        `,
        gap: 3,
      }}>

        {/* ── AGENTS ── */}
        <Card area="agents" delay={0.02} style={{
          padding: '20px 18px',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        }}>
          <div style={SECTION_HEADER}>Agents</div>
          <div style={{ margin: '12px 0 4px' }}>
            <span style={{
              fontSize: 40, fontWeight: 800, lineHeight: 1,
              color: 'var(--text)',
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: -2,
            }}>
              {agents.length || 1}
            </span>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 9, color: 'var(--text-faint)',
          }}>
            <span style={{
              width: 4, height: 4, borderRadius: '50%',
              background: activeAgents > 0 ? '#10b981' : 'var(--text-faint)',
              boxShadow: activeAgents > 0 ? '0 0 4px #10b98140' : 'none',
            }} />
            {activeAgents} active now
          </div>
        </Card>

        {/* ── TOTAL MEMORIES ── */}
        <Card area="memories" delay={0.04} style={{
          padding: '20px 18px',
          display: 'flex', alignItems: 'center', gap: 24,
        }}>
          <div style={{ flex: 1 }}>
            <div style={SECTION_HEADER}>Total Memories</div>
            <div style={{
              fontSize: 40, fontWeight: 800, lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: -2,
              margin: '12px 0 6px',
            }}>
              {total.toLocaleString()}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 9, color: 'var(--text-faint)' }}>
              <span>{embeddedPct}% embedded</span>
              <span style={{ opacity: 0.3 }}>/</span>
              <span>{memoriesPerHour}/hr</span>
            </div>
          </div>

          {/* Ring chart + mini type breakdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <TypeRing data={typeData} size={56} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { key: 'episodic', val: episodic },
                { key: 'semantic', val: semantic },
                { key: 'procedural', val: procedural },
                { key: 'self_model', val: selfModel },
              ].map(t => (
                <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    width: 4, height: 4, borderRadius: '50%',
                    background: TYPE_META[t.key].color,
                    boxShadow: `0 0 3px ${TYPE_META[t.key].color}30`,
                  }} />
                  <span style={{
                    fontSize: 11, fontWeight: 600, color: TYPE_META[t.key].color,
                    fontVariantNumeric: 'tabular-nums', minWidth: 32,
                  }}>
                    {formatNum(t.val)}
                  </span>
                  <span style={{
                    fontSize: 7, letterSpacing: 1.5, color: 'var(--text-faint)',
                    textTransform: 'uppercase',
                  }}>
                    {TYPE_META[t.key].short}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* ── 24H SPARKLINE ── */}
        <Card area="spark" delay={0.06} style={{
          padding: '20px 18px 12px',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={SECTION_HEADER}>24h Activity</span>
            <span style={{
              fontSize: 16, fontWeight: 700,
              fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
            }}>
              {recentMemories.length}
            </span>
          </div>
          <div style={{ flex: 1, marginTop: 8, minHeight: 0 }}>
            <Sparkline data={sparkData} height={48} color="#2244ff" />
          </div>
          <div style={{
            fontSize: 8, color: 'var(--text-faint)', marginTop: 4,
            display: 'flex', justifyContent: 'space-between',
            letterSpacing: 0.5,
          }}>
            <span>24h ago</span>
            <span>now</span>
          </div>
        </Card>

        {/* ── SYSTEM STATUS ── */}
        <Card area="status" delay={0.08} style={{
          display: 'flex', flexDirection: 'column',
        }}>
          <CardHeader>System</CardHeader>

          <StatusRow
            label="Status"
            value={isOnline ? 'Running' : 'Stopped'}
            dot={isOnline ? '#10b981' : '#ef4444'}
          />
          <StatusRow label="Last Active" value={uptime} />
          <StatusRow
            label="Avg Decay"
            value={`${((stats?.avgDecay || 0) * 100).toFixed(0)}%`}
            bar={stats?.avgDecay}
            barColor={(stats?.avgDecay || 0) > 0.7 ? '#10b981' : (stats?.avgDecay || 0) > 0.4 ? '#f59e0b' : '#ef4444'}
          />
          <StatusRow
            label="Avg Importance"
            value={(stats?.avgImportance || 0).toFixed(2)}
            bar={stats?.avgImportance}
            barColor="#2244ff"
          />
          <StatusRow label="Dream Sessions" value={String(stats?.totalDreamSessions || 0)} />
          <StatusRow label="Unique Users" value={String(stats?.uniqueUsers || 0)} />
          {inferenceStats?.inference && (
            <StatusRow label="Inference Calls" value={formatNum(inferenceStats.inference.totalInferenceCalls || 0)} />
          )}
          {inferenceStats?.decentralization && (
            <StatusRow label="On-Chain Proofs" value={String(inferenceStats.decentralization.totalMemoriesOnChain || 0)} />
          )}

          <div style={{ flex: 1 }} />

          {/* Embedding coverage footer */}
          <div style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div style={{
              flex: 1, height: 3, background: 'var(--border)',
              borderRadius: 2, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', width: `${embeddedPct}%`,
                background: 'linear-gradient(90deg, #2244ff, #8b5cf6)',
                borderRadius: 2,
                transition: 'width 1.5s cubic-bezier(0.16, 1, 0.3, 1)',
              }} />
            </div>
            <span style={{
              fontSize: 8, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums',
              letterSpacing: 0.5, flexShrink: 0,
            }}>
              {embeddedPct}% embedded
            </span>
          </div>
        </Card>

        {/* ── ACTIVITY FEED ── */}
        <Card area="activity" delay={0.1} style={{
          display: 'flex', flexDirection: 'column', minHeight: 300,
        }}>
          <CardHeader
            right={
              <span style={{
                fontSize: 9, color: 'var(--text-faint)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {agentMemories.length}
              </span>
            }
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span className="pulse-dot" style={{
                width: 5, height: 5, borderRadius: '50%',
                background: '#2244ff',
                boxShadow: '0 0 6px #2244ff40',
              }} />
              Live Feed
            </span>
          </CardHeader>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <ActivityFeed memories={agentMemories} />
          </div>
        </Card>

        {/* ── 3D BRAIN GRAPH ── */}
        <Card area="graph" delay={0.12} style={{
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <CardHeader
            right={
              <Link to="/brain" style={{
                fontSize: 8, color: 'var(--text-faint)',
                textDecoration: 'none', letterSpacing: 1.5,
                textTransform: 'uppercase',
                transition: 'color 0.2s',
              }}>
                Expand →
              </Link>
            }
          >
            Neural Map
          </CardHeader>
          <div style={{ flex: 1, position: 'relative', minHeight: 240 }}>
            <iframe
              src={`/brain.html?embedded=1${walletAddress ? '&wallet=' + encodeURIComponent(walletAddress) : ''}`}
              style={{
                width: '100%', height: '100%',
                border: 'none', display: 'block',
                background: 'var(--bg)',
              }}
              title="Neural Memory Map"
            />
          </div>
        </Card>

        {/* ── TYPE DISTRIBUTION ── */}
        <Card area="types" delay={0.16} style={{ padding: '16px 18px' }}>
          <div style={{ ...SECTION_HEADER, marginBottom: 14 }}>Distribution</div>
          {typeData.map(t => {
            const pct = stats?.total ? (t.value / stats.total) * 100 : 0;
            const meta = TYPE_META[t.type];
            return (
              <div key={t.type} style={{
                marginBottom: 10,
                transition: 'transform 0.2s',
              }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  marginBottom: 4,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      width: 3, height: 10, borderRadius: 1, background: meta.color,
                    }} />
                    <span style={{
                      fontSize: 9, fontWeight: 600, color: 'var(--text-muted)',
                      textTransform: 'uppercase', letterSpacing: 1,
                    }}>
                      {meta.label}
                    </span>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: meta.color,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {pct.toFixed(0)}%
                  </span>
                </div>
                <div style={{
                  height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%', width: `${pct}%`,
                    background: `linear-gradient(90deg, ${meta.color}, ${meta.color}90)`,
                    borderRadius: 2,
                    transition: 'width 1.4s cubic-bezier(0.16, 1, 0.3, 1)',
                  }} />
                </div>
              </div>
            );
          })}
        </Card>

        {/* ── TOP TAGS ── */}
        <Card area="tags" delay={0.2} style={{ padding: '16px 18px' }}>
          <div style={{ ...SECTION_HEADER, marginBottom: 12 }}>Top Tags</div>
          {(stats?.topTags || []).slice(0, 6).map((t, i) => {
            const maxCount = stats?.topTags?.[0]?.count || 1;
            const barPct = (t.count / maxCount) * 100;
            return (
              <div key={t.tag} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 0',
                borderBottom: i < 5 ? '1px solid var(--border)' : 'none',
              }}>
                <span style={{
                  fontSize: 10, color: 'var(--text-muted)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  flex: 1,
                }}>
                  {t.tag}
                </span>
                <div style={{
                  width: 28, height: 3, background: 'var(--border)',
                  borderRadius: 1.5, overflow: 'hidden', flexShrink: 0,
                }}>
                  <div style={{
                    height: '100%', width: `${barPct}%`,
                    background: '#2244ff',
                    borderRadius: 1.5,
                    opacity: 0.5,
                    transition: 'width 1s ease',
                  }} />
                </div>
                <span style={{
                  fontSize: 9, color: 'var(--text-faint)',
                  fontVariantNumeric: 'tabular-nums',
                  minWidth: 20, textAlign: 'right', flexShrink: 0,
                }}>
                  {t.count}
                </span>
              </div>
            );
          })}
          {(!stats?.topTags || stats.topTags.length === 0) && (
            <div style={{ fontSize: 10, color: 'var(--text-faint)', padding: '12px 0' }}>
              No tags yet
            </div>
          )}
        </Card>

        {/* ── TOP CONCEPTS ── */}
        <Card area="concepts" delay={0.24} style={{ padding: '16px 18px' }}>
          <div style={{ ...SECTION_HEADER, marginBottom: 12 }}>Top Concepts</div>
          {(stats?.topConcepts || []).slice(0, 6).map((c, i) => {
            const maxCount = stats?.topConcepts?.[0]?.count || 1;
            const barPct = (c.count / maxCount) * 100;
            return (
              <div key={c.concept} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 0',
                borderBottom: i < 5 ? '1px solid var(--border)' : 'none',
              }}>
                <span style={{
                  fontSize: 10, color: 'var(--text-muted)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  flex: 1,
                }}>
                  {c.concept.replace(/_/g, ' ')}
                </span>
                <div style={{
                  width: 28, height: 3, background: 'var(--border)',
                  borderRadius: 1.5, overflow: 'hidden', flexShrink: 0,
                }}>
                  <div style={{
                    height: '100%', width: `${barPct}%`,
                    background: '#10b981',
                    borderRadius: 1.5,
                    opacity: 0.5,
                    transition: 'width 1s ease',
                  }} />
                </div>
                <span style={{
                  fontSize: 9, color: 'var(--text-faint)',
                  fontVariantNumeric: 'tabular-nums',
                  minWidth: 20, textAlign: 'right', flexShrink: 0,
                }}>
                  {c.count}
                </span>
              </div>
            );
          })}
          {(!stats?.topConcepts || stats.topConcepts.length === 0) && (
            <div style={{ fontSize: 10, color: 'var(--text-faint)', padding: '12px 0' }}>
              No concepts yet
            </div>
          )}
        </Card>

        {/* ── RECENT EVENTS ── */}
        <Card area="logs" delay={0.28} style={{
          display: 'flex', flexDirection: 'column',
        }}>
          <CardHeader>Recent Events</CardHeader>
          <div style={{ flex: 1, overflow: 'auto', maxHeight: 200 }}>
            {(agentMemories.length > 0 ? agentMemories : recentMemories).slice(0, 8).map((m) => (
              <div key={m.id} style={{
                padding: '6px 16px',
                borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 8,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-warm)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
              >
                <span style={{
                  fontSize: 8, color: 'var(--text-faint)',
                  fontVariantNumeric: 'tabular-nums',
                  flexShrink: 0, width: 22, letterSpacing: 0.3,
                }}>
                  {relativeTime(m.created_at)}
                </span>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: TYPE_META[m.memory_type]?.color || '#999',
                  flexShrink: 0,
                  boxShadow: `0 0 3px ${TYPE_META[m.memory_type]?.color || '#999'}30`,
                }} />
                <span style={{
                  fontSize: 9, color: 'var(--text-muted)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  flex: 1,
                }}>
                  <span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>
                    {m.source || 'store'}
                  </span>
                  {' '}{m.summary.slice(0, 55)}
                </span>
              </div>
            ))}
            {recentMemories.length === 0 && (
              <div style={{
                padding: '24px 16px', fontSize: 10,
                color: 'var(--text-faint)', textAlign: 'center',
              }}>
                No recent events
              </div>
            )}
          </div>
          <Link to="/timeline" style={{
            padding: '9px 16px',
            borderTop: '1px solid var(--border)',
            fontSize: 8, color: 'var(--text-faint)',
            textDecoration: 'none',
            display: 'flex', alignItems: 'center',
            letterSpacing: 1.5, textTransform: 'uppercase',
            transition: 'color 0.15s, background 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-muted)';
            (e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-warm)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-faint)';
            (e.currentTarget as HTMLAnchorElement).style.background = 'transparent';
          }}
          >
            View Timeline
            <span style={{ marginLeft: 'auto', fontSize: 11 }}>→</span>
          </Link>
        </Card>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────

function StatusRow({ label, value, dot, bar, barColor }: {
  label: string; value: string; dot?: string; bar?: number; barColor?: string;
}) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center',
        padding: '7px 16px',
        borderBottom: '1px solid var(--border)',
        fontSize: 10,
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-warm)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      {dot && (
        <span style={{
          width: 5, height: 5, borderRadius: '50%', background: dot,
          marginRight: 10, flexShrink: 0,
          boxShadow: `0 0 6px ${dot}40`,
          animation: dot === '#10b981' ? 'breathe 3s ease-in-out infinite' : 'none',
        }} />
      )}
      <span style={{ flex: 1, color: 'var(--text-muted)', fontSize: 9, letterSpacing: 0.3 }}>{label}</span>
      {bar !== undefined && (
        <div style={{
          width: 40, height: 3, background: 'var(--border)',
          borderRadius: 2, marginRight: 10, overflow: 'hidden',
        }}>
          <div style={{
            width: `${Math.min((bar || 0) * 100, 100)}%`, height: '100%',
            background: barColor || '#2244ff',
            borderRadius: 2,
            transition: 'width 1.4s cubic-bezier(0.16, 1, 0.3, 1)',
          }} />
        </div>
      )}
      <span style={{
        fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontSize: 10,
        color: 'var(--text)', letterSpacing: 0.3,
      }}>
        {value}
      </span>
    </div>
  );
}
