import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { NeuralCanvas } from '../components/NeuralCanvas';
import { useAgentContext } from '../context/AgentContext';
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

function filterByAgent(memories: Memory[], agentId: string | null, agentName: string | null): Memory[] {
  if (!agentId) return memories;
  return memories.filter((m) =>
    m.related_user === agentId ||
    (agentName && m.source?.includes(agentName)) ||
    (agentName && (m.metadata as any)?.agentName === agentName),
  );
}

export function Timeline() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<MemoryType | 'all'>('all');
  const [hours, setHours] = useState(168);
  const [search, setSearch] = useState('');
  const { selectedAgent } = useAgentContext();

  useEffect(() => {
    function load() {
      setLoading(true);
      api.getMemories({ hours, limit: 50 }).then((data) => {
        const result = data as any;
        const mems = result?.memories || (Array.isArray(data) ? data : []);
        if (api.verifyScope(result)) {
          setMemories(mems);
        } else {
          setMemories([]);
        }
        setLoading(false);
      }).catch(() => {
        setMemories([]);
        setLoading(false);
      });
    }
    load();
    const unsubscribe = api.onRefresh(() => {
      setMemories([]);
      load();
    });
    return () => { unsubscribe(); };
  }, [hours]);

  const agentMemories = filterByAgent(memories || [], selectedAgent?.id || null, selectedAgent?.name || null);
  const filtered = agentMemories
    .filter((m) => filter === 'all' || m.memory_type === filter)
    .filter((m) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (m.summary || '').toLowerCase().includes(q)
        || (m.tags || []).some(t => t.toLowerCase().includes(q));
    });

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <div className="fade-in" style={{
          fontSize: 11, letterSpacing: 3, textTransform: 'uppercase',
          color: 'var(--text-faint)', marginBottom: 10,
        }}>
          Timeline
        </div>
        <h1 className="fade-in" style={{
          fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 6,
          animationDelay: '0.03s',
        }}>
          Memory Timeline
        </h1>
        <p className="fade-in" style={{
          fontSize: 13, color: 'var(--text-muted)', animationDelay: '0.06s',
        }}>
          {filtered.length} memories shown
        </p>
      </div>

      {/* Filters */}
      <div className="fade-in" style={{
        display: 'flex', gap: 10, marginBottom: 28,
        alignItems: 'center', flexWrap: 'wrap',
        animationDelay: '0.08s',
      }}>
        <input
          type="text"
          placeholder="Search memories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 12,
            padding: '8px 14px',
            border: '1px solid var(--border-strong)',
            background: 'transparent',
            width: 220,
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
              padding: '6px 12px',
              border: `1px solid ${filter === t ? 'var(--text)' : 'var(--border-strong)'}`,
              background: filter === t ? 'var(--text)' : 'transparent',
              color: filter === t ? 'var(--bg)' : 'var(--text-muted)',
              cursor: 'pointer',
              transition: 'all 0.15s',
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
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: 60, gap: 16,
        }}>
          <NeuralCanvas height={80} opacity={0.2} count={12} />
          <div style={{
            fontSize: 11, color: 'var(--text-faint)',
            letterSpacing: 2, textTransform: 'uppercase',
          }}>
            <span className="pulse-dot" style={{
              display: 'inline-block', width: 5, height: 5,
              borderRadius: '50%', background: 'var(--episodic)',
              marginRight: 6, verticalAlign: 'middle',
            }} />
            Recalling memories
          </div>
        </div>
      ) : (
        <div style={{ position: 'relative', paddingLeft: 40 }}>
          {/* Vertical line */}
          <div style={{
            position: 'absolute',
            left: 16, top: 0, bottom: 0,
            width: 1,
            background: 'var(--border-strong)',
          }} />

          {filtered.map((memory, index) => (
            <MemoryCard key={memory.id} memory={memory} index={index} />
          ))}

          {filtered.length === 0 && (
            <div style={{
              color: 'var(--text-faint)', padding: 40,
              textAlign: 'center', fontSize: 12,
            }}>
              No memories found for this filter.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MemoryCard({ memory, index }: { memory: Memory; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(memory.created_at);
  const color = TYPE_COLORS[memory.memory_type];
  const isRecent = Date.now() - date.getTime() < 3600000; // < 1 hour

  return (
    <div
      className="fade-in"
      style={{
        position: 'relative',
        marginBottom: 2,
        cursor: 'pointer',
        animationDelay: `${Math.min(index * 0.03, 0.6)}s`,
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
        boxShadow: isRecent ? `0 0 8px ${color}` : 'none',
        animation: isRecent ? 'breathe 2.5s ease-in-out infinite' : 'none',
      }} />

      <div style={{
        border: '1px solid var(--border)',
        padding: '14px 18px',
        background: expanded ? 'var(--bg-warm)' : 'var(--bg)',
        transition: 'all 0.2s',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6,
        }}>
          <span style={{
            fontSize: 9, letterSpacing: 1, textTransform: 'uppercase',
            color, fontWeight: 600,
          }}>
            {TYPE_LABELS[memory.memory_type]}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span style={{
            marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)',
          }}>
            imp: {memory.importance?.toFixed(2)}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
            decay: {memory.decay_factor?.toFixed(2)}
          </span>
        </div>

        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          {memory.summary}
        </div>

        {expanded && (
          <div style={{
            marginTop: 14, paddingTop: 14,
            borderTop: '1px solid var(--border)',
          }}>
            {memory.content && (
              <div style={{
                fontSize: 12, color: 'var(--text-muted)',
                lineHeight: 1.7, marginBottom: 12,
              }}>
                {memory.content}
              </div>
            )}

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(memory.tags || []).map((tag) => (
                <span key={tag} style={{
                  fontSize: 10, padding: '2px 8px',
                  background: 'var(--blue-light)',
                  color: 'var(--blue)',
                  letterSpacing: 0.5,
                }}>
                  {tag}
                </span>
              ))}
              {(memory.concepts || []).map((c) => (
                <span key={c} style={{
                  fontSize: 10, padding: '2px 8px',
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

            <div style={{
              marginTop: 8, fontSize: 10, color: 'var(--text-faint)',
            }}>
              ID: {memory.hash_id} / Source: {memory.source} / Accessed: {memory.access_count}x
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
