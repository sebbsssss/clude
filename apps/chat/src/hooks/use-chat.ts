import { useState, useCallback, useRef, useEffect } from 'react';
import { useChat as useAIChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useAuthContext } from './AuthContext';
import { api } from '../lib/api';
import type { CludeChatMessage, ChatMessageMetadata, SettledMessage, StreamingState, MessageCost, GreetingMeta } from '../lib/types';
import type { Message } from '../lib/types';

// Re-export types that consumers need
export type { SettledMessage, StreamingState, MessageCost, GreetingMeta };
export type { MessageTokens } from '../lib/types';

/**
 * Chat hook — wraps @ai-sdk/react's useChat for authenticated streaming,
 * with fallback to custom SSE for guest mode and greetings.
 */
export function useChat() {
  const { authenticated, cortexKey } = useAuthContext();

  // AI SDK chat for authenticated users
  const {
    messages: aiMessages,
    setMessages: setAiMessages,
    sendMessage: aiSendMessage,
    status: aiStatus,
    stop: aiStop,
  } = useAIChat<CludeChatMessage>({
    transport: new DefaultChatTransport({
      api: '/api/chat/messages',
      headers: () => cortexKey ? { Authorization: `Bearer ${cortexKey}` } : ({} as Record<string, string>),
      prepareSendMessagesRequest: ({ id, messages, body }) => {
        // Build headers: auth + optional BYOK
        const reqHeaders: Record<string, string> = {};
        if (cortexKey) reqHeaders['Authorization'] = `Bearer ${cortexKey}`;

        const modelId = (body as any)?.model;
        if (modelId) {
          const models = api.getCachedModels();
          const modelDef = models.find(m => m.id === modelId);
          if (modelDef?.requiresByok && modelDef.byokProvider) {
            const key = api.getBYOKKey(modelDef.byokProvider);
            if (key) {
              reqHeaders['X-BYOK-Key'] = key;
              reqHeaders['X-BYOK-Provider'] = modelDef.byokProvider;
            }
          }
        }
        return {
          headers: reqHeaders,
          body: { ...body, id, messages },
        };
      },
    }),
    experimental_throttle: 33, // ~30fps for smooth streaming
    onFinish: ({ message }) => {
      const meta = message.metadata as ChatMessageMetadata | undefined;
      if (meta?.receipt?.remaining_balance !== null && meta?.receipt?.remaining_balance !== undefined) {
        setBalance(meta.receipt.remaining_balance);
        window.dispatchEvent(new CustomEvent('balance-updated', { detail: meta.receipt.remaining_balance }));
      }
    },
  });

  // Guest/greeting state (uses legacy custom SSE)
  const [guestMessages, setGuestMessages] = useState<SettledMessage[]>([]);
  const [guestStreaming, setGuestStreaming] = useState<StreamingState | null>(null);
  const [guestRemaining, setGuestRemaining] = useState<number | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const contentRef = useRef('');
  const greetedRef = useRef(false);

  // Fetch guest remaining count once on mount (guest only)
  useEffect(() => {
    if (!authenticated) {
      api.getGuestStatus().then(({ remaining }) => setGuestRemaining(remaining)).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll helper ref — set by the consumer component
  const scrollRef = useRef<() => void>(() => {});

  const fetchGreeting = useCallback(async () => {
    if (greetedRef.current) return;
    greetedRef.current = true;

    const greetingId = `greeting-${Date.now()}`;
    contentRef.current = '';
    setGuestStreaming({ kind: 'streaming', id: greetingId, role: 'assistant', content: '', isGreeting: true });

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      await api.greet(
        (chunk) => { contentRef.current += chunk; setGuestStreaming(prev => prev ? { ...prev, content: contentRef.current } : prev); },
        (data) => {
          const meta: GreetingMeta | undefined = data?.total_memories != null ? {
            total_memories: data.total_memories,
            memories_recalled: data.memories_recalled ?? 0,
            temporal_span: data.temporal_span ?? null,
            topics: data.topics ?? [],
            greeting_cost: data.greeting_cost ?? 0,
          } : undefined;
          const final: SettledMessage = {
            kind: 'settled', id: greetingId, role: 'assistant',
            content: (contentRef.current || 'Hey! How can I help you today?').trimStart(),
            cost: data?.cost, tokens: data?.tokens, isGreeting: true, greetingMeta: meta,
          };
          setGuestMessages(prev => [...prev, final]);
          setGuestStreaming(null);
          contentRef.current = '';
        },
        abort.signal,
      );
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setGuestMessages(prev => [...prev, {
          kind: 'settled', id: greetingId, role: 'assistant',
          content: contentRef.current || 'Hey! How can I help you today?', isGreeting: true,
        }]);
      }
      setGuestStreaming(null);
      contentRef.current = '';
    } finally {
      abortRef.current = null;
    }
  }, []);

  const sendGuestMessage = useCallback(async (content: string) => {
    setError(null);
    const userMsg: SettledMessage = { kind: 'settled', id: `user-${Date.now()}`, role: 'user', content };
    setGuestMessages(prev => [...prev, userMsg]);

    const assistantId = `assistant-${Date.now()}`;
    contentRef.current = '';
    setGuestStreaming({ kind: 'streaming', id: assistantId, role: 'assistant', content: '' });

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const history = guestMessages.slice(-10).map(m => ({ role: m.role, content: m.content }));
      await api.sendGuestMessage(
        content, history,
        (chunk) => { contentRef.current += chunk; setGuestStreaming(prev => prev ? { ...prev, content: contentRef.current } : prev); },
        (remaining) => {
          if (remaining !== undefined) setGuestRemaining(remaining);
          const finalContent = contentRef.current;
          setGuestMessages(prev => [...prev, {
            kind: 'settled', id: assistantId, role: 'assistant', content: finalContent,
            model: 'kimi-k2-thinking', cost: { total: 0 },
          }]);
          setGuestStreaming(null);
          contentRef.current = '';
        },
        abort.signal,
      );
    } catch (err: any) {
      if (err.name === 'AbortError' && contentRef.current) {
        setGuestMessages(prev => [...prev, { kind: 'settled', id: assistantId, role: 'assistant', content: contentRef.current }]);
      } else if (err.name !== 'AbortError') {
        setError(err.message || 'Something went wrong');
      }
      setGuestStreaming(null);
      contentRef.current = '';
    } finally {
      abortRef.current = null;
    }
  }, [guestMessages]);

  // Unified send — routes to AI SDK (auth) or legacy (guest)
  const sendMessage = useCallback(async (
    content: string,
    conversationIdOrPromise: string | null | Promise<string | null>,
    model: string,
  ) => {
    if (!authenticated) {
      return sendGuestMessage(content);
    }

    // Resolve conversation ID
    const conversationId = await (typeof conversationIdOrPromise === 'object' && conversationIdOrPromise !== null
      ? conversationIdOrPromise
      : Promise.resolve(conversationIdOrPromise));

    if (!conversationId) {
      return sendGuestMessage(content);
    }

    setError(null);

    // AI SDK's sendMessage — transport handles BYOK headers via prepareSendMessagesRequest
    aiSendMessage(
      { text: content },
      {
        body: { model, content, conversationId },
      },
    );
  }, [authenticated, cortexKey, aiSendMessage, sendGuestMessage]);

  const stopStreaming = useCallback(() => {
    if (aiStatus === 'streaming' || aiStatus === 'submitted') {
      aiStop();
    }
    abortRef.current?.abort();
  }, [aiStatus, aiStop]);

  const clearMessages = useCallback(() => {
    setAiMessages([]);
    setGuestMessages([]);
    setGuestStreaming(null);
    setError(null);
    contentRef.current = '';
    greetedRef.current = false;
  }, [setAiMessages]);

  const loadMessages = useCallback((msgs: Message[]) => {
    // Load conversation history into AI SDK messages
    setAiMessages(msgs.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      parts: [{ type: 'text' as const, text: m.content }],
      metadata: { memory_ids: m.memory_ids },
    })));
    setGuestMessages([]);
  }, [setAiMessages]);

  const prependMessages = useCallback((msgs: Message[]) => {
    setAiMessages((prev) => [
      ...msgs.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        parts: [{ type: 'text' as const, text: m.content }],
        metadata: { memory_ids: m.memory_ids },
      })),
      ...prev,
    ]);
  }, [setAiMessages]);

  // Merge AI SDK messages with guest messages for rendering
  const isStreaming = aiStatus === 'streaming' || aiStatus === 'submitted' || !!guestStreaming;

  // Convert AI SDK messages to the shape components expect
  const aiSettled: SettledMessage[] = aiMessages.map(m => {
    const meta = m.metadata as ChatMessageMetadata | undefined;
    const textContent = m.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map(p => p.text)
      .join('');
    return {
      kind: 'settled' as const,
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: textContent,
      memoryIds: meta?.memory_ids,
      model: meta?.model,
      cost: meta?.cost,
      tokens: meta?.tokens,
      receipt: meta?.receipt,
      isGreeting: meta?.isGreeting,
      greetingMeta: meta?.greetingMeta,
    };
  });

  // Greeting messages (from guestMessages) come first, then AI SDK messages
  const settled: SettledMessage[] = [...guestMessages, ...aiSettled];

  // For streaming state: if AI SDK is streaming, extract the last assistant message
  const streamingMsg: StreamingState | null = (() => {
    if (guestStreaming) return guestStreaming;
    if (aiStatus === 'submitted') {
      // Request sent but no chunks yet — show loading indicator
      return { kind: 'streaming', id: `pending-${Date.now()}`, role: 'assistant', content: '' };
    }
    if (aiStatus === 'streaming' && aiMessages.length > 0) {
      const last = aiMessages[aiMessages.length - 1];
      if (last.role === 'assistant') {
        const textContent = last.parts
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map(p => p.text)
          .join('');
        return { kind: 'streaming', id: last.id, role: 'assistant', content: textContent };
      }
    }
    return null;
  })();

  // Exclude the actively streaming message from settled (it renders separately)
  const settledFiltered = streamingMsg && aiStatus === 'streaming'
    ? [...guestMessages, ...aiSettled.slice(0, -1)]
    : settled;

  return {
    settled: settledFiltered,
    streamingMsg,
    isStreaming,
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
