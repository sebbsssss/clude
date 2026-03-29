import { useState, useCallback, useEffect } from 'react';
import { useAuthContext } from './AuthContext';
import { api } from '../lib/api';
import type { Conversation, Message } from '../lib/types';

export function useConversations() {
  const { authenticated } = useAuthContext();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [oldestMessageTs, setOldestMessageTs] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated) {
      setConversations([]);
      setActiveId(null);
      return;
    }
    setLoading(true);
    api.listConversations(50)
      .then(setConversations)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [authenticated]);

  const createConversation = useCallback(async (model: string): Promise<string> => {
    const conv = await api.createConversation(model);
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    return conv.id;
  }, []);

  const selectConversation = useCallback(async (id: string) => {
    setActiveId(id);
    setHasMoreMessages(false);
    setOldestMessageTs(null);
    const data = await api.getConversation(id);
    setHasMoreMessages(data.hasMore ?? false);
    if (data.messages.length > 0) {
      setOldestMessageTs(data.messages[0].created_at);
    }
    return data.messages;
  }, []);

  const loadMoreMessages = useCallback(async (id: string): Promise<Message[]> => {
    if (!oldestMessageTs) return [];
    const data = await api.getConversation(id, oldestMessageTs);
    setHasMoreMessages(data.hasMore ?? false);
    if (data.messages.length > 0) {
      setOldestMessageTs(data.messages[0].created_at);
    }
    return data.messages;
  }, [oldestMessageTs]);

  const deleteConversation = useCallback(async (id: string) => {
    await api.deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  }, [activeId]);

  const refreshTitle = useCallback(async (id: string) => {
    try {
      const data = await api.getConversation(id);
      setConversations((prev) =>
        prev.map((c) => c.id === id ? { ...c, title: data.title, message_count: data.message_count, updated_at: data.updated_at } : c)
      );
    } catch { /* ignore */ }
  }, []);

  return {
    conversations,
    activeId,
    loading,
    hasMoreMessages,
    createConversation,
    selectConversation,
    loadMoreMessages,
    deleteConversation,
    refreshTitle,
    setActiveId,
  };
}
