import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { api } from '../lib/api';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  memoryIds?: number[];
  streaming?: boolean;
  entities?: string[]; // entity filters active when this message was sent
}

interface Props {
  onHighlight: (ids: Set<number>) => void;
  onMemoryClick: (id: number) => void;
  onFocusNode: (id: number) => void;
  onEntityClick?: (entity: string) => void;
  activeEntity: string | null;
  onClearEntity: () => void;
  knownEntities: Set<string>;
}

export function ExploreChat({ onHighlight, onMemoryClick, onFocusNode, onEntityClick, activeEntity, onClearEntity, knownEntities }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');

  // Memoize entity regex — only rebuild when knownEntities changes, not on every render
  const entityRegex = useMemo(() => {
    if (knownEntities.size === 0) return null;
    const sorted = Array.from(knownEntities).sort((a, b) => b.length - a.length);
    const escaped = sorted.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`(\\b(?:${escaped.join('|')})\\b)`, 'gi');
  }, [knownEntities]);
  const [streaming, setStreaming] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const contentRef = useRef('');
  const rafRef = useRef<number>(0);
  const lastUpdateRef = useRef(0);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  // Expand when there are messages, collapse when cleared
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
      // Prepend entity perspective to the query
      const entityContext = activeEntity ? `[Perspective: viewing from ${activeEntity}'s point of view] ` : '';
      await api.exploreChat(
        entityContext + userMsg.content,
        history,
        (chunk) => {
          contentRef.current += chunk;

          // Throttle UI updates to ~15fps — no highlighting during stream
          const now = performance.now();
          if (now - lastUpdateRef.current < 66) return;
          lastUpdateRef.current = now;

          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(() => {
            // Strip MEMORY_IDS line from display during streaming
            const display = contentRef.current.replace(/\n?MEMORY_IDS:\s*\[[^\]]*\]?\s*$/, '');
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantId ? { ...m, content: display } : m,
              ),
            );
          });
        },
        () => {
          // recalled_ids received — don't highlight, wait for done
        },
        (data) => {
          // Cancel any pending RAF
          if (rafRef.current) cancelAnimationFrame(rafRef.current);

          const cleanContent = data.clean_content || contentRef.current.replace(/\n?MEMORY_IDS:\s*\[[^\]]*\]\s*$/, '').trim();

          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId
                ? { ...m, content: cleanContent, memoryIds: data.memory_ids, streaming: false }
                : m,
            ),
          );

          // Don't highlight on completion — only highlight when user clicks a mention
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
  }, [input, streaming, messages, onHighlight]);

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
    // During streaming: only highlight Memory #IDs (fast), skip entity matching
    const memParts = text.split(/(\[Memory #\d+\])/g);

    return memParts.map((part, i) => {
      const memMatch = part.match(/\[Memory #(\d+)\]/);
      if (memMatch) {
        const id = parseInt(memMatch[1]);
        return (
          <span
            key={`m${i}`}
            onClick={() => {
              // Highlight all mentioned IDs in this message (siblings glow dimmer), focus on clicked one
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

      // Skip entity highlighting during streaming for performance
      if (isStreaming || !entityRegex) return <span key={`t${i}`}>{part}</span>;

      // Settled message: highlight entities using memoized regex
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
      width: '100%',
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
      {/* Messages area — only when expanded */}
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
          {/* Clear button */}
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
                  <span style={{ color: 'rgba(255,255,255,0.8)', letterSpacing: 2, fontSize: 14 }}>
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

      {/* Active entity perspective */}
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

      {/* Input — floating centered pill */}
      <div style={{
        width: '100%',
        display: 'flex',
        gap: 0,
        background: 'var(--bg-card)',
        borderRadius: 14,
        border: '1px solid rgba(255,255,255,0.2)',
        overflow: 'hidden',
        boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
      }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={activeEntity ? `Ask from ${activeEntity}'s perspective...` : 'Ask about your memories...'}
          disabled={streaming}
          style={{
            flex: 1,
            padding: '12px 18px',
            fontSize: 12,
            fontFamily: 'var(--mono)',
            background: 'transparent',
            border: 'none',
            color: '#fff',
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
            color: streaming ? '#f87171' : !input.trim() ? 'rgba(255,255,255,0.35)' : '#4488ff',
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
