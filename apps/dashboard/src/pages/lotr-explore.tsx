/**
 * LOTR Guest Brain Page — self-contained, no auth required.
 * Campaign/temporary — delete this file when the campaign ends.
 *
 * Reuses MemoryGraph3D and MemoryDetailPanel (pure presentational).
 * Contains its own chat component to avoid editing the permanent ExploreChat.
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { MemoryGraph3D } from '../components/memory-graph-3d';
import { MemoryDetailPanel } from '../components/memory-detail-panel';
import { lotrApi } from '../lib/lotr-api';

// ── Inline data fetching (replaces useExploreData) ──

function useLotrData() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await lotrApi.getMemoryGraph();
        if (!cancelled) {
          setNodes(result.nodes);
          setLinks(result.links);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load graph');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { nodes, links, loading, error };
}

// ── Inline chat component (copy of ExploreChat, calls lotrApi) ──

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  memoryIds?: number[];
  streaming?: boolean;
  entities?: string[];
}

function LotrExploreChat({
  onHighlight,
  onMemoryClick,
  onFocusNode,
  onEntityClick,
  activeEntity,
  onClearEntity,
  knownEntities,
}: {
  onHighlight: (ids: Set<number>) => void;
  onMemoryClick: (id: number) => void;
  onFocusNode: (id: number) => void;
  onEntityClick?: (entity: string) => void;
  activeEntity: string | null;
  onClearEntity: () => void;
  knownEntities: Set<string>;
}) {
  const STORAGE_KEY = 'lotr-chat-history';
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [input, setInput] = useState('');

  // Persist non-streaming messages to localStorage
  useEffect(() => {
    const settled = messages.filter(m => !m.streaming);
    if (settled.length > 0) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settled)); } catch { /* full */ }
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [messages]);

  const entityRegex = useMemo(() => {
    if (knownEntities.size === 0) return null;
    const sorted = Array.from(knownEntities).sort((a, b) => b.length - a.length);
    const escaped = sorted.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`(\\b(?:${escaped.join('|')})\\b)`, 'gi');
  }, [knownEntities]);

  const [streaming, setStreaming] = useState(false);
  const [expanded, setExpanded] = useState(messages.length > 0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const contentRef = useRef('');
  const rafRef = useRef<number>(0);
  const lastUpdateRef = useRef(0);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);
  useEffect(() => {
    if (messages.length > 0) setExpanded(true);
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || streaming) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      entities: activeEntity ? [activeEntity] : undefined,
    };

    const assistantId = `assistant-${Date.now()}`;
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      streaming: true,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setStreaming(true);
    contentRef.current = '';
    const abort = new AbortController();
    abortRef.current = abort;

    const history = messages.map(m => ({ role: m.role, content: m.content }));

    try {
      const entityContext = activeEntity ? `[Perspective: viewing from ${activeEntity}'s point of view] ` : '';
      await lotrApi.exploreChat(
        entityContext + userMsg.content,
        history,
        (chunk) => {
          contentRef.current += chunk;
          const now = performance.now();
          if (now - lastUpdateRef.current < 66) return;
          lastUpdateRef.current = now;

          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(() => {
            const display = contentRef.current.replace(/\n?MEMORY_IDS:\s*\[[^\]]*\]?\s*$/, '');
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantId ? { ...m, content: display } : m,
              ),
            );
          });
        },
        () => { /* recalled_ids — wait for done */ },
        (data) => {
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          const cleanContent = data.clean_content || contentRef.current.replace(/\n?MEMORY_IDS:\s*\[[^\]]*\]\s*$/, '').trim();
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId
                ? { ...m, content: cleanContent, memoryIds: data.memory_ids, streaming: false }
                : m,
            ),
          );
        },
        abort.signal,
      );
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? { ...m, content: contentRef.current || `Error: ${err.message}`, streaming: false }
              : m,
          ),
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, streaming, messages, activeEntity]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    setMessages([]);
    setExpanded(false);
    onHighlight(new Set());
    contentRef.current = '';
  };

  const renderContent = (text: string, isStreaming?: boolean, allMentionedIds?: number[]) => {
    const memParts = text.split(/(\[Memory #\d+\])/g);

    return memParts.map((part, i) => {
      const memMatch = part.match(/\[Memory #(\d+)\]/);
      if (memMatch) {
        const id = parseInt(memMatch[1]);
        return (
          <span
            key={`m${i}`}
            onClick={() => {
              if (allMentionedIds && allMentionedIds.length > 0) {
                onHighlight(new Set(allMentionedIds));
              }
              onMemoryClick(id);
              onFocusNode(id);
            }}
            style={{
              display: 'inline-block',
              padding: '0px 5px',
              margin: '0 2px',
              fontSize: 9,
              fontWeight: 700,
              background: 'var(--blue-light)',
              color: 'var(--blue)',
              borderRadius: 3,
              cursor: 'pointer',
              border: '1px solid var(--blue-light)',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.7'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
          >
            #{id}
          </span>
        );
      }

      if (isStreaming || !entityRegex) return <span key={`t${i}`}>{part}</span>;

      const entityParts = part.split(entityRegex);
      return entityParts.map((ep, j) => {
        const isEntity = knownEntities.has(ep) ||
          Array.from(knownEntities).some(e => e.toLowerCase() === ep.toLowerCase());
        if (isEntity) {
          return (
            <span
              key={`e${i}-${j}`}
              onClick={() => onEntityClick?.(ep)}
              style={{
                display: 'inline',
                padding: '0px 3px',
                margin: '0 1px',
                fontSize: 'inherit',
                fontWeight: 600,
                background: 'rgba(16, 185, 129, 0.1)',
                color: '#10b981',
                borderRadius: 2,
                cursor: onEntityClick ? 'pointer' : 'default',
              }}
            >
              {ep}
            </span>
          );
        }
        return <span key={`p${i}-${j}`}>{ep}</span>;
      });
    });
  };

  return (
    <div style={{
      position: 'absolute',
      bottom: 24,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 20,
      width: 'calc(100% - 32px)',
      maxWidth: 800,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
    }}>
      <style>{`
        @keyframes dotPulse {
          0%, 60%, 100% { opacity: 0.2; transform: scale(1); }
          30% { opacity: 1; transform: scale(1.3); }
        }
      `}</style>

      {expanded && messages.length > 0 && (
        <div style={{
          width: '100%',
          maxHeight: 280,
          overflowY: 'auto',
          marginBottom: 8,
          padding: '8px 12px',
          background: 'var(--bg-card)',
          borderRadius: 12,
          border: '1px solid var(--border-strong)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={handleClear}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-faint)',
                fontSize: 9,
                cursor: 'pointer',
                fontFamily: 'var(--mono)',
                letterSpacing: 0.5,
              }}
            >
              Clear
            </button>
          </div>
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '90%',
              }}
            >
              <div style={{
                padding: '6px 10px',
                borderRadius: msg.role === 'user' ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
                background: msg.role === 'user'
                  ? 'var(--blue-light)'
                  : 'var(--hover-bg)',
                border: `1px solid ${msg.role === 'user' ? 'var(--blue-light)' : 'var(--border)'}`,
                fontSize: 11,
                lineHeight: 1.5,
                color: 'var(--text)',
                fontFamily: 'var(--mono)',
                whiteSpace: 'pre-wrap',
              }}>
                {msg.role === 'user' && msg.entities && msg.entities.length > 0 && (
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 4 }}>
                    {msg.entities.map(e => (
                      <span key={e} style={{
                        fontSize: 9, padding: '1px 6px', fontWeight: 600,
                        background: 'rgba(16, 185, 129, 0.15)', color: '#10b981',
                        borderRadius: 8, border: '1px solid rgba(16, 185, 129, 0.25)',
                      }}>{e}</span>
                    ))}
                  </div>
                )}
                {msg.role === 'assistant' ? renderContent(msg.content, msg.streaming, msg.memoryIds) : msg.content}
                {msg.streaming && !msg.content && (
                  <span style={{ color: 'var(--text-muted)', letterSpacing: 2, fontSize: 14 }}>
                    <span style={{ animation: 'dotPulse 1.4s infinite', animationDelay: '0s' }}>.</span>
                    <span style={{ animation: 'dotPulse 1.4s infinite', animationDelay: '0.2s' }}>.</span>
                    <span style={{ animation: 'dotPulse 1.4s infinite', animationDelay: '0.4s' }}>.</span>
                  </span>
                )}
                {msg.streaming && msg.content && <span style={{ opacity: 0.3 }}>|</span>}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {activeEntity && (
        <div style={{
          width: '100%',
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          marginBottom: 6,
          paddingLeft: 4,
        }}>
          <span
            onClick={onClearEntity}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 10px',
              fontSize: 10,
              fontFamily: 'var(--mono)',
              fontWeight: 600,
              background: 'rgba(16, 185, 129, 0.12)',
              color: '#10b981',
              borderRadius: 10,
              cursor: 'pointer',
              border: '1px solid rgba(16, 185, 129, 0.25)',
            }}
          >
            {activeEntity}
            <span style={{ fontSize: 8, opacity: 0.6 }}>x</span>
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>
            viewing from this perspective
          </span>
        </div>
      )}

      <div style={{
        width: '100%',
        display: 'flex',
        gap: 0,
        background: 'var(--bg-card)',
        borderRadius: 14,
        border: '1px solid var(--border)',
        overflow: 'hidden',
        boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
      }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={activeEntity ? `Ask from ${activeEntity}'s perspective...` : 'Ask about Lord of the Rings...'}
          disabled={streaming}
          style={{
            flex: 1,
            padding: '12px 18px',
            fontSize: 12,
            fontFamily: 'var(--mono)',
            background: 'transparent',
            border: 'none',
            color: 'var(--text)',
            outline: 'none',
          }}
        />
        <button
          onClick={streaming ? () => abortRef.current?.abort() : handleSend}
          disabled={!streaming && !input.trim()}
          style={{
            padding: '12px 18px',
            fontSize: 10,
            fontFamily: 'var(--mono)',
            fontWeight: 700,
            letterSpacing: 1,
            textTransform: 'uppercase',
            background: 'transparent',
            color: streaming ? '#f87171' : !input.trim() ? 'var(--text-faint)' : '#4488ff',
            border: 'none',
            borderLeft: '1px solid var(--border)',
            cursor: !streaming && !input.trim() ? 'default' : 'pointer',
          }}
        >
          {streaming ? 'Stop' : 'Send'}
        </button>
      </div>
    </div>
  );
}

// ── Main page component ──

export function LotrExplore() {
  // Force dark mode — 3D graph needs dark background
  useEffect(() => {
    document.documentElement.classList.add('dark');
    return () => { document.documentElement.classList.remove('dark'); };
  }, []);

  const { nodes, links, loading, error } = useLotrData();

  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [highlightedIds, setHighlightedIds] = useState<Set<number>>(new Set());
  const [focusNodeId, setFocusNodeId] = useState<number | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSelectedNode(null); setHighlightedIds(new Set()); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const nodeMap = useMemo(() => {
    const map = new Map<number, any>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  const knownEntities = useMemo(() => {
    const entities = new Set<string>();
    for (const n of nodes) {
      for (const tag of n.tags) {
        if (tag.startsWith('entity:')) {
          const name = tag.slice(7);
          if (name.length > 1) entities.add(name);
        }
      }
    }
    return entities;
  }, [nodes]);

  const handleNavigate = useCallback((id: number) => {
    const node = nodeMap.get(id);
    if (node) setSelectedNode(node);
  }, [nodeMap]);

  const [activeEntity, setActiveEntity] = useState<string | null>(null);

  const handleEntityClick = useCallback((entity: string) => {
    setActiveEntity(prev => prev === entity ? null : entity);
  }, []);

  const handleMemoryClick = useCallback((id: number) => {
    const node = nodeMap.get(id);
    if (node) setSelectedNode(node);
  }, [nodeMap]);

  const handleBackgroundClick = useCallback(() => { setSelectedNode(null); setHighlightedIds(new Set()); }, []);
  const handleClearEntity = useCallback(() => setActiveEntity(null), []);
  const handleFocusNode = useCallback((id: number) => {
    setFocusNodeId(id);
    setTimeout(() => setFocusNodeId(null), 100);
  }, []);

  return (
    <div style={{
      height: '100vh',
      width: '100vw',
      position: 'relative',
      overflow: 'hidden',
      background: 'var(--bg)',
    }}>
      {/* Header badge */}
      <div style={{
        position: 'absolute',
        top: 16,
        left: 20,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{
          fontSize: 11,
          fontFamily: 'var(--mono)',
          fontWeight: 700,
          letterSpacing: 1,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
        }}>
          Lord of the Rings
        </span>
        <span style={{
          fontSize: 9,
          fontFamily: 'var(--mono)',
          padding: '2px 8px',
          background: 'var(--blue-light)',
          color: 'var(--blue)',
          borderRadius: 6,
          fontWeight: 600,
        }}>
          Memory Library
        </span>
      </div>

      {loading && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', letterSpacing: 1 }}>
            Loading memory graph...
          </div>
        </div>
      )}

      {error && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10,
          textAlign: 'center',
          color: '#ef4444',
          fontSize: 11,
        }}>
          {error}
        </div>
      )}

      {!loading && (
        <MemoryGraph3D
          nodes={nodes}
          highlightedIds={highlightedIds}
          selectedId={selectedNode?.id || null}
          focusNodeId={focusNodeId}
          onNodeClick={setSelectedNode}
          onBackgroundClick={handleBackgroundClick}
        />
      )}

      <LotrExploreChat
        onHighlight={setHighlightedIds}
        onMemoryClick={handleMemoryClick}
        onFocusNode={handleFocusNode}
        onEntityClick={handleEntityClick}
        activeEntity={activeEntity}
        onClearEntity={handleClearEntity}
        knownEntities={knownEntities}
      />

      <MemoryDetailPanel
        node={selectedNode}
        links={links}
        allNodes={nodeMap}
        onClose={() => setSelectedNode(null)}
        onNavigate={handleNavigate}
      />
    </div>
  );
}
