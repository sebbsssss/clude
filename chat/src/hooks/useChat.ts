import { useState, useCallback, useRef } from 'react';
import { useAuthContext } from './AuthContext';
import { api } from '../lib/api';
import type { Message } from '../lib/types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  memoryIds?: number[];
  streaming?: boolean;
}

export function useChat() {
  const { authenticated } = useAuthContext();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [guestRemaining, setGuestRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

    try {
      if (!authenticated || !conversationId) {
        const history = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
        await api.sendGuestMessage(
          content,
          history,
          (chunk) => {
            setMessages((prev) =>
              prev.map((m) => m.id === assistantId ? { ...m, content: m.content + chunk } : m)
            );
          },
          (remaining) => {
            if (remaining !== undefined) setGuestRemaining(remaining);
            setMessages((prev) =>
              prev.map((m) => m.id === assistantId ? { ...m, streaming: false } : m)
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
            setMessages((prev) =>
              prev.map((m) => m.id === assistantId ? { ...m, content: m.content + chunk } : m)
            );
          },
          (data) => {
            setMessages((prev) =>
              prev.map((m) => m.id === assistantId
                ? { ...m, id: data?.message_id || m.id, streaming: false, memoryIds: data?.memory_ids }
                : m)
            );
          },
          abort.signal,
        );
      }
    } catch (err: any) {
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

  return {
    messages,
    streaming,
    guestRemaining,
    error,
    sendMessage,
    stopStreaming,
    clearMessages,
    loadMessages,
  };
}
