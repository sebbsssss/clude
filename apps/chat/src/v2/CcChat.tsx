import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthContext } from '../hooks/AuthContext';
import { useChat } from '../hooks/use-chat';
import { useConversations } from '../hooks/useConversations';
import { useMemory } from '../hooks/useMemory';
import { useIsMobile } from '../hooks/useIsMobile';
import { api } from '../lib/api';
import type { SettledMessage } from '../hooks/use-chat';
import { CcSidebar } from './CcSidebar';
import { CcTopbar } from './CcTopbar';
import { CcMessage, type V2Message } from './CcMessage';
import { CcComposer } from './CcComposer';
import { CcMemoryPanel } from './CcMemoryPanel';
import { CcMemoryPill } from './CcMemoryPill';
import { toV2Model } from './data';
import { MEMORY_COLORS, type V2Memory, type V2Model, type V2Theme, type V2Thread } from './types';

function threadGroupFor(updatedAt: string): V2Thread['group'] {
  const t = new Date(updatedAt).getTime();
  const now = Date.now();
  const age = now - t;
  const day = 24 * 60 * 60 * 1000;
  if (age < day) return 'today';
  if (age < 2 * day) return 'yesterday';
  if (age < 7 * day) return 'this_week';
  return 'older';
}

function metaFor(updatedAt: string): string {
  const t = new Date(updatedAt).getTime();
  const diffMin = Math.round((Date.now() - t) / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.round(diffH / 24);
  return `${diffD}d`;
}

function fmtTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diffMin = Math.round((Date.now() - t) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return new Date(iso).toLocaleDateString();
}

function toV2Memory(m: { id: number; memory_type: string; summary: string; importance?: number; created_at: string }): V2Memory {
  const type = (['episodic', 'semantic', 'procedural', 'self_model', 'introspective'].includes(m.memory_type)
    ? m.memory_type
    : 'semantic') as V2Memory['type'];
  return {
    id: m.id,
    type,
    content: m.summary,
    importance: m.importance ?? 0.5,
    decay: 1,
    timestamp: fmtTime(m.created_at),
    accessed: 0,
  };
}

function toV2Message(m: SettledMessage, recalledById: Map<number, V2Memory>): V2Message {
  const recalled = (m.memoryIds || [])
    .map((id) => recalledById.get(id))
    .filter((x): x is V2Memory => !!x);
  const cludeTokens = m.tokens ? m.tokens.prompt + m.tokens.completion : 0;
  return {
    id: m.id,
    role: m.role,
    time: fmtTime(new Date().toISOString()),
    content: m.content,
    model: m.model,
    tokens:
      m.frontier_tokens && m.frontier_tokens > cludeTokens
        ? {
            clude: cludeTokens,
            frontier: m.frontier_tokens,
            model: m.frontier_model || 'claude-opus-4.5',
          }
        : undefined,
    recalled,
  };
}

export function CcChat({
  theme,
  setTheme,
}: {
  theme: V2Theme;
  setTheme: (t: V2Theme) => void;
}) {
  const auth = useAuthContext();
  const {
    settled,
    streamingMsg,
    isStreaming,
    sendMessage,
    loadMessages,
  } = useChat();
  const {
    conversations,
    activeId,
    createConversation,
    selectConversation,
  } = useConversations();
  const memHook = useMemory();
  const isMobile = useIsMobile();

  // Real model catalog — fetched once on mount from /api/chat/models so the
  // picker only ever surfaces IDs the server accepts. Pulled via api.getModels()
  // which already caches results.
  const [models, setModels] = useState<V2Model[]>([]);
  const [model, setModel] = useState<string>('');
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [showCitations, setShowCitations] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getModels()
      .then((list) => {
        if (cancelled) return;
        const mapped = list.map(toV2Model);
        setModels(mapped);
        // Pick the server's default, or first free model, or first entry.
        const preferred =
          mapped.find((m) => m.default) || mapped.find((m) => m.free) || mapped[0];
        if (preferred) setModel(preferred.id);
      })
      .catch(() => {
        // Stay empty; picker renders nothing until server responds.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load messages for the active conversation (new or selected).
  const switchedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeId || switchedRef.current === activeId) return;
    switchedRef.current = activeId;
    selectConversation(activeId)
      .then(loadMessages)
      .catch(() => {});
  }, [activeId, selectConversation, loadMessages]);

  // Pull the active Solana wallet for profile display. Best-effort; silent on fail.
  useEffect(() => {
    if (auth.walletAddress) setWalletAddress(auth.walletAddress);
  }, [auth.walletAddress]);

  // Build the sidebar thread list from real conversations.
  const threads = useMemo<V2Thread[]>(() => {
    return conversations.map((c) => ({
      id: c.id,
      title: c.title || 'New conversation',
      group: threadGroupFor(c.updated_at),
      meta: metaFor(c.updated_at),
      active: c.id === activeId,
    }));
  }, [conversations, activeId]);

  // Map recent memories to the V2 shape so CcMessage/CcMemoryPanel can consume them.
  const recent = memHook.recent || [];
  const recentV2: V2Memory[] = useMemo(() => recent.map(toV2Memory), [recent]);
  const recentById = useMemo(() => {
    const map = new Map<number, V2Memory>();
    for (const m of recent) map.set(m.id, toV2Memory(m));
    return map;
  }, [recent]);

  // Messages: most recent assistant's memory_ids are "recalled this reply"; the rest are background.
  const v2Messages: V2Message[] = useMemo(
    () => settled.map((m) => toV2Message(m, recentById)),
    [settled, recentById],
  );

  const lastAssistantRecalledIds = useMemo(() => {
    for (let i = settled.length - 1; i >= 0; i--) {
      if (settled[i].role === 'assistant' && settled[i].memoryIds?.length) {
        return new Set(settled[i].memoryIds);
      }
    }
    return new Set<number>();
  }, [settled]);

  const recalledMemories = useMemo<V2Memory[]>(() => {
    const hits = recent.filter((m) => lastAssistantRecalledIds.has(m.id));
    if (hits.length > 0) return hits.map(toV2Memory);
    // Fallback while no assistant reply yet: show the newest few memories as "recalled".
    return recentV2.slice(0, Math.min(4, recentV2.length));
  }, [recent, lastAssistantRecalledIds, recentV2]);

  const backgroundMemories = useMemo<V2Memory[]>(() => {
    const recalledSet = new Set(recalledMemories.map((m) => m.id));
    return recentV2.filter((m) => !recalledSet.has(m.id));
  }, [recentV2, recalledMemories]);

  const savedTokToday = useMemo(() => {
    // Sum per-message savings across the visible thread as a proxy for "today".
    let total = 0;
    for (const m of settled) {
      if (m.role === 'assistant' && m.tokens && m.frontier_tokens) {
        const used = m.tokens.prompt + m.tokens.completion;
        total += Math.max(0, m.frontier_tokens - used);
      }
    }
    return total;
  }, [settled]);

  const handleSend = useCallback(
    async (text: string) => {
      if (isStreaming || !model) return;
      if (!activeId) {
        const promise = createConversation(model);
        await sendMessage(text, promise, model);
      } else {
        await sendMessage(text, activeId, model);
      }
    },
    [activeId, createConversation, sendMessage, model, isStreaming],
  );

  const handleNewChat = useCallback(async () => {
    if (!model) return;
    switchedRef.current = null;
    await createConversation(model);
  }, [createConversation, model]);

  const layout = isMobile ? 'sidebar-none' : 'sidebar-left';
  const showSidebar = !isMobile;

  const topbarTitle =
    conversations.find((c) => c.id === activeId)?.title || 'New conversation';
  const msgCount = settled.length + (streamingMsg ? 1 : 0);

  return (
    <div
      className={`cc-app cc-layout-${layout} ${isMobile ? 'cc-mobile' : ''}`}
      data-theme={theme}
      data-memory-panel={memoryOpen ? 'true' : 'false'}
      style={{
        gridTemplateColumns: isMobile ? '1fr' : '240px 1fr',
      }}
    >
      {showSidebar && (
        <CcSidebar
          user={{
            name: auth.walletAddress
              ? `${auth.walletAddress.slice(0, 4)}…${auth.walletAddress.slice(-4)}`
              : 'Guest',
            email: walletAddress || undefined,
          }}
          threads={threads}
          onNewChat={handleNewChat}
          onSelect={(id) => {
            switchedRef.current = null;
            selectConversation(id).then(loadMessages).catch(() => {});
          }}
          onLogout={() => auth.logout()}
        />
      )}

      <div className="cc-main">
        <CcTopbar
          title={topbarTitle}
          subtitle={`◉ Active · ${msgCount} message${msgCount === 1 ? '' : 's'}`}
          savedToday={savedTokToday}
          models={models}
          model={model}
          onModelChange={setModel}
          onToggleMemory={() => setMemoryOpen((v) => !v)}
          memoryOpen={memoryOpen}
          theme={theme}
          onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        />
        <div className="cc-scroll">
          <div className="cc-scroll__inner">
            <CcMemoryPill
              recalledCount={recalledMemories.length}
              onOpen={() => setMemoryOpen(true)}
            />
            {v2Messages.map((m) => (
              <CcMessage key={m.id} msg={m} showCitations={showCitations} />
            ))}
            {streamingMsg && (
              <CcMessage
                msg={{
                  id: streamingMsg.id,
                  role: 'assistant',
                  time: 'now',
                  content: streamingMsg.content || '…',
                  model,
                }}
                showCitations={false}
              />
            )}
          </div>
        </div>
        <CcComposer onSend={handleSend} disabled={isStreaming} />
      </div>

      {memoryOpen && (
        <>
          <div className="cc-memscrim" onClick={() => setMemoryOpen(false)} />
          <CcMemoryPanel
            recalled={recalledMemories}
            other={backgroundMemories}
            totals={{
              stored: memHook.stats?.total ?? recentV2.length,
              savedTokToday,
            }}
            onClose={() => setMemoryOpen(false)}
            showCitations={showCitations}
            onToggleCitations={setShowCitations}
          />
        </>
      )}
    </div>
  );
}

// Cosmetic references keep the tree-shaker quiet about presently-unused helpers.
void MEMORY_COLORS;
void api;
