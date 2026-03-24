import { Button } from "./ui/button.tsx"
import { Textarea } from "./ui/textarea.tsx"
import { Brain, Send, Square, ChevronDown, X, Clock } from "lucide-react"
import { LiquidMetal, PulsingBorder } from "@paper-design/shaders-react"
import { motion, AnimatePresence } from "framer-motion"
import { useState, useRef, useEffect, useCallback } from "react"
import { useAuthContext } from "../hooks/AuthContext"
import { useChat, type ChatMessage, type MessageTokens, type GreetingMeta } from "../hooks/useChat"
import { useConversations } from "../hooks/useConversations"
import { useMemory } from "../hooks/useMemory"
import { Sidebar } from "./Sidebar"
import { ModelSelector } from "./ModelSelector"
import { ChatHeader } from "./ChatHeader"
import { GuestRateLimit } from "./GuestRateLimit"
import { MemoryPills } from "./MemoryPills"
import { CostComparison } from "./CostComparison"
import { Markdown } from "./Markdown"

const MODEL_STORAGE_KEY = "chat_selected_model"

function GreetingMetaBar({ meta }: { meta: GreetingMeta }) {
  const spanLabel = meta.temporal_span
    ? meta.temporal_span.weeks <= 1
      ? 'this week'
      : meta.temporal_span.weeks < 52
        ? `${meta.temporal_span.weeks}w`
        : `since ${meta.temporal_span.since_label}`
    : null

  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {/* Memory count */}
      <span className="inline-flex items-center gap-1 text-[10px] text-blue-400/70 bg-blue-500/8 border border-blue-500/15 rounded-full px-2 py-0.5">
        <span className="text-blue-300/50">◆</span>
        {meta.total_memories.toLocaleString()} memories
        {spanLabel && <span className="text-blue-400/40">· {spanLabel}</span>}
      </span>
      {/* Topics */}
      {meta.topics.slice(0, 4).map((topic) => (
        <span
          key={topic}
          className="inline-flex items-center text-[10px] text-zinc-400/60 bg-zinc-800/60 border border-zinc-700/40 rounded-full px-2 py-0.5"
        >
          {topic}
        </span>
      ))}
      {/* Cost savings */}
      <span className="inline-flex items-center gap-1 text-[10px] text-green-400/60 bg-green-500/5 border border-green-500/15 rounded-full px-2 py-0.5">
        <span className="text-green-400/40">$0</span>
        <span className="text-zinc-600">· GPT-4o ~$0.05</span>
      </span>
    </div>
  )
}

function TransactionHistory({ open, onClose, messages }: { open: boolean; onClose: () => void; messages: ChatMessage[] }) {
  // Derive transaction list from messages with cost data (real-time session view)
  // Phase 1 will add persistent transaction history from chat_usage table
  const transactions = messages
    .filter(m => m.role === 'assistant' && m.cost && m.cost.total > 0)
    .reverse();

  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[360px] max-h-[70vh] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 p-5 flex flex-col"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-sm text-white font-medium">
                <Clock className="h-4 w-4 text-blue-400" /> Transaction History
              </div>
              <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 space-y-1">
              {transactions.length === 0 ? (
                <div className="text-zinc-500 text-xs text-center py-8">
                  No paid messages yet this session.
                  <br />
                  <span className="text-zinc-600 text-[10px]">Free model messages don't appear here.</span>
                </div>
              ) : (
                transactions.map((msg, i) => (
                  <div key={msg.id} className="flex items-center justify-between text-[11px] py-1.5 px-2 rounded hover:bg-zinc-800/50">
                    <div className="flex-1 min-w-0">
                      <span className="text-zinc-300 truncate block">{msg.model || 'unknown'}</span>
                      <span className="text-zinc-600 text-[9px]">
                        {msg.tokens ? `${msg.tokens.prompt.toLocaleString()} + ${msg.tokens.completion.toLocaleString()} tokens` : '—'}
                      </span>
                    </div>
                    <span className="text-green-400/80 font-mono text-[10px] ml-2 shrink-0">
                      ${msg.cost!.total < 0.001 ? msg.cost!.total.toFixed(5) : msg.cost!.total.toFixed(4)}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="mt-3 pt-3 border-t border-zinc-800">
              <div className="text-[10px] text-zinc-600">
                Session usage only. Full history will be available once balance system is live.
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function formatCost(v: number): string {
  if (v === 0) return 'Free';
  return v < 0.001 ? `$${v.toFixed(5)}` : `$${v.toFixed(4)}`;
}

function ReceiptBadge({ message, onOpenComparison, onOpenHistory }: { message: ChatMessage; onOpenComparison: () => void; onOpenHistory: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const cost = message.cost!;
  const receipt = message.receipt;
  const tokens = message.tokens;

  // Compute equivalent Opus cost from tokens (fallback when receipt isn't in stream)
  const opusCost = receipt?.equivalent_direct_cost ?? (tokens
    ? (tokens.prompt / 1_000_000) * 15 + (tokens.completion / 1_000_000) * 75
    : 0);
  const savingsPct = receipt?.savings_pct ?? (opusCost > 0
    ? Math.round(((opusCost - cost.total) / opusCost) * 100)
    : 0);

  const collapsedLabel = cost.total === 0
    ? `◆ Free · ${formatCost(opusCost)} on Opus`
    : `◆ ${formatCost(cost.total)} · ${savingsPct}% saved`;

  return (
    <div className="mt-0.5">
      {/* Collapsed badge */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1 group"
      >
        <span className="text-[10px] text-white/25 group-hover:text-white/40 transition-colors whitespace-nowrap">
          {collapsedLabel}
        </span>
        <ChevronDown className={`w-2.5 h-2.5 text-white/15 group-hover:text-white/40 transition-all shrink-0 ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* Expanded receipt */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 mt-1 text-[10px] space-y-1.5">
              {/* Cost line */}
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Cost</span>
                <span className="text-green-400 font-medium font-mono">{formatCost(cost.total)}</span>
              </div>

              {/* Equivalent direct API cost */}
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Direct API (Opus)</span>
                <span className="text-red-400/80 font-mono">{formatCost(opusCost)}</span>
              </div>

              {/* Savings */}
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">You saved</span>
                <span className="text-green-400 font-medium">{savingsPct}%</span>
              </div>

              {/* Token breakdown */}
              {tokens && (
                <div className="flex items-center justify-between pt-1 border-t border-zinc-700/50">
                  <span className="text-zinc-600">Tokens</span>
                  <span className="text-zinc-500 font-mono">
                    {tokens.prompt.toLocaleString()} in · {tokens.completion.toLocaleString()} out
                  </span>
                </div>
              )}

              {/* Balance (stub for Phase 1) */}
              {receipt?.remaining_balance !== null && receipt?.remaining_balance !== undefined && (
                <div className="flex items-center justify-between pt-1 border-t border-zinc-700/50">
                  <span className="text-zinc-500">Balance</span>
                  <span className="text-zinc-300 font-mono">${receipt.remaining_balance.toFixed(2)}</span>
                </div>
              )}

              {/* Links */}
              <div className="flex items-center gap-3 pt-0.5">
                <button
                  onClick={(e) => { e.stopPropagation(); onOpenComparison(); }}
                  className="text-[9px] text-blue-400/60 hover:text-blue-400 transition-colors"
                >
                  Model comparison →
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onOpenHistory(); }}
                  className="text-[9px] text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  History →
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ChatInterface() {
  const { authenticated } = useAuthContext()
  const { messages, streaming, guestRemaining, balance, error, sendMessage, stopStreaming, clearMessages, loadMessages, prependMessages, fetchGreeting } = useChat()
  const greetedRef = useRef(false)
  const { conversations, activeId, hasMoreMessages, createConversation, selectConversation, loadMoreMessages, deleteConversation, refreshTitle, setActiveId } = useConversations()
  const { stats, recent, importPack } = useMemory()

  const [isFocused, setIsFocused] = useState(false)
  const [inputValue, setInputValue] = useState("")
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem(MODEL_STORAGE_KEY) || "kimi-k2-thinking")
  const [showMemoryPills, setShowMemoryPills] = useState(false)
  const [showCostModal, setShowCostModal] = useState(false)
  const [showTransactions, setShowTransactions] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const isFirstResponseRef = useRef(false)
  const pendingConvIdRef = useRef<string | null>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Clear state on logout — reset messages, model, greeting flag
  useEffect(() => {
    if (!authenticated) {
      clearMessages()
      greetedRef.current = false
      setSelectedModel("kimi-k2-thinking")
    }
  }, [authenticated, clearMessages])

  // Fetch personalized greeting when user authenticates
  useEffect(() => {
    if (authenticated && !greetedRef.current && messages.length === 0) {
      greetedRef.current = true
      fetchGreeting()
    }
  }, [authenticated, messages.length, fetchGreeting])

  // After streaming ends, refresh title if this was the first message in a new conversation
  useEffect(() => {
    if (!streaming && isFirstResponseRef.current && pendingConvIdRef.current) {
      refreshTitle(pendingConvIdRef.current)
      isFirstResponseRef.current = false
      pendingConvIdRef.current = null
    }
  }, [streaming, refreshTitle])

  // Scroll-up to load older messages
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const handleScroll = async () => {
      if (container.scrollTop > 0 || !hasMoreMessages || loadingMore || !activeId) return
      setLoadingMore(true)
      const prevScrollHeight = container.scrollHeight
      try {
        const older = await loadMoreMessages(activeId)
        if (older.length > 0) {
          prependMessages(older)
          // Restore scroll position so the view doesn't jump to top
          requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight - prevScrollHeight
          })
        }
      } finally {
        setLoadingMore(false)
      }
    }
    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [hasMoreMessages, loadingMore, activeId, loadMoreMessages, prependMessages])

  const handleModelChange = useCallback((model: string) => {
    setSelectedModel(model)
    localStorage.setItem(MODEL_STORAGE_KEY, model)
  }, [])

  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || streaming) return
    const content = inputValue.trim()
    setInputValue("")

    if (!authenticated) {
      // Guest mode
      sendMessage(content, null, selectedModel)
    } else if (!activeId) {
      // Auth, no active conversation — create one first
      try {
        const convId = await createConversation(selectedModel)
        isFirstResponseRef.current = true
        pendingConvIdRef.current = convId
        sendMessage(content, convId, selectedModel)
      } catch (err: any) {
        console.error('Failed to create conversation:', err)
        setInputValue(content) // Restore input so user doesn't lose their message
      }
    } else {
      // Auth, existing conversation
      sendMessage(content, activeId, selectedModel)
    }
  }, [inputValue, streaming, authenticated, activeId, selectedModel, sendMessage, createConversation])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSelectConversation = useCallback(async (id: string) => {
    const msgs = await selectConversation(id)
    loadMessages(msgs)
  }, [selectConversation, loadMessages])

  const handleNewChat = useCallback(() => {
    clearMessages()
    setActiveId(null)
  }, [clearMessages, setActiveId])

  const hasMessages = messages.length > 0

  // Shared LiquidMetal props for avatar
  const avatarShaderProps = (size: number, streaming: boolean) => ({
    colorBack: "hsl(0, 0%, 0%, 0)" as const,
    colorTint: "hsl(220, 100%, 45%)" as const,
    repetition: 4,
    softness: 0.5,
    shiftRed: 0.05,
    shiftBlue: 0.6,
    distortion: 0.1,
    contour: 1,
    shape: "circle" as const,
    offsetX: 0,
    offsetY: 0,
    scale: 0.58,
    rotation: 50,
    speed: streaming ? 8 : 5,
  })

  const renderAvatar = (isStreaming: boolean, size: number = 24) => {
    const blurSize = size === 24 ? 5 : 10
    const innerSize = size === 24 ? 20 : 32
    const dotSize = size === 24 ? "1px" : "1.5px"
    return (
      <div className="relative flex items-center justify-center flex-shrink-0 mt-0.5" style={{ width: size, height: size }}>
        <div
          className="z-10 absolute bg-white/5 rounded-full backdrop-blur-[2px]"
          style={{
            height: innerSize,
            width: innerSize,
            backdropFilter: size > 24 ? "blur(3px)" : "blur(2px)",
          }}
        >
          {size > 24 ? (
            <>
              <div className="h-[1.5px] w-[1.5px] bg-white rounded-full absolute top-3 left-3 blur-[0.8px]" />
              <div className="h-[1.5px] w-[1.5px] bg-white rounded-full absolute top-2 left-5 blur-[0.6px]" />
              <div className="h-[1.5px] w-[1.5px] bg-white rounded-full absolute top-6 left-1.5 blur-[0.8px]" />
              <div className="h-[1.5px] w-[1.5px] bg-white rounded-full absolute top-4 left-6.5 blur-[0.6px]" />
              <div className="h-[1.5px] w-[1.5px] bg-white rounded-full absolute top-5.5 left-5 blur-[0.8px]" />
            </>
          ) : (
            <>
              <div style={{ height: dotSize, width: dotSize }} className="bg-white rounded-full absolute top-1.5 left-1.5 blur-[0.5px]" />
              <div style={{ height: dotSize, width: dotSize }} className="bg-white rounded-full absolute top-1 left-3 blur-[0.4px]" />
              <div style={{ height: dotSize, width: dotSize }} className="bg-white rounded-full absolute top-3 left-1 blur-[0.5px]" />
            </>
          )}
        </div>
        <LiquidMetal
          style={{ height: size, width: size, filter: `blur(${blurSize}px)`, position: "absolute" }}
          {...avatarShaderProps(size, isStreaming)}
        />
        <LiquidMetal
          style={{ height: size, width: size }}
          {...avatarShaderProps(size, isStreaming)}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar — only when authenticated */}
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

      {/* Main content */}
      <div
        className={`flex flex-col min-h-screen items-center justify-center px-4 py-6 flex-1 transition-all duration-300 ${authenticated ? "ml-[260px]" : "ml-0"}`}
      >
        {/* Header */}
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
                animate={{ opacity: 1, height: "auto" }}
                className="overflow-y-auto mb-3 space-y-3 max-h-[60vh] pb-2 relative z-10"
              >
                {(hasMoreMessages || loadingMore) && (
                  <div className="flex justify-center py-1">
                    <span className="text-[10px] text-zinc-600">
                      {loadingMore ? 'Loading…' : 'Scroll up for older messages'}
                    </span>
                  </div>
                )}
                {messages.map((message: ChatMessage) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {message.role === "assistant" && (
                      <div className="flex items-start gap-2">
                        {renderAvatar(!!message.streaming)}
                        <div className="flex flex-col gap-1 max-w-[80%]">
                          <div className="bg-zinc-900/80 border border-blue-500/20 rounded-xl rounded-tl-sm px-3 py-2">
                            {message.content ? (
                              <Markdown content={message.content} />
                            ) : (
                              !message.streaming && <p className="text-white/90 text-[13px]">Failed to get response</p>
                            )}
                            {message.streaming && !message.content && (
                              <div className="flex gap-1">
                                <motion.div
                                  className="w-1.5 h-1.5 bg-blue-500/60 rounded-full"
                                  animate={{ opacity: [0.4, 1, 0.4] }}
                                  transition={{ duration: 1, repeat: Infinity, delay: 0 }}
                                />
                                <motion.div
                                  className="w-1.5 h-1.5 bg-blue-500/60 rounded-full"
                                  animate={{ opacity: [0.4, 1, 0.4] }}
                                  transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
                                />
                                <motion.div
                                  className="w-1.5 h-1.5 bg-blue-500/60 rounded-full"
                                  animate={{ opacity: [0.4, 1, 0.4] }}
                                  transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
                                />
                              </div>
                            )}
                          </div>
                          <MemoryPills memoryIds={message.memoryIds} visible={showMemoryPills} />
                          {!message.streaming && message.isGreeting && message.greetingMeta && message.greetingMeta.total_memories > 0 && (
                            <GreetingMetaBar meta={message.greetingMeta} />
                          )}
                          {!message.streaming && message.content && message.cost !== undefined && (
                            <ReceiptBadge message={message} onOpenComparison={() => setShowCostModal(true)} onOpenHistory={() => setShowTransactions(true)} />
                          )}
                        </div>
                      </div>
                    )}
                    {message.role === "user" && (
                      <div className="bg-blue-600/20 border border-blue-500/30 rounded-xl rounded-tr-sm px-3 py-2 max-w-[80%]">
                        <p className="text-white text-[13px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
                      </div>
                    )}
                  </motion.div>
                ))}

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

          {/* Low balance warning (active once Phase 1 balance tables land) */}
          <AnimatePresence>
            {balance !== null && balance > 0 && balance < 0.5 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-2"
              >
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-amber-400 text-xs flex items-center gap-2">
                  <span>⚠️ Low balance: ${balance.toFixed(2)} remaining</span>
                  <button className="ml-auto text-amber-300 hover:text-amber-200 text-[10px] font-medium underline underline-offset-2">
                    Top Up
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Welcome state - only show when no messages */}
          <AnimatePresence>
            {!hasMessages && (
              <motion.div
                className="flex flex-row items-center mb-2 gap-1"
                initial={{ opacity: 1 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
              >
                {/* Shader Circle */}
                <motion.div
                  id="circle-ball"
                  className="relative flex items-center justify-center z-10"
                  animate={{
                    y: isFocused ? 30 : 0,
                    opacity: isFocused ? 0 : 100,
                    filter: isFocused ? "blur(4px)" : "blur(0px)",
                    rotate: isFocused ? 180 : 0,
                  }}
                  transition={{
                    duration: 0.5,
                    type: "spring",
                    stiffness: 200,
                    damping: 20,
                  }}
                >
                  <div className="z-10 absolute bg-white/5 h-8 w-8 rounded-full backdrop-blur-[3px]">
                    <div className="h-[1.5px] w-[1.5px] bg-white rounded-full absolute top-3 left-3 blur-[0.8px]" />
                    <div className="h-[1.5px] w-[1.5px] bg-white rounded-full absolute top-2 left-5 blur-[0.6px]" />
                    <div className="h-[1.5px] w-[1.5px] bg-white rounded-full absolute top-6 left-1.5 blur-[0.8px]" />
                    <div className="h-[1.5px] w-[1.5px] bg-white rounded-full absolute top-4 left-6.5 blur-[0.6px]" />
                    <div className="h-[1.5px] w-[1.5px] bg-white rounded-full absolute top-5.5 left-5 blur-[0.8px]" />
                  </div>
                  <LiquidMetal
                    style={{ height: 56, width: 56, filter: "blur(10px)", position: "absolute" }}
                    colorBack="hsl(0, 0%, 0%, 0)"
                    colorTint="hsl(220, 100%, 45%)"
                    repetition={4}
                    softness={0.5}
                    shiftRed={0.05}
                    shiftBlue={0.6}
                    distortion={0.1}
                    contour={1}
                    shape="circle"
                    offsetX={0}
                    offsetY={0}
                    scale={0.58}
                    rotation={50}
                    speed={5}
                  />
                  <LiquidMetal
                    style={{ height: 56, width: 56 }}
                    colorBack="hsl(0, 0%, 0%, 0)"
                    colorTint="hsl(220, 100%, 45%)"
                    repetition={4}
                    softness={0.5}
                    shiftRed={0.05}
                    shiftBlue={0.6}
                    distortion={0.1}
                    contour={1}
                    shape="circle"
                    offsetX={0}
                    offsetY={0}
                    scale={0.58}
                    rotation={50}
                    speed={5}
                  />
                </motion.div>

                {/* Greeting Text */}
                <motion.p
                  className="text-white/40 text-[13px] font-light z-10"
                  animate={{
                    y: isFocused ? 30 : 0,
                    opacity: isFocused ? 0 : 100,
                    filter: isFocused ? "blur(4px)" : "blur(0px)",
                  }}
                  transition={{
                    duration: 0.5,
                    type: "spring",
                    stiffness: 200,
                    damping: 20,
                  }}
                >
                  Hey there! I'm here to help with anything you need
                </motion.p>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative overflow-visible">
            <motion.div
              className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none overflow-visible"
              initial={{ opacity: 0 }}
              animate={{ opacity: isFocused ? 1 : 0 }}
              transition={{
                duration: 0.8,
              }}
              style={{ overflow: "visible" }}
            >
              <PulsingBorder
                style={{ height: "146.5%", minWidth: "143%", position: "absolute" }}
                colorBack="hsl(0, 0%, 0%)"
                roundness={0.18}
                thickness={0}
                softness={0}
                intensity={0.3}
                bloom={2}
                spots={2}
                spotSize={0.25}
                pulse={0}
                smoke={0.35}
                smokeSize={0.4}
                scale={0.7}
                rotation={0}
                offsetX={0}
                offsetY={0}
                speed={1}
                colors={[
                  "hsl(220, 100%, 30%)",
                  "hsl(210, 100%, 50%)",
                  "hsl(230, 60%, 20%)",
                  "hsl(215, 100%, 40%)",
                  "hsl(230, 80%, 8%)",
                ]}
              />
            </motion.div>

            <motion.div
              className="relative bg-[#040404] rounded-xl p-3 z-10"
              animate={{
                borderColor: isFocused ? "#1E50E6" : "#3D3D3D",
              }}
              transition={{
                duration: 0.6,
                delay: 0.1,
              }}
              style={{
                borderWidth: "1px",
                borderStyle: "solid",
              }}
            >
              {/* Message Input */}
              <div className="relative mb-4">
                <Textarea
                  placeholder="Ask me anything..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="min-h-[60px] resize-none bg-transparent border-none text-white text-[13px] placeholder:text-zinc-500 focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none [&:focus]:ring-0 [&:focus]:outline-none [&:focus-visible]:ring-0 [&:focus-visible]:outline-none"
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                />
              </div>

              <div className="flex items-center justify-between">
                {/* Left side: Brain + Model selector */}
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowMemoryPills((v) => !v)}
                    className={`h-7 w-7 rounded-full bg-zinc-800 hover:bg-zinc-700 p-0 ${showMemoryPills ? "text-blue-400 hover:text-blue-300" : "text-zinc-100 hover:text-white"}`}
                  >
                    <Brain className="h-3.5 w-3.5" />
                  </Button>
                  <ModelSelector selectedModel={selectedModel} onModelChange={handleModelChange} />
                </div>

                {/* Right side: Send or Stop */}
                <div className="flex items-center gap-2">
                  {streaming ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={stopStreaming}
                      className="h-8 w-8 rounded-full bg-red-600/25 hover:bg-red-600/35 text-red-400 p-0"
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  ) : balance !== null && balance <= 0 ? (
                    <button
                      onClick={() => { /* Phase 1: open top-up modal */ }}
                      className="h-8 px-3 rounded-full bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-xs font-medium transition-colors"
                    >
                      Top Up to continue
                    </button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleSend}
                      disabled={!inputValue.trim()}
                      className="h-8 w-8 rounded-full bg-blue-600/25 hover:bg-blue-600/35 text-blue-500 p-0 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Cost comparison modal */}
      <CostComparison open={showCostModal} onClose={() => setShowCostModal(false)} />
      {/* Transaction history modal */}
      <TransactionHistory open={showTransactions} onClose={() => setShowTransactions(false)} messages={messages} />
    </div>
  )
}
