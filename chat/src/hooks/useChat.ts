import { useState, useCallback, useRef } from 'react';
import { useAuthContext } from './AuthContext';
import { api } from '../lib/api';
import type { Message } from '../lib/types';

/**
 * Creates a buffered chunk handler that batches SSE text chunks and flushes
 * via requestAnimationFrame (~60fps). Prevents 100s of React re-renders per
 * second during streaming and instead batches into ~60 updates/sec.
 */
function createChunkBuffer(
  messageId: string,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
) {
  let pending = '';
  let rafId = 0;

  const flush = () => {
    rafId = 0;
    if (!pending) return;
    const chunk = pending;
    pending = '';
    setMessages((prev) =>
      prev.map((m) => m.id === messageId ? { ...m, content: m.content + chunk } : m)
    );
  };

  return {
    push(chunk: string) {
      pending += chunk;
      if (!rafId) rafId = requestAnimationFrame(flush);
    },
    flush() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      flush();
    },
  };
}

export interface MessageCost {
  total: number;
  input?: number;
  output?: number;
}

export interface MessageTokens {
  prompt: number;
  completion: number;
}

export interface MessageReceipt {
  cost_usdc: number;
  equivalent_direct_cost: number;
  savings_pct: number;
  remaining_balance: number | null;
}

export interface GreetingMeta {
  total_memories: number;
  memories_recalled: number;
  temporal_span: { weeks: number; since_label: string } | null;
  topics: string[];
  greeting_cost: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  memoryIds?: number[];
  streaming?: boolean;
  model?: string;
  cost?: MessageCost;
  tokens?: MessageTokens;
  receipt?: MessageReceipt;
  isGreeting?: boolean;
  greetingMeta?: GreetingMeta;
}

export function useChat() {
  const { authenticated } = useAuthContext();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [guestRemaining, setGuestRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchGreeting = useCallback(async () => {
    const greetingId = `greeting-${Date.now()}`;
    setMessages([{ id: greetingId, role: 'assistant', content: '', streaming: true, isGreeting: true }]);
    setStreaming(true);

    const abort = new AbortController();
    abortRef.current = abort;

    const greetBuf = createChunkBuffer(greetingId, setMessages);

    try {
      await api.greet(
        (chunk) => {
          greetBuf.push(chunk);
        },
        (data) => {
          greetBuf.flush();
          const meta: GreetingMeta | undefined = data?.total_memories != null ? {
            total_memories: data.total_memories,
            memories_recalled: data.memories_recalled ?? 0,
            temporal_span: data.temporal_span ?? null,
            topics: data.topics ?? [],
            greeting_cost: data.greeting_cost ?? 0,
          } : undefined;
          setMessages((prev) =>
            prev.map((m) => m.id === greetingId
              ? { ...m, content: (m.content || 'Hey! How can I help you today?').trimStart(), streaming: false, cost: data?.cost, tokens: data?.tokens, greetingMeta: meta }
              : m)
          );
        },
        abort.signal,
      );
    } catch (err: any) {
      greetBuf.flush();
      if (err.name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) => m.id === greetingId
            ? { ...m, content: m.content || 'Hey! How can I help you today?', streaming: false }
            : m)
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, []);

  const sendMessage = useCallback(async (
    content: string,
    conversationId: string | null,
    model: string,
  ) => {
    setError(null);

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
    };
    setMessages((prev) => [...prev, userMsg]);

    const assistantId = `assistant-${Date.now()}`;
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', streaming: true }]);
    setStreaming(true);

    const abort = new AbortController();
    abortRef.current = abort;

    const msgBuf = createChunkBuffer(assistantId, setMessages);

    try {
      if (!authenticated || !conversationId) {
        const history = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
        await api.sendGuestMessage(
          content,
          history,
          (chunk) => {
            msgBuf.push(chunk);
          },
          (remaining) => {
            msgBuf.flush();
            if (remaining !== undefined) setGuestRemaining(remaining);
            setMessages((prev) =>
              prev.map((m) => m.id === assistantId ? { ...m, streaming: false, model: 'kimi-k2-thinking', cost: { total: 0 } } : m)
            );
          },
          abort.signal,
        );
      } else {
        await api.sendMessage(
          conversationId,
          content,
          model,
          (chunk) => {
            msgBuf.push(chunk);
          },
          (data) => {
            msgBuf.flush();
            // Update balance from receipt if present
            if (data?.receipt?.remaining_balance !== null && data?.receipt?.remaining_balance !== undefined) {
              setBalance(data.receipt.remaining_balance);
            }
            setMessages((prev) =>
              prev.map((m) => m.id === assistantId
                ? {
                    ...m,
                    id: data?.message_id || m.id,
                    streaming: false,
                    memoryIds: data?.memory_ids,
                    model: data?.model,
                    cost: data?.cost ?? (data ? { total: 0 } : undefined),
                    tokens: data?.tokens,
                    receipt: data?.receipt,
                  }
                : m)
            );
          },
          abort.signal,
        );
      }
    } catch (err: any) {
      msgBuf.flush();
      if (err.name === 'AbortError') {
        setMessages((prev) =>
          prev.map((m) => m.id === assistantId ? { ...m, streaming: false } : m)
        );
      } else {
        const errorMsg = err.message || 'Something went wrong';
        setError(errorMsg);
        setMessages((prev) =>
          prev.map((m) => m.id === assistantId
            ? { ...m, content: m.content || errorMsg, streaming: false }
            : m)
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [authenticated, messages]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const loadMessages = useCallback((msgs: Message[]) => {
    setMessages(msgs.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      memoryIds: m.memory_ids,
    })));
  }, []);

  const prependMessages = useCallback((msgs: Message[]) => {
    setMessages((prev) => [
      ...msgs.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        memoryIds: m.memory_ids,
      })),
      ...prev,
    ]);
  }, []);

  return {
    messages,
    streaming,
    guestRemaining,
    balance,
    error,
    sendMessage,
    stopStreaming,
    clearMessages,
    loadMessages,
    prependMessages,
    fetchGreeting,
  };
}
