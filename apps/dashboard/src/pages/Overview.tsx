import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { Memory, MemoryStats } from '../types/memory';
import { MEMORY_TYPES, typeStyle, relTime, pct } from '../lib/memory-ui';

/**
 * Overview — the pulse, at a glance.
 * Hero stat row (total + per-type), a composition ring, a health glance, the
 * live recent-activity feed, and the tokens-saved proof metric. All bound to
 * the owner-scoped cortex endpoints; nothing is mocked.
 */
export function Overview() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [recent, setRecent] = useState<Memory[]>([]);
  const [tokensSaved, setTokensSaved] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      const [s, r, t] = await Promise.all([
        api.getStats().catch(() => null),
        api.getMemories({ hours: 168, limit: 8 }).then((d) => d.memories).catch(() => [] as Memory[]),
        api.getTokensSaved().catch(() => null),
      ]);
      if (!live) return;
      setStats(s);
      setRecent(r);
      setTokensSaved(t?.totalSaved ?? null);
      setLoading(false);
    })();
    return () => { live = false; };
  }, []);

  const total = stats?.total ?? 0;
  const byType = (stats?.byType ?? {}) as Record<string, number>;

  // Conic-gradient stops for the composition ring, in canonical type order.
  let acc = 0;
  const ringStops = MEMORY_TYPES.map((t) => {
    const start = total ? (acc / total) * 360 : 0;
    acc += byType[t.key] ?? 0;
    const end = total ? (acc / total) * 360 : 0;
    return `${t.color} ${start}deg ${end}deg`;
  }).join(',');

  return (
    <div style={{ padding: '26px 32px 40px', maxWidth: 1240 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-3)', marginBottom: 9 }}>Overview</div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--fg)' }}>Your agent's memory</h1>
          <p style={{ margin: '7px 0 0', fontSize: 13.5, color: 'var(--fg-2)', maxWidth: 480, lineHeight: 1.5 }}>What your agent has seen, learned, and become — typed, decaying, and verifiable.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 'none' }}>
          <button className="pbtn" onClick={() => navigate('/export')} style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-fg)', background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '9px 15px', cursor: 'pointer' }}>Export memory</button>
        </div>
      </div>

      {/* Hero stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr 1fr 1fr 1fr 1fr', gap: 10, marginBottom: 18 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '15px 16px' }}>
          <div style={{ fontSize: 11.5, color: 'var(--fg-2)', fontWeight: 500, marginBottom: 8 }}>Total memories</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--fg)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {loading ? '—' : total.toLocaleString()}
          </div>
        </div>
        {MEMORY_TYPES.map((t) => {
          const n = byType[t.key] ?? 0;
          return (
            <div key={t.key} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '15px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color }} />
                <span style={{ fontSize: 11.5, color: 'var(--fg-2)', fontWeight: 500 }}>{t.short}</span>
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 600, color: 'var(--fg)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{n.toLocaleString()}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--fg-3)', marginTop: 6 }}>{total ? pct(n / total) : '—'}</div>
            </div>
          );
        })}
      </div>

      {/* Composition + Health (left) · Live activity (right) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Composition ring */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 16 }}>Composition</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
              <div style={{ position: 'relative', width: 158, height: 158, flex: 'none', borderRadius: '50%', background: total ? `conic-gradient(${ringStops})` : 'var(--surface-3)' }}>
                <div style={{ position: 'absolute', inset: 29, borderRadius: '50%', background: 'var(--surface)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.02em' }}>{loading ? '—' : total.toLocaleString()}</span>
                  <span style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 2 }}>memories</span>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 11 }}>
                {MEMORY_TYPES.map((t) => {
                  const n = byType[t.key] ?? 0;
                  return (
                    <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: t.color }} />
                      <span style={{ fontSize: 12.5, color: 'var(--fg)', flex: 1 }}>{t.label}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg)' }}>{n.toLocaleString()}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)', width: 34, textAlign: 'right' }}>{total ? pct(n / total) : '—'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Health glance */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 16 }}>Health</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '18px 12px' }}>
              <HealthCell value={stats ? stats.avgImportance.toFixed(2) : '—'} label="Avg importance" />
              <HealthCell value={stats ? pct(stats.avgDecay) : '—'} label="Avg retention" />
              <HealthCell value={stats ? String(stats.totalDreamSessions) : '—'} label="Dream cycles" />
              <HealthCell value={relTime(stats?.oldestMemory)} label="Oldest memory" />
              <HealthCell value={relTime(stats?.newestMemory)} label="Newest memory" />
              <HealthCell value={stats ? String(stats.embeddedCount) : '—'} label="Embedded" />
            </div>
          </div>
        </div>

        {/* Live activity feed */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Recent activity</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#10b981' }}>
              <span className="cl-pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />Live
            </span>
          </div>
          {recent.length === 0 && (
            <div style={{ padding: '24px 18px', fontSize: 13, color: 'var(--fg-3)', lineHeight: 1.5 }}>
              {loading ? 'Loading…' : 'No memories in the last 7 days. Store one from a connected agent and it appears here.'}
            </div>
          )}
          {recent.map((m, i) => {
            const t = typeStyle(m.memory_type);
            return (
              <div key={m.id ?? i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--hairline)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color, flex: 'none' }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--fg)', lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.summary || m.content}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)', flex: 'none' }}>{relTime(m.created_at)}</span>
              </div>
            );
          })}
          <div style={{ marginTop: 'auto', padding: '12px 18px', borderTop: '1px solid var(--border)' }}>
            <a className="lnk" onClick={() => navigate('/explore')} style={{ fontSize: 12, color: 'var(--accent-text)', textDecoration: 'none', fontWeight: 500, cursor: 'pointer' }}>Open in Explore →</a>
          </div>
        </div>
      </div>

      {/* Tokens saved */}
      {tokensSaved != null && (
        <div style={{ marginTop: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '15px 20px', display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ flex: 'none' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 600, color: 'var(--fg)' }}>{tokensSaved.toLocaleString()}</span>{' '}
            <span style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>tokens saved</span>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-3)', flex: 1 }}>Recalled instead of re-reading context.</p>
        </div>
      )}
    </div>
  );
}

function HealthCell({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 19, fontWeight: 600, color: 'var(--fg)' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 5 }}>{label}</div>
    </div>
  );
}
