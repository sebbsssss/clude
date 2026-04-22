import { memo, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { LiquidMetal } from '@paper-design/shaders-react';
import { ChevronDown, Clock, X } from 'lucide-react';
import { Markdown } from './Markdown';
import { MemoryPills } from './MemoryPills';
import { StaticAvatar } from './StaticAvatar';
import { PreferenceSuggestionCard } from './PreferenceSuggestionCard';
import type { SettledMessage, StreamingState, GreetingMeta } from '../lib/types';

// --- Avatar shader props as module-level constants (never recreated) ---

const AVATAR_SHADER_PROPS = {
  colorBack: 'hsl(0, 0%, 0%, 0)' as const,
  colorTint: 'hsl(220, 100%, 45%)' as const,
  repetition: 4,
  softness: 0.5,
  shiftRed: 0.05,
  shiftBlue: 0.6,
  distortion: 0.1,
  contour: 1,
  shape: 'circle' as const,
  offsetX: 0,
  offsetY: 0,
  scale: 0.58,
  rotation: 50,
  speed: 8, // streaming speed
} as const;

// --- Formatting helpers ---

function formatCost(v: number): string {
  if (v === 0) return 'Free';
  return v < 0.001 ? `$${v.toFixed(5)}` : `$${v.toFixed(4)}`;
}

// --- ReceiptBadge (settled messages only) ---

function ReceiptBadge({ message, onOpenComparison, onOpenHistory }: {
  message: SettledMessage;
  onOpenComparison: () => void;
  onOpenHistory: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cost = message.cost!;
  const receipt = message.receipt;
  const tokens = message.tokens;

  const { opusCost, savingsPct } = useMemo(() => {
    const opus = receipt?.equivalent_direct_cost ?? (tokens
      ? (tokens.prompt / 1_000_000) * 15 + (tokens.completion / 1_000_000) * 75
      : 0);
    const pct = receipt?.savings_pct ?? (opus > 0
      ? Math.round(((opus - cost.total) / opus) * 100)
      : 0);
    return { opusCost: opus, savingsPct: pct };
  }, [cost, tokens, receipt]);

  const collapsedLabel = cost.total === 0
    ? `◆ Free · ${formatCost(opusCost)} on Opus`
    : `◆ ${formatCost(cost.total)} · ${savingsPct}% saved`;

  return (
    <div className="mt-0.5">
      <button onClick={() => setExpanded(e => !e)} className="flex items-center gap-1 group">
        <span className="text-[12px] text-white/50 group-hover:text-white/65 transition-colors whitespace-nowrap">
          {collapsedLabel}
        </span>
        <ChevronDown className={`w-3 h-3 text-white/35 group-hover:text-white/55 transition-all shrink-0 ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 mt-1 text-[12px] space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Cost</span>
            <span className="text-green-400 font-medium font-mono">{formatCost(cost.total)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Direct API (Opus)</span>
            <span className="text-red-400/80 font-mono">{formatCost(opusCost)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">You saved</span>
            <span className="text-green-400 font-medium">{savingsPct}%</span>
          </div>
          {tokens && (
            <div className="flex items-center justify-between pt-1 border-t border-zinc-700/50">
              <span className="text-zinc-400">Tokens</span>
              <span className="text-zinc-400 font-mono">
                {tokens.prompt.toLocaleString()} in · {tokens.completion.toLocaleString()} out
              </span>
            </div>
          )}
          {receipt?.remaining_balance !== null && receipt?.remaining_balance !== undefined && (
            <div className="flex items-center justify-between pt-1 border-t border-zinc-700/50">
              <span className="text-zinc-400">Balance</span>
              <span className="text-zinc-300 font-mono">${receipt.remaining_balance.toFixed(2)}</span>
            </div>
          )}
          <div className="flex items-center gap-3 pt-0.5">
            <button
              onClick={(e) => { e.stopPropagation(); onOpenComparison(); }}
              className="text-[11px] text-blue-400/70 hover:text-blue-400 transition-colors"
            >
              Model comparison →
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onOpenHistory(); }}
              className="text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors"
            >
              History →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- GreetingMetaBar ---

function GreetingMetaBar({ meta }: { meta: GreetingMeta }) {
  const spanLabel = meta.temporal_span
    ? meta.temporal_span.weeks <= 1
      ? 'this week'
      : meta.temporal_span.weeks < 52
        ? `${meta.temporal_span.weeks}w`
        : `since ${meta.temporal_span.since_label}`
    : null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      <span className="inline-flex items-center gap-1 text-[12px] text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-full px-2.5 py-1">
        <span className="text-blue-300/60">◆</span>
        {meta.total_memories.toLocaleString()} memories
        {spanLabel && <span className="text-blue-400/50">· {spanLabel}</span>}
      </span>
      {meta.topics.slice(0, 4).map((topic) => (
        <span
          key={topic}
          className="inline-flex items-center text-[12px] text-zinc-300 bg-zinc-800/60 border border-zinc-700/40 rounded-full px-2.5 py-1"
        >
          {topic}
        </span>
      ))}
      <span className="inline-flex items-center gap-1 text-[12px] text-green-400/70 bg-green-500/8 border border-green-500/20 rounded-full px-2.5 py-1">
        <span className="text-green-400/50">$0</span>
        <span className="text-zinc-400">· GPT-4o ~$0.05</span>
      </span>
    </div>
  );
}

// --- SettledBubble: React.memo, plain <div>, CSS avatar ---

interface SettledBubbleProps {
  message: SettledMessage;
  showMemoryPills: boolean;
  onOpenComparison: () => void;
  onOpenHistory: () => void;
}

export const SettledBubble = memo(function SettledBubble({
  message,
  showMemoryPills,
  onOpenComparison,
  onOpenHistory,
}: SettledBubbleProps) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-blue-600/20 border border-blue-500/30 rounded-xl rounded-tr-sm px-3 py-2 max-w-[80%]">
          <p className="text-white text-[13px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="flex items-start gap-2 max-w-[80%]">
        <StaticAvatar size={24} />
        <div className="flex flex-col gap-1 min-w-0">
          <div className="bg-zinc-900/80 border border-blue-500/20 rounded-xl rounded-tl-sm px-3 py-2">
            {message.content ? (
              <Markdown content={message.content} />
            ) : message.extraParts && message.extraParts.length > 0 ? (
              // Model emitted only tool calls (no text) — render a neutral prompt
              <p className="text-white/70 text-[13px] italic">Noticed a preference — see card below.</p>
            ) : (
              <p className="text-white/90 text-[13px]">Failed to get response</p>
            )}
          </div>
          {message.extraParts?.map((p) =>
            p.type === 'suggest-preference'
              ? <PreferenceSuggestionCard key={p.toolCallId} part={p} />
              : null,
          )}
          <MemoryPills memoryIds={message.memoryIds as number[] | undefined} visible={showMemoryPills} />
          {message.isGreeting && message.greetingMeta && message.greetingMeta.total_memories > 0 && (
            <GreetingMetaBar meta={message.greetingMeta} />
          )}
          {message.content && message.cost !== undefined && (
            <ReceiptBadge message={message} onOpenComparison={onOpenComparison} onOpenHistory={onOpenHistory} />
          )}
        </div>
      </div>
    </div>
  );
});

// --- StreamingBubble: motion.div, LiquidMetal, raw text ---

interface StreamingBubbleProps {
  message: StreamingState;
}

export const StreamingBubble = memo(function StreamingBubble({ message }: StreamingBubbleProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex justify-start"
    >
      <div className="flex items-start gap-2 max-w-[80%]">
        {/* Live avatar — the ONLY LiquidMetal shaders in the app during streaming */}
        <div className="relative flex items-center justify-center flex-shrink-0 mt-0.5" style={{ width: 24, height: 24 }}>
          <div
            className="z-10 absolute bg-white/5 rounded-full backdrop-blur-[2px]"
            style={{ height: 20, width: 20, backdropFilter: 'blur(2px)' }}
          >
            <div style={{ height: '1px', width: '1px' }} className="bg-white rounded-full absolute top-1.5 left-1.5 blur-[0.5px]" />
            <div style={{ height: '1px', width: '1px' }} className="bg-white rounded-full absolute top-1 left-3 blur-[0.4px]" />
            <div style={{ height: '1px', width: '1px' }} className="bg-white rounded-full absolute top-3 left-1 blur-[0.5px]" />
          </div>
          <LiquidMetal
            style={{ height: 24, width: 24, filter: 'blur(5px)', position: 'absolute' }}
            {...AVATAR_SHADER_PROPS}
          />
          <LiquidMetal
            style={{ height: 24, width: 24 }}
            {...AVATAR_SHADER_PROPS}
          />
        </div>

        <div className="flex flex-col gap-1 min-w-0">
          <div className="bg-zinc-900/80 border border-blue-500/20 rounded-xl rounded-tl-sm px-3 py-2">
            {message.content ? (
              // Raw text during streaming — no markdown parsing per frame
              <p className="text-white/90 text-[13px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
            ) : (
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
        </div>
      </div>
    </motion.div>
  );
});

// --- TransactionHistory modal ---

export function TransactionHistory({ open, onClose, messages }: {
  open: boolean;
  onClose: () => void;
  messages: SettledMessage[];
}) {
  const transactions = messages
    .filter(m => m.role === 'assistant' && m.cost && m.cost.total > 0)
    .reverse();

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] sm:w-[360px] max-w-[360px] max-h-[70vh] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 p-5 flex flex-col">
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
            <div className="text-zinc-400 text-xs text-center py-8">
              No paid messages yet this session.
              <br />
              <span className="text-zinc-500 text-[12px]">Free model messages don't appear here.</span>
            </div>
          ) : (
            transactions.map((msg) => (
              <div key={msg.id} className="flex items-center justify-between text-[13px] py-1.5 px-2 rounded hover:bg-zinc-800/50">
                <div className="flex-1 min-w-0">
                  <span className="text-zinc-300 truncate block">{msg.model || 'unknown'}</span>
                  <span className="text-zinc-500 text-[11px]">
                    {msg.tokens ? `${msg.tokens.prompt.toLocaleString()} + ${msg.tokens.completion.toLocaleString()} tokens` : '—'}
                  </span>
                </div>
                <span className="text-green-400/80 font-mono text-[12px] ml-2 shrink-0">
                  ${msg.cost!.total < 0.001 ? msg.cost!.total.toFixed(5) : msg.cost!.total.toFixed(4)}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 pt-3 border-t border-zinc-800">
          <div className="text-[12px] text-zinc-500">
            Session usage only. Full history will be available once balance system is live.
          </div>
        </div>
      </div>
    </>
  );
}
