import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { BrainVisualization } from '../components/BrainVisualization';
import { useAgentContext } from '../context/AgentContext';
import type { Memory, MemoryType } from '../types/memory';

const TYPE_LABELS: Record<MemoryType, string> = {
  episodic: 'Episodic',
  semantic: 'Semantic',
  procedural: 'Procedural',
  self_model: 'Self-Model',
};

export function BrainView() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [consciousness, setConsciousness] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
  const [typeFilter, setTypeFilter] = useState<Set<MemoryType>>(
    new Set(['episodic', 'semantic', 'procedural', 'self_model']),
  );
  const [showSelfModel, setShowSelfModel] = useState(false);
  const { selectedAgent } = useAgentContext();

  useEffect(() => {
    function load() {
      setLoading(true);
      api.getBrain().then((d) => {
        const mems = d?.memories || [];
        setMemories(Array.isArray(mems) ? mems : []);
        setConsciousness(d?.consciousness || null);
        setLoading(false);
      }).catch(() => {
        setMemories([]);
        setLoading(false);
      });
    }
    load();
    const unsubscribe = api.onRefresh(() => {
      setMemories([]);
      setConsciousness(null);
      load();
    });
    return () => { unsubscribe(); };
  }, []);

  // Filter by agent
  const agentMemories = selectedAgent
    ? memories.filter((m) =>
        m.related_user === selectedAgent.id ||
        m.source?.includes(selectedAgent.name) ||
        (m.metadata as any)?.agentName === selectedAgent.name,
      )
    : memories;

  const selfModel: Memory[] = consciousness?.selfModel || [];
  const stats = consciousness?.stats;

  if (loading) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: 'calc(100vh - 80px)',
        background: '#0a0a0f', gap: 20,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          border: '2px solid rgba(139,92,246,0.3)',
          borderTopColor: '#8b5cf6',
          animation: 'spin 1s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{
          fontSize: 11, color: 'rgba(255,255,255,0.35)',
          letterSpacing: 3, textTransform: 'uppercase',
        }}>
          Loading consciousness
        </div>
      </div>
    );
  }

  function toggleType(type: MemoryType) {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size > 1) next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  return (
    <div style={{
      height: 'calc(100vh - 80px)',
      position: 'relative',
      overflow: 'hidden',
      margin: '-40px',
    }}>
      {/* Full-canvas visualization */}
      <BrainVisualization
        memories={agentMemories}
        onSelectMemory={setSelectedMemory}
        selectedMemoryId={selectedMemory?.id || null}
        typeFilter={typeFilter}
      />

      {/* Filter bar — bottom center */}
      <div style={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 4,
        background: 'rgba(10,10,15,0.8)',
        border: '1px solid rgba(255,255,255,0.08)',
        padding: '6px 8px',
        backdropFilter: 'blur(8px)',
      }}>
        {(Object.entries(TYPE_LABELS) as [MemoryType, string][]).map(([type, label]) => {
          const active = typeFilter.has(type);
          return (
            <button
              key={type}
              onClick={() => toggleType(type)}
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 9,
                letterSpacing: 1,
                textTransform: 'uppercase',
                padding: '4px 10px',
                border: `1px solid ${active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)'}`,
                background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: active ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.25)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Self-model toggle — bottom left */}
      {selfModel.length > 0 && (
        <div style={{
          position: 'absolute',
          bottom: 16,
          left: 16,
        }}>
          <button
            onClick={() => setShowSelfModel(!showSelfModel)}
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 9,
              letterSpacing: 1,
              textTransform: 'uppercase',
              padding: '6px 12px',
              background: showSelfModel ? 'rgba(139,92,246,0.15)' : 'rgba(10,10,15,0.8)',
              border: `1px solid ${showSelfModel ? 'rgba(139,92,246,0.3)' : 'rgba(255,255,255,0.08)'}`,
              color: showSelfModel ? '#8b5cf6' : 'rgba(255,255,255,0.4)',
              cursor: 'pointer',
              backdropFilter: 'blur(8px)',
            }}
          >
            Self-Model ({selfModel.length})
          </button>

          {/* Self-model panel */}
          {showSelfModel && (
            <div style={{
              position: 'absolute',
              bottom: 40,
              left: 0,
              width: 320,
              maxHeight: 300,
              overflow: 'auto',
              background: 'rgba(10,10,15,0.92)',
              border: '1px solid rgba(255,255,255,0.08)',
              backdropFilter: 'blur(12px)',
            }}>
              <div style={{
                padding: '8px 12px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                fontSize: 9,
                letterSpacing: 1,
                textTransform: 'uppercase',
                color: '#8b5cf6',
                fontWeight: 600,
              }}>
                Self-Observations
              </div>
              {selfModel.map((m: Memory) => (
                <div
                  key={m.id}
                  style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    fontSize: 11,
                    color: 'rgba(255,255,255,0.6)',
                    lineHeight: 1.6,
                  }}
                >
                  {m.summary}
                  <div style={{
                    fontSize: 9,
                    color: 'rgba(255,255,255,0.25)',
                    marginTop: 4,
                  }}>
                    imp: {m.importance?.toFixed(2)} / strength: {((m.decay_factor || 0) * 100).toFixed(0)}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stats HUD — top left (below the canvas HUD, complementary) */}
      {stats && (
        <div style={{
          position: 'absolute',
          top: 80,
          left: 16,
          pointerEvents: 'none',
        }}>
          {stats.totalDreamSessions > 0 && (
            <div style={{
              fontSize: 10,
              color: 'rgba(255,255,255,0.25)',
              marginBottom: 4,
            }}>
              {stats.totalDreamSessions} dream cycles
            </div>
          )}
          <div style={{
            fontSize: 10,
            color: 'rgba(255,255,255,0.2)',
          }}>
            {stats.total?.toLocaleString()} total memories
          </div>
        </div>
      )}

      {/* Detail Panel — right side, slides in */}
      {selectedMemory && (
        <div
          className="slide-in"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 340,
            height: '100%',
            background: 'rgba(10,10,15,0.95)',
            borderLeft: '1px solid rgba(255,255,255,0.08)',
            backdropFilter: 'blur(12px)',
            overflow: 'auto',
            animation: 'slideInRight 0.25s ease-out',
          }}
        >
          <style>{`
            @keyframes slideInRight {
              from { transform: translateX(100%); opacity: 0; }
              to { transform: translateX(0); opacity: 1; }
            }
          `}</style>

          {/* Close button */}
          <button
            onClick={() => setSelectedMemory(null)}
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.4)',
              fontSize: 16,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            ×
          </button>

          <div style={{ padding: 20 }}>
            {/* Type badge */}
            <div style={{
              fontSize: 9,
              letterSpacing: 1,
              textTransform: 'uppercase',
              color: `var(--${selectedMemory.memory_type.replace('_', '-')})`,
              fontWeight: 600,
              marginBottom: 12,
            }}>
              {TYPE_LABELS[selectedMemory.memory_type]}
            </div>

            {/* Summary */}
            <div style={{
              fontSize: 14,
              color: 'rgba(255,255,255,0.85)',
              lineHeight: 1.7,
              marginBottom: 16,
            }}>
              {selectedMemory.summary}
            </div>

            {/* Content */}
            {selectedMemory.content && (
              <div style={{
                fontSize: 12,
                color: 'rgba(255,255,255,0.5)',
                lineHeight: 1.7,
                marginBottom: 16,
                paddingTop: 16,
                borderTop: '1px solid rgba(255,255,255,0.06)',
              }}>
                {selectedMemory.content}
              </div>
            )}

            {/* Tags */}
            {(selectedMemory.tags || []).length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16 }}>
                {selectedMemory.tags.map((tag) => (
                  <span key={tag} style={{
                    fontSize: 9,
                    padding: '2px 8px',
                    background: 'rgba(34,68,255,0.1)',
                    color: 'rgba(34,68,255,0.7)',
                    letterSpacing: 0.5,
                  }}>
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Metadata */}
            <div style={{
              fontSize: 10,
              color: 'rgba(255,255,255,0.25)',
              lineHeight: 2,
              borderTop: '1px solid rgba(255,255,255,0.06)',
              paddingTop: 12,
            }}>
              <div>Importance: {selectedMemory.importance?.toFixed(3)}</div>
              <div>Strength: {((selectedMemory.decay_factor || 0) * 100).toFixed(1)}%</div>
              <div>Source: {selectedMemory.source}</div>
              <div>Created: {new Date(selectedMemory.created_at).toLocaleString()}</div>
              <div>Accessed: {selectedMemory.access_count}x</div>
              {selectedMemory.hash_id && <div>Hash: {selectedMemory.hash_id.slice(0, 16)}...</div>}
            </div>

            {/* On-chain link */}
            {selectedMemory.solana_signature && (
              <a
                href={`https://solscan.io/tx/${selectedMemory.solana_signature}`}
                target="_blank"
                rel="noopener"
                style={{
                  display: 'block',
                  marginTop: 12,
                  fontSize: 10,
                  color: '#2244ff',
                  letterSpacing: 0.5,
                }}
              >
                View on-chain proof ↗
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
