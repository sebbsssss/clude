import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuthContext } from '../hooks/AuthContext';
import { useChat } from '../hooks/useChat';
import { useConversations } from '../hooks/useConversations';
import { useMemory } from '../hooks/useMemory';
import { useBalance } from '../hooks/useBalance';
import { Sidebar } from './Sidebar';
import { ChatHeader } from './ChatHeader';
import { GuestRateLimit } from './GuestRateLimit';
import { CostComparison } from './CostComparison';
import { SettledBubble, StreamingBubble, TransactionHistory } from './MessageBubble';
import { InputArea } from './InputArea';
import { PromoSlideout } from './PromoSlideout';

export function ChatInterface() {
  const { authenticated } = useAuthContext();
  const {
    settled, streamingMsg, isStreaming, guestRemaining, balance, error,
    sendMessage, stopStreaming, clearMessages, loadMessages, prependMessages, fetchGreeting, scrollRef,
  } = useChat();
  const { balance: balanceInfo } = useBalance();
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
      try {
        const convId = await createConversation(model);
        isFirstResponseRef.current = true;
        pendingConvIdRef.current = convId;
        sendMessage(content, convId, model);
      } catch (err: any) {
        console.error('Failed to create conversation:', err);
      }
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

  const openComparison = useCallback(() => setShowCostModal(true), []);
  const openHistory = useCallback(() => setShowTransactions(true), []);
  const toggleMemoryPills = useCallback(() => setShowMemoryPills(v => !v), []);

  return (
    <div className="flex min-h-screen">
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
        />
      )}

      <div className={`flex flex-col min-h-screen items-center justify-center px-4 py-6 flex-1 transition-all duration-300 ${authenticated ? 'ml-[260px]' : 'ml-0'}`}>
        <div className="fixed top-0 right-0 z-50 p-4" style={{ left: authenticated ? 260 : 0 }}>
          <ChatHeader />
        </div>

        <div className="w-full max-w-2xl flex flex-col">
          {/* Messages Area */}
          <AnimatePresence>
            {hasMessages && (
              <motion.div
                ref={messagesContainerRef}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="overflow-y-auto mb-3 space-y-3 max-h-[60vh] pb-2 relative z-10"
              >
                {/* Sentinel for IntersectionObserver scroll-up */}
                <div ref={sentinelRef} className="h-px" />

                {(hasMoreMessages || loadingMore) && (
                  <div className="flex justify-center py-1">
                    <span className="text-[10px] text-zinc-600">
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
              </motion.div>
            )}
          </AnimatePresence>

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
                  <button className="ml-auto text-amber-300 hover:text-amber-200 text-[10px] font-medium underline underline-offset-2">
                    Top Up
                  </button>
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
          />
        </div>
      </div>

      <CostComparison open={showCostModal} onClose={() => setShowCostModal(false)} />
      <TransactionHistory open={showTransactions} onClose={() => setShowTransactions(false)} messages={settled} />
      {/* First-time promo slideout — shows once per device for signed-in users with an active promo */}
      <PromoSlideout show={authenticated && !!balanceInfo?.promo} />
    </div>
  );
}
