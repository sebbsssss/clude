import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Memory, MemoryType } from '../types/memory';

const TYPE_COLORS: Record<MemoryType, string> = {
  episodic: 'var(--episodic)',
  semantic: 'var(--semantic)',
  procedural: 'var(--procedural)',
  self_model: 'var(--self-model)',
};

const TYPE_LABELS: Record<MemoryType, string> = {
  episodic: 'Episodic',
  semantic: 'Semantic',
  procedural: 'Procedural',
  self_model: 'Self-Model',
};

export function Timeline() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<MemoryType | 'all'>('all');
  const [hours, setHours] = useState(168);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    api.getMemories({ hours, limit: 50 }).then((data) => {
      setMemories(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [hours]);

  const filtered = memories
    .filter((m) => filter === 'all' || m.memory_type === filter)
    .filter((m) => !search || m.summary.toLowerCase().includes(search.toLowerCase()) || m.tags.some(t => t.includes(search.toLowerCase())));

  return (
    <div>
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 12 }}>
          Timeline
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8 }}>
          Memory Timeline
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {filtered.length} memories shown
        </p>
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex',
        gap: 12,
        marginBottom: 32,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        <input
          type="text"
          placeholder="Search memories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 12,
            padding: '8px 16px',
            border: '1px solid var(--border-strong)',
            background: 'transparent',
            width: 240,
            outline: 'none',
          }}
        />

        {(['all', 'episodic', 'semantic', 'procedural', 'self_model'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 10,
              letterSpacing: 1,
              textTransform: 'uppercase',
              padding: '6px 14px',
              border: `1px solid ${filter === t ? 'var(--text)' : 'var(--border-strong)'}`,
              background: filter === t ? 'var(--text)' : 'transparent',
              color: filter === t ? 'var(--bg)' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            {t === 'all' ? 'All' : TYPE_LABELS[t]}
          </button>
        ))}

        <select
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 11,
            padding: '7px 12px',
            border: '1px solid var(--border-strong)',
            background: 'transparent',
            color: 'var(--text-muted)',
            marginLeft: 'auto',
          }}
        >
          <option value={24}>24 hours</option>
          <option value={72}>3 days</option>
          <option value={168}>1 week</option>
          <option value={720}>30 days</option>
        </select>
      </div>

      {/* Timeline */}
      {loading ? (
        <div style={{ color: 'var(--text-faint)', padding: 40, textAlign: 'center' }}>Loading...</div>
      ) : (
        <div style={{ position: 'relative', paddingLeft: 40 }}>
          {/* Vertical line */}
          <div style={{
            position: 'absolute',
            left: 16,
            top: 0,
            bottom: 0,
            width: 1,
            background: 'var(--border-strong)',
          }} />

          {filtered.map((memory) => (
            <MemoryCard key={memory.id} memory={memory} />
          ))}

          {filtered.length === 0 && (
            <div style={{ color: 'var(--text-faint)', padding: 40, textAlign: 'center' }}>
              No memories found
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MemoryCard({ memory }: { memory: Memory }) {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(memory.created_at);
  const color = TYPE_COLORS[memory.memory_type];

  return (
    <div
      style={{
        position: 'relative',
        marginBottom: 2,
        cursor: 'pointer',
      }}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Dot on timeline */}
      <div style={{
        position: 'absolute',
        left: -32,
        top: 18,
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: color,
        border: '2px solid var(--bg)',
      }} />

      <div style={{
        border: '1px solid var(--border)',
        padding: '16px 20px',
        background: expanded ? 'var(--bg-warm)' : 'var(--bg)',
        transition: 'background 0.15s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{
            fontSize: 9,
            letterSpacing: 1,
            textTransform: 'uppercase',
            color,
            fontWeight: 600,
          }}>
            {TYPE_LABELS[memory.memory_type]}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)' }}>
            imp: {memory.importance.toFixed(2)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            decay: {memory.decay_factor.toFixed(2)}
          </span>
        </div>

        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          {memory.summary}
        </div>

        {expanded && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            {memory.content && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: 12 }}>
                {memory.content}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {memory.tags.map((tag) => (
                <span key={tag} style={{
                  fontSize: 10,
                  padding: '2px 8px',
                  background: 'var(--blue-light)',
                  color: 'var(--blue)',
                  letterSpacing: 0.5,
                }}>
                  {tag}
                </span>
              ))}
              {memory.concepts.map((c) => (
                <span key={c} style={{
                  fontSize: 10,
                  padding: '2px 8px',
                  background: 'rgba(0,0,0,0.04)',
                  color: 'var(--text-muted)',
                  letterSpacing: 0.5,
                }}>
                  {c}
                </span>
              ))}
            </div>

            {memory.solana_signature && (
              <div style={{ marginTop: 12, fontSize: 11 }}>
                <a
                  href={`https://solscan.io/tx/${memory.solana_signature}`}
                  target="_blank"
                  rel="noopener"
                  style={{ color: 'var(--blue)' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  View on-chain proof ↗
                </a>
              </div>
            )}

            <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-faint)' }}>
              ID: {memory.hash_id} · Source: {memory.source} · Accessed: {memory.access_count}x
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
