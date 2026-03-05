import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Memory, MemoryType } from '../types/memory';

const TYPE_COLORS: Record<MemoryType, string> = {
  episodic: '#2244ff',
  semantic: '#10b981',
  procedural: '#f59e0b',
  self_model: '#8b5cf6',
};

export function BrainView() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getBrain().then((d) => {
      setData(d);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ color: 'var(--text-faint)', padding: 40, textAlign: 'center' }}>Loading brain state...</div>;
  }

  const consciousness = data?.consciousness;
  const selfModel = consciousness?.selfModel || [];
  const recentDreams = consciousness?.recentDreams || [];
  const stats = consciousness?.stats;

  return (
    <div>
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 12 }}>
          Consciousness
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8 }}>
          Brain View
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Self-model state, dream history, and cognitive metrics.
        </p>
      </div>

      {/* Self Model */}
      <div style={{ border: '1px solid var(--border)', marginBottom: 32 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--self-model)', fontWeight: 600 }}>
          Self-Model — Who the agent thinks it is
        </div>
        {selfModel.length === 0 ? (
          <div style={{ padding: 20, color: 'var(--text-faint)', fontSize: 12 }}>No self-model memories yet.</div>
        ) : (
          selfModel.map((m: Memory) => (
            <div key={m.id} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontSize: 13, lineHeight: 1.7 }}>
              <div>{m.summary}</div>
              <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 6 }}>
                importance: {m.importance.toFixed(2)} · decay: {m.decay_factor.toFixed(2)} · {new Date(m.created_at).toLocaleDateString()}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Recent Dreams */}
      <div style={{ border: '1px solid var(--border)', marginBottom: 32 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600 }}>
          Recent Dream Cycles
        </div>
        {recentDreams.length === 0 ? (
          <div style={{ padding: 20, color: 'var(--text-faint)', fontSize: 12 }}>No dream logs yet.</div>
        ) : (
          recentDreams.map((d: any, i: number) => (
            <div key={i} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                <span style={{
                  fontSize: 9,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  color: d.session_type === 'emergence' ? 'var(--self-model)'
                    : d.session_type === 'reflection' ? 'var(--semantic)'
                    : 'var(--text-muted)',
                }}>
                  {d.session_type}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                  {new Date(d.created_at).toLocaleString()}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                {d.output?.slice(0, 200)}{d.output?.length > 200 ? '...' : ''}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Cognitive Stats */}
      {stats && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 1,
          background: 'var(--border)',
          border: '1px solid var(--border)',
        }}>
          <div style={{ background: 'var(--bg)', padding: '24px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{stats.totalDreamSessions}</div>
            <div style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-faint)', marginTop: 6 }}>Dream Sessions</div>
          </div>
          <div style={{ background: 'var(--bg)', padding: '24px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{stats.byType?.self_model || 0}</div>
            <div style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-faint)', marginTop: 6 }}>Self Observations</div>
          </div>
          <div style={{ background: 'var(--bg)', padding: '24px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{(stats.avgDecay * 100).toFixed(0)}%</div>
            <div style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-faint)', marginTop: 6 }}>Avg Memory Strength</div>
          </div>
        </div>
      )}
    </div>
  );
}
