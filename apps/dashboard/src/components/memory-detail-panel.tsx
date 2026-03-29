import { useState } from 'react';
import type { MemoryLink } from '../types/memory';

interface GraphNode {
  id: number;
  type: string;
  summary: string;
  content: string;
  tags: string[];
  importance: number;
  decay: number;
  valence: number;
  accessCount: number;
  source: string;
  createdAt: string;
}

const TYPE_COLORS: Record<string, string> = {
  episodic: '#2244ff',
  semantic: '#10b981',
  procedural: '#f59e0b',
  self_model: '#8b5cf6',
};

const LINK_COLORS: Record<string, string> = {
  supports: '#10b981',
  contradicts: '#ef4444',
  elaborates: '#2244ff',
  causes: '#f59e0b',
  follows: '#06b6d4',
  relates: '#6b7280',
  resolves: '#8b5cf6',
  happens_before: '#a78bfa',
  happens_after: '#a78bfa',
  concurrent_with: '#ec4899',
};

interface Props {
  node: GraphNode | null;
  links: MemoryLink[];
  allNodes: Map<number, GraphNode>;
  onClose: () => void;
  onNavigate: (id: number) => void;
}

/** Split content into main text and original text */
function splitContent(content: string): { main: string; originalText: string | null } {
  const marker = '\n\nOriginal text:';
  const idx = content.indexOf(marker);
  if (idx === -1) return { main: content, originalText: null };
  return {
    main: content.slice(0, idx).trim(),
    originalText: content.slice(idx + marker.length).trim(),
  };
}

export function MemoryDetailPanel({ node, links, allNodes, onClose, onNavigate }: Props) {
  const [showOriginal, setShowOriginal] = useState(false);

  if (!node) return null;

  const { main, originalText } = splitContent(node.content);

  const nodeLinks = links.filter(l => l.source_id === node.id || l.target_id === node.id);
  const grouped = new Map<string, Array<{ id: number; summary: string; direction: string }>>();
  for (const link of nodeLinks) {
    const otherId = link.source_id === node.id ? link.target_id : link.source_id;
    const other = allNodes.get(otherId);
    if (!other) continue;
    const direction = link.source_id === node.id ? 'outgoing' : 'incoming';
    if (!grouped.has(link.link_type)) grouped.set(link.link_type, []);
    grouped.get(link.link_type)!.push({ id: otherId, summary: other.summary, direction });
  }

  return (
    <div style={{
      position: 'absolute',
      top: 16,
      right: 16,
      width: 340,
      maxHeight: 'calc(100% - 32px)',
      background: 'var(--bg-card)',
      border: '1px solid var(--border-strong)',
      borderRadius: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
      zIndex: 20,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'var(--mono)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{
            fontSize: 9,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            padding: '2px 8px',
            borderRadius: 3,
            background: `${TYPE_COLORS[node.type] || '#6b7280'}18`,
            color: TYPE_COLORS[node.type] || '#6b7280',
            fontWeight: 700,
          }}>
            {node.type}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'var(--hover-bg)',
              border: 'none',
              color: 'var(--text-faint)',
              cursor: 'pointer',
              fontSize: 11,
              width: 22,
              height: 22,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            x
          </button>
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', lineHeight: 1.5 }}>
          {node.summary.length > 150 ? node.summary.slice(0, 150) + '...' : node.summary}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {/* Main content (without original text) */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4 }}>
            Content
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {main}
          </div>
        </div>

        {/* Original text — collapsed by default */}
        {originalText && (
          <div style={{ marginBottom: 14 }}>
            <button
              onClick={() => setShowOriginal(!showOriginal)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--blue)',
                fontSize: 10,
                cursor: 'pointer',
                fontFamily: 'var(--mono)',
                padding: 0,
                letterSpacing: 0.3,
              }}
            >
              {showOriginal ? '- Hide original text' : '+ Show original text'}
            </button>
            {showOriginal && (
              <div style={{
                marginTop: 6,
                padding: '8px 10px',
                background: 'var(--hover-bg)',
                borderRadius: 6,
                fontSize: 10,
                color: 'var(--text-muted)',
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                maxHeight: 200,
                overflowY: 'auto',
              }}>
                {originalText}
              </div>
            )}
          </div>
        )}

        {/* Tags */}
        {node.tags.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4 }}>
              Tags
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {node.tags.map(tag => (
                <span key={tag} style={{
                  fontSize: 9,
                  padding: '1px 6px',
                  background: 'var(--hover-bg)',
                  borderRadius: 3,
                  color: 'var(--text-muted)',
                }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4 }}>
            Metadata
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px', fontSize: 10 }}>
            <div>
              <span style={{ color: 'var(--text-faint)' }}>Importance </span>
              <span style={{ color: 'var(--text)' }}>{(node.importance * 100).toFixed(0)}%</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-faint)' }}>Decay </span>
              <span style={{ color: 'var(--text)' }}>{(node.decay * 100).toFixed(0)}%</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-faint)' }}>Valence </span>
              <span style={{ color: node.valence > 0 ? '#10b981' : node.valence < 0 ? '#ef4444' : 'var(--text-faint)' }}>
                {node.valence > 0 ? '+' : ''}{node.valence.toFixed(2)}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--text-faint)' }}>Accessed </span>
              <span style={{ color: 'var(--text)' }}>{node.accessCount}x</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-faint)' }}>Source </span>
              <span style={{ color: 'var(--text)' }}>{node.source}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-faint)' }}>ID </span>
              <span style={{ color: 'var(--text)' }}>#{node.id}</span>
            </div>
          </div>
        </div>

        {/* Linked memories */}
        {grouped.size > 0 && (
          <div>
            <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }}>
              Linked Memories ({nodeLinks.length})
            </div>
            {Array.from(grouped.entries()).map(([linkType, items]) => (
              <div key={linkType} style={{ marginBottom: 8 }}>
                <div style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: LINK_COLORS[linkType] || '#6b7280',
                  marginBottom: 3,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}>
                  {linkType} ({items.length})
                </div>
                {items.map(item => (
                  <div
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    style={{
                      padding: '4px 8px',
                      background: 'var(--hover-bg)',
                      borderRadius: 4,
                      fontSize: 10,
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      marginBottom: 2,
                      lineHeight: 1.4,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover-bg-strong)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'var(--hover-bg)'; }}
                  >
                    <span style={{ color: 'var(--text-faint)', marginRight: 4 }}>
                      {item.direction === 'outgoing' ? '>' : '<'}
                    </span>
                    {item.summary.length > 80 ? item.summary.slice(0, 80) + '...' : item.summary}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '6px 14px',
        borderTop: '1px solid var(--border)',
        fontSize: 9,
        color: 'var(--text-faint)',
      }}>
        {new Date(node.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  );
}
