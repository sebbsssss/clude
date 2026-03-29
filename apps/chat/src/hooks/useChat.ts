import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuthContext } from './AuthContext';
import { api } from '../lib/api';
import type { Message, SettledMessage, StreamingState, MessageCost, MessageReceipt, GreetingMeta } from '../lib/types';

// Re-export types that chat-interface.tsx imports
export type { SettledMessage, StreamingState, MessageCost, GreetingMeta };
export type { MessageTokens } from '../lib/types';

/**
 * Throttled RAF loop: writes contentRef to streamingMsg state at ~15fps.
 * SSE chunks write to contentRef (zero renders). This loop copies at display rate.
 */
function createStreamRenderer(
  contentRef: React.MutableRefObject<string>,
  setStreamingMsg: React.Dispatch<React.SetStateAction<StreamingState | null>>,
  scrollFn: () => void,
) {
  let rafId = 0;
  let lastRender = 0;
  const FRAME_INTERVAL = 66; // ~15fps

  const tick = () => {
    rafId = 0;
    const now = performance.now();
    if (now - lastRender < FRAME_INTERVAL) {
      rafId = requestAnimationFrame(tick);
      return;
    }
    lastRender = now;
    setStreamingMsg(prev => prev ? { ...prev, content: contentRef.current } : prev);
    scrollFn();
    rafId = requestAnimationFrame(tick);
  };

  return {
    start() {
      if (!rafId) {
        lastRender = 0;
        rafId = requestAnimationFrame(tick);
      }
    },
    stop() {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    },
    flush() {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      setStreamingMsg(prev => prev ? { ...prev, content: contentRef.current } : prev);
      scrollFn();
    },
  };
}

export function useChat() {
  const { authenticated } = useAuthContext();

  // Cold state — changes only on send or stream completion
  const [settled, setSettled] = useState<SettledMessage[]>([]);
  // Hot state — single object replacement at ~15fps during streaming
  const [streamingMsg, setStreamingMsg] = useState<StreamingState | null>(null);

  const [guestRemaining, setGuestRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Ref for streaming content — SSE writes here, zero React renders
  const contentRef = useRef('');

  // Ref for settled history — allows sendMessage to read without dependency
  const settledRef = useRef<SettledMessage[]>([]);
  useEffect(() => { settledRef.current = settled; }, [settled]);

  // Scroll helper ref — set by the consumer component
  const scrollRef = useRef<() => void>(() => {});

  // Stream renderer — throttled RAF loop
  const rendererRef = useRef<ReturnType<typeof createStreamRenderer> | null>(null);

  const getRenderer = useCallback(() => {
    if (!rendererRef.current) {
      rendererRef.current = createStreamRenderer(contentRef, setStreamingMsg, () => scrollRef.current());
    }
    return rendererRef.current;
  }, []);

  const fetchGreeting = useCallback(async () => {
    const greetingId = `greeting-${Date.now()}`;
    contentRef.current = '';
    setStreamingMsg({ kind: 'streaming', id: greetingId, role: 'assistant', content: '', isGreeting: true });

    const abort = new AbortController();
    abortRef.current = abort;
    const renderer = getRenderer();
    renderer.start();

    try {
      await api.greet(
        (chunk) => { contentRef.current += chunk; },
        (data) => {
          renderer.flush();
          const meta: GreetingMeta | undefined = data?.total_memories != null ? {
            total_memories: data.total_memories,
            memories_recalled: data.memories_recalled ?? 0,
            temporal_span: data.temporal_span ?? null,
            topics: data.topics ?? [],
            greeting_cost: data.greeting_cost ?? 0,
          } : undefined;
          // Promote to settled
          const final: SettledMessage = {
            kind: 'settled',
            id: greetingId,
            role: 'assistant',
            content: (contentRef.current || 'Hey! How can I help you today?').trimStart(),
            cost: data?.cost,
            tokens: data?.tokens,
            isGreeting: true,
            greetingMeta: meta,
          };
          setSettled(prev => [...prev, final]);
          setStreamingMsg(null);
          contentRef.current = '';
        },
        abort.signal,
      );
    } catch (err: any) {
      renderer.stop();
      if (err.name !== 'AbortError') {
        const final: SettledMessage = {
          kind: 'settled',
          id: greetingId,
          role: 'assistant',
          content: contentRef.current || 'Hey! How can I help you today?',
          isGreeting: true,
        };
        setSettled(prev => [...prev, final]);
      }
      setStreamingMsg(null);
      contentRef.current = '';
    } finally {
      abortRef.current = null;
    }
  }, [getRenderer]);

  const sendMessage = useCallback(async (
    content: string,
    conversationId: string | null,
    model: string,
  ) => {
    setError(null);

    // Add user message to settled immediately
    const userMsg: SettledMessage = {
      kind: 'settled',
      id: `user-${Date.now()}`,
      role: 'user',
      content,
    };
    setSettled(prev => [...prev, userMsg]);

    // Start streaming assistant message
    const assistantId = `assistant-${Date.now()}`;
    contentRef.current = '';
    setStreamingMsg({ kind: 'streaming', id: assistantId, role: 'assistant', content: '' });

    const abort = new AbortController();
    abortRef.current = abort;
    const renderer = getRenderer();
    renderer.start();

    try {
      if (!authenticated || !conversationId) {
        // Guest mode — read history from ref (no dependency on settled state)
        const history = settledRef.current.slice(-10).map(m => ({ role: m.role, content: m.content }));
        await api.sendGuestMessage(
          content,
          history,
          (chunk) => { contentRef.current += chunk; },
          (remaining) => {
            renderer.flush();
            if (remaining !== undefined) setGuestRemaining(remaining);
            const final: SettledMessage = {
              kind: 'settled',
              id: assistantId,
              role: 'assistant',
              content: contentRef.current,
              model: 'kimi-k2-thinking',
              cost: { total: 0 },
            };
            setSettled(prev => [...prev, final]);
            setStreamingMsg(null);
            contentRef.current = '';
          },
          abort.signal,
        );
      } else {
        await api.sendMessage(
          conversationId,
          content,
          model,
          (chunk) => { contentRef.current += chunk; },
          (data) => {
            renderer.flush();
            if (data?.receipt?.remaining_balance !== null && data?.receipt?.remaining_balance !== undefined) {
              setBalance(data.receipt.remaining_balance);
              // Notify useBalance instances so header updates instantly
              window.dispatchEvent(new CustomEvent('balance-updated', { detail: data.receipt.remaining_balance }));
            }
            const final: SettledMessage = {
              kind: 'settled',
              id: data?.message_id || assistantId,
              role: 'assistant',
              content: contentRef.current,
              memoryIds: data?.memory_ids,
              model: data?.model,
              cost: data?.cost ?? (data ? { total: 0 } : undefined),
              tokens: data?.tokens,
              receipt: data?.receipt,
            };
            setSettled(prev => [...prev, final]);
            setStreamingMsg(null);
            contentRef.current = '';
          },
          abort.signal,
        );
      }
    } catch (err: any) {
      renderer.stop();
      if (err.name === 'AbortError') {
        // Keep whatever was streamed so far
        if (contentRef.current) {
          const partial: SettledMessage = {
            kind: 'settled',
            id: assistantId,
            role: 'assistant',
            content: contentRef.current,
          };
          setSettled(prev => [...prev, partial]);
        }
      } else {
        // Provide descriptive error messages for common stream failures
        let errorMsg = err.message || 'Something went wrong';
        if (errorMsg === 'Failed to fetch' || errorMsg.includes('network') || errorMsg.includes('NetworkError')) {
          errorMsg = 'Connection lost — check your internet and try again.';
        } else if (errorMsg.includes('interrupted') || errorMsg.includes('aborted')) {
          errorMsg = 'Response was interrupted — try a shorter question or start a new conversation.';
        }
        setError(errorMsg);
        const errFinal: SettledMessage = {
          kind: 'settled',
          id: assistantId,
          role: 'assistant',
          content: contentRef.current || errorMsg,
        };
        setSettled(prev => [...prev, errFinal]);
      }
      setStreamingMsg(null);
      contentRef.current = '';
    } finally {
      abortRef.current = null;
    }
  }, [authenticated, getRenderer]); // stable — no dependency on settled/messages

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearMessages = useCallback(() => {
    setSettled([]);
    setStreamingMsg(null);
    setError(null);
    contentRef.current = '';
  }, []);

  const loadMessages = useCallback((msgs: Message[]) => {
    setSettled(msgs.map((m) => ({
      kind: 'settled' as const,
      id: m.id,
      role: m.role,
      content: m.content,
      memoryIds: m.memory_ids,
    })));
  }, []);

  const prependMessages = useCallback((msgs: Message[]) => {
    setSettled((prev) => [
      ...msgs.map((m) => ({
        kind: 'settled' as const,
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        memoryIds: m.memory_ids,
      })),
      ...prev,
    ]);
  }, []);

  return {
    settled,
    streamingMsg,
    isStreaming: !!streamingMsg,
    guestRemaining,
    balance,
    error,
    sendMessage,
    stopStreaming,
    clearMessages,
    loadMessages,
    prependMessages,
    fetchGreeting,
    scrollRef,
  };
}
