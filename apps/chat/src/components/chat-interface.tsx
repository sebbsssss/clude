import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, BookmarkPlus } from 'lucide-react';
import { useAuthContext } from '../hooks/AuthContext';
import { useChat } from '../hooks/use-chat';
import { useConversations } from '../hooks/useConversations';
import { useMemory } from '../hooks/useMemory';
import { useBalance } from '../hooks/useBalance';
import { useIsMobile } from '../hooks/useIsMobile';
import { useBYOK } from '../hooks/use-byok';
import { Sidebar } from './Sidebar';
import { ChatHeader } from './ChatHeader';
import { GuestRateLimit } from './GuestRateLimit';
import { CostComparison } from './CostComparison';
import { SettledBubble, StreamingBubble, TransactionHistory } from './MessageBubble';
import { InputArea } from './InputArea';
import { PromoSlideout } from './PromoSlideout';
import { BYOKModal } from './byok-modal';
import { PersistentMemoryModal } from './PersistentMemoryModal';

export function ChatInterface() {
  const { authenticated } = useAuthContext();
  const {
    settled, streamingMsg, isStreaming, guestRemaining, balance, error,
    sendMessage, stopStreaming, clearMessages, loadMessages, prependMessages, fetchGreeting, scrollRef,
  } = useChat();
  const { balance: balanceInfo } = useBalance();
  const isMobile = useIsMobile();
  const byok = useBYOK();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [byokOpen, setBYOKOpen] = useState(false);
  const [persistentOpen, setPersistentOpen] = useState(false);
  const greetedRef = useRef(false);
  const {
    conversations, activeId, hasMoreMessages,
    createConversation, selectConversation, loadMoreMessages, deleteConversation, refreshTitle, setActiveId,
  } = useConversations();
  const { stats, recent, importPack } = useMemory();

  const [showMemoryPills, setShowMemoryPills] = useState(false);
  const [showCostModal, setShowCostModal] = useState(false);
  const [showTransactions, setShowTransactions] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isFirstResponseRef = useRef(false);
  const pendingConvIdRef = useRef<string | null>(null);

  // Wire up scroll function for the streaming RAF loop
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollRef.current = scrollToBottom;
  }, [scrollRef, scrollToBottom]);

  // Scroll when settled messages change (new message arrives, conversation loaded)
  useEffect(() => {
    scrollToBottom();
  }, [settled.length, scrollToBottom]);

  // Clear state on logout
  useEffect(() => {
    if (!authenticated) {
      clearMessages();
      greetedRef.current = false;
    }
  }, [authenticated, clearMessages]);

  // Fetch personalized greeting when user authenticates
  useEffect(() => {
    if (authenticated && !greetedRef.current && settled.length === 0 && !streamingMsg) {
      greetedRef.current = true;
      fetchGreeting();
    }
  }, [authenticated, settled.length, streamingMsg, fetchGreeting]);

  // After streaming ends, refresh title if this was the first message
  useEffect(() => {
    if (!isStreaming && isFirstResponseRef.current && pendingConvIdRef.current) {
      refreshTitle(pendingConvIdRef.current);
      isFirstResponseRef.current = false;
      pendingConvIdRef.current = null;
    }
  }, [isStreaming, refreshTitle]);

  // IntersectionObserver for scroll-up pagination
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    const container = messagesContainerRef.current;
    if (!el || !container || !hasMoreMessages || !activeId) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loadingMore) {
          setLoadingMore(true);
          const prevScrollHeight = container.scrollHeight;
          loadMoreMessages(activeId).then((older) => {
            if (older.length > 0) {
              prependMessages(older);
              requestAnimationFrame(() => {
                container.scrollTop = container.scrollHeight - prevScrollHeight;
              });
            }
          }).finally(() => setLoadingMore(false));
        }
      },
      { root: container, threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMoreMessages, activeId, loadingMore, loadMoreMessages, prependMessages]);

  const handleSend = useCallback(async (content: string, model: string) => {
    if (isStreaming) return;

    if (!authenticated) {
      sendMessage(content, null, model);
    } else if (!activeId) {
      // Optimistic create: start the message stream immediately with a promise for the ID
      const convPromise = createConversation(model).then((id) => {
        isFirstResponseRef.current = true;
        pendingConvIdRef.current = id;
        return id;
      }).catch((err) => {
        console.error('Failed to create conversation:', err);
        return null;
      });
      sendMessage(content, convPromise, model);
    } else {
      sendMessage(content, activeId, model);
    }
  }, [isStreaming, authenticated, activeId, sendMessage, createConversation]);

  const handleSelectConversation = useCallback(async (id: string) => {
    const msgs = await selectConversation(id);
    loadMessages(msgs);
  }, [selectConversation, loadMessages]);

  const handleNewChat = useCallback(() => {
    clearMessages();
    setActiveId(null);
  }, [clearMessages, setActiveId]);

  const hasMessages = settled.length > 0 || !!streamingMsg;
  const hasUserMessages = settled.some(m => m.role === 'user');

  const openComparison = useCallback(() => setShowCostModal(true), []);
  const openHistory = useCallback(() => setShowTransactions(true), []);
  const toggleMemoryPills = useCallback(() => setShowMemoryPills(v => !v), []);
  const openBYOK = useCallback(() => setBYOKOpen(true), []);

  const byokProviders = useMemo(
    () => new Set(byok.storedProviders),
    [byok.storedProviders],
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {authenticated && (
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          stats={stats}
          recentMemories={recent}
          onSelect={handleSelectConversation}
          onDelete={deleteConversation}
          onNewChat={handleNewChat}
          onImportPack={importPack}
          isMobile={isMobile}
          mobileOpen={sidebarOpen}
          onMobileClose={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <div
        className={`flex flex-col h-screen items-center px-4 pt-16 pb-6 flex-1 transition-all duration-300 ${!hasUserMessages ? 'justify-center' : ''} ${authenticated && !isMobile ? 'ml-[260px]' : 'ml-0'}`}
      >
        {/* Header */}
        <div className="fixed top-0 right-0 z-50 p-4 flex items-center gap-2" style={{ left: authenticated && !isMobile ? 260 : 0 }}>
          {isMobile && authenticated && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="text-zinc-500 hover:text-zinc-300 transition-colors p-2.5"
              title="Open sidebar"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
          {authenticated && (
            <button
              onClick={() => setPersistentOpen(true)}
              className="text-zinc-500 hover:text-violet-300 transition-colors p-2"
              title="Permanent preferences"
            >
              <BookmarkPlus className="h-4 w-4" />
            </button>
          )}
          <div className="flex-1">
            <ChatHeader />
          </div>
        </div>

        <div className={`w-full max-w-3xl flex flex-col ${hasUserMessages ? 'flex-1' : ''} min-h-0 ${isMobile ? 'px-1' : ''}`} style={isMobile ? { paddingBottom: 'env(safe-area-inset-bottom, 0px)' } : undefined}>
          {/* Messages Area */}
          {hasMessages && (
              <div
                ref={messagesContainerRef}
                className={`overflow-y-auto mb-3 space-y-3 ${hasUserMessages ? 'flex-1' : ''} min-h-0 pb-2 relative z-10`}
              >
                {/* Sentinel for IntersectionObserver scroll-up */}
                <div ref={sentinelRef} className="h-px" />

                {(hasMoreMessages || loadingMore) && (
                  <div className="flex justify-center py-1">
                    <span className="text-[12px] text-zinc-500">
                      {loadingMore ? 'Loading…' : 'Scroll up for older messages'}
                    </span>
                  </div>
                )}

                {/* Settled messages — plain divs, CSS avatars, React.memo */}
                {settled.map((message) => (
                  <SettledBubble
                    key={message.id}
                    message={message}
                    showMemoryPills={showMemoryPills}
                    onOpenComparison={openComparison}
                    onOpenHistory={openHistory}
                  />
                ))}

                {/* Streaming message — motion.div, LiquidMetal, raw text */}
                {streamingMsg && (
                  <StreamingBubble key={streamingMsg.id} message={streamingMsg} />
                )}

                {/* Error display */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex justify-center"
                  >
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-400 text-xs">
                      {error}
                    </div>
                  </motion.div>
                )}

                <div ref={messagesEndRef} />
              </div>
          )}

          {/* Guest rate limit banner */}
          <GuestRateLimit remaining={guestRemaining} />

          {/* Low balance warning */}
          <AnimatePresence>
            {balance !== null && balance > 0 && balance < 0.5 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-2"
              >
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-amber-400 text-xs flex items-center gap-2">
                  <span>Low balance: ${balance.toFixed(2)} remaining</span>
                  <span className="ml-auto text-zinc-400 text-[12px] font-medium">
                    Top up coming soon
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input area (owns its own focus/input/model state) */}
          <InputArea
            isStreaming={isStreaming}
            balance={balance}
            hasMessages={hasMessages}
            showMemoryPills={showMemoryPills}
            onToggleMemoryPills={toggleMemoryPills}
            onSend={handleSend}
            onStop={stopStreaming}
            byokProviders={byokProviders}
            onOpenBYOK={openBYOK}
          />
        </div>
      </div>

      <CostComparison open={showCostModal} onClose={() => setShowCostModal(false)} />
      <TransactionHistory open={showTransactions} onClose={() => setShowTransactions(false)} messages={settled} />
      <BYOKModal
        open={byokOpen}
        onClose={() => setBYOKOpen(false)}
        keys={byok.keys}
        loading={byok.loading}
        onSave={byok.saveKey}
        onRemove={byok.removeKey}
      />
      <PersistentMemoryModal
        open={persistentOpen}
        onClose={() => setPersistentOpen(false)}
      />
      {/* First-time promo slideout — shows once per device for signed-in users with an active promo */}
      <PromoSlideout show={authenticated && !!balanceInfo?.promo} />
    </div>
  );
}
