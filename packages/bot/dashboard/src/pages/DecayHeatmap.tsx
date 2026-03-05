import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Memory, MemoryType } from '../types/memory';

const TYPE_COLORS: Record<MemoryType, string> = {
  episodic: '#2244ff',
  semantic: '#10b981',
  procedural: '#f59e0b',
  self_model: '#8b5cf6',
};

export function DecayHeatmap() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'decay' | 'importance' | 'age'>('decay');

  useEffect(() => {
    api.getMemories({ hours: 720, limit: 50 }).then((data) => {
      setMemories(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const sorted = [...memories].sort((a, b) => {
    if (sortBy === 'decay') return a.decay_factor - b.decay_factor;
    if (sortBy === 'importance') return b.importance - a.importance;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  // Group by type for summary
  const typeGroups = memories.reduce((acc, m) => {
    if (!acc[m.memory_type]) acc[m.memory_type] = [];
    acc[m.memory_type].push(m);
    return acc;
  }, {} as Record<string, Memory[]>);

  return (
    <div>
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 12 }}>
          Memory Health
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8 }}>
          Decay Heatmap
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Memory strength over time. Brighter = stronger. Dimmer = fading.
        </p>
      </div>

      {/* Type Summary */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 1,
        background: 'var(--border)',
        border: '1px solid var(--border)',
        marginBottom: 32,
      }}>
        {(['episodic', 'semantic', 'procedural', 'self_model'] as MemoryType[]).map((type) => {
          const group = typeGroups[type] || [];
          const avgDecay = group.length > 0 ? group.reduce((s, m) => s + m.decay_factor, 0) / group.length : 0;
          return (
            <div key={type} style={{ background: 'var(--bg)', padding: '20px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: TYPE_COLORS[type], fontWeight: 600, marginBottom: 8 }}>
                {type.replace('_', ' ')}
              </div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{(avgDecay * 100).toFixed(0)}%</div>
              <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 4 }}>avg strength</div>
            </div>
          );
        })}
      </div>

      {/* Sort controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {(['decay', 'importance', 'age'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 10,
              letterSpacing: 1,
              textTransform: 'uppercase',
              padding: '6px 14px',
              border: `1px solid ${sortBy === s ? 'var(--text)' : 'var(--border-strong)'}`,
              background: sortBy === s ? 'var(--text)' : 'transparent',
              color: sortBy === s ? 'var(--bg)' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            {s === 'decay' ? 'By Decay' : s === 'importance' ? 'By Importance' : 'By Age'}
          </button>
        ))}
      </div>

      {/* Heatmap Grid */}
      {loading ? (
        <div style={{ color: 'var(--text-faint)', padding: 40, textAlign: 'center' }}>Loading...</div>
      ) : (
        <div style={{ border: '1px solid var(--border)' }}>
          {sorted.map((memory) => {
            const color = TYPE_COLORS[memory.memory_type];
            const opacity = Math.max(0.08, memory.decay_factor);
            const age = Math.floor((Date.now() - new Date(memory.created_at).getTime()) / (1000 * 60 * 60 * 24));

            return (
              <div
                key={memory.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 16px',
                  borderBottom: '1px solid var(--border)',
                  background: `rgba(${color === '#2244ff' ? '34,68,255' : color === '#10b981' ? '16,185,129' : color === '#f59e0b' ? '245,158,11' : '139,92,246'}, ${opacity * 0.12})`,
                }}
              >
                {/* Decay bar */}
                <div style={{ width: 60, marginRight: 16 }}>
                  <div style={{
                    height: 4,
                    background: 'var(--border)',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${memory.decay_factor * 100}%`,
                      background: color,
                      borderRadius: 2,
                    }} />
                  </div>
                </div>

                {/* Type badge */}
                <span style={{
                  fontSize: 9,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                  color,
                  fontWeight: 600,
                  width: 80,
                }}>
                  {memory.memory_type.replace('_', ' ')}
                </span>

                {/* Summary */}
                <span style={{ flex: 1, fontSize: 12, color: `rgba(17,17,17,${0.3 + opacity * 0.7})` }}>
                  {memory.summary.slice(0, 80)}{memory.summary.length > 80 ? '...' : ''}
                </span>

                {/* Metrics */}
                <span style={{ fontSize: 10, color: 'var(--text-faint)', width: 60, textAlign: 'right' }}>
                  {(memory.decay_factor * 100).toFixed(0)}%
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-faint)', width: 60, textAlign: 'right' }}>
                  imp: {memory.importance.toFixed(2)}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-faint)', width: 50, textAlign: 'right' }}>
                  {age}d ago
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
