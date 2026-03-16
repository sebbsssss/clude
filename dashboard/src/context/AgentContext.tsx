import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import type { Agent } from '../types/memory';

interface AgentContextValue {
  agents: Agent[];
  selectedAgent: Agent | null;
  selectAgent: (id: string | null) => void;
  loading: boolean;
}

const AgentCtx = createContext<AgentContextValue>({
  agents: [],
  selectedAgent: null,
  selectAgent: () => {},
  loading: true,
});

const STORAGE_KEY = 'clude-selected-agent';

export function AgentProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    function load() {
      setLoading(true);
      api.listAgents().then((list) => {
        setAgents(Array.isArray(list) ? list : []);
        setLoading(false);
      }).catch(() => {
        setAgents([]);
        setLoading(false);
      });
    }
    load();
    const unsubscribe = api.onRefresh(() => {
      setAgents([]);
      load();
    });
    return () => { unsubscribe(); };
  }, []);

  const selectedAgent = agents.find((a) => a.id === selectedId) || null;

  function selectAgent(id: string | null) {
    setSelectedId(id);
    if (id) {
      localStorage.setItem(STORAGE_KEY, id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  return (
    <AgentCtx.Provider value={{ agents, selectedAgent, selectAgent, loading }}>
      {children}
    </AgentCtx.Provider>
  );
}

export function useAgentContext() {
  return useContext(AgentCtx);
}
