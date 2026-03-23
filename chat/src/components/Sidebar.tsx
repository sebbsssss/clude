import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, PanelLeftClose, PanelLeft, TrendingUp, MessageCircle } from 'lucide-react';
import { ConversationList } from './ConversationList';
import { MemoryPanel } from './MemoryPanel';
import { MemoryImportModal } from './MemoryImportModal';
import type { Conversation, MemoryStats, MemorySummary } from '../lib/types';

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  stats: MemoryStats | null;
  recentMemories: MemorySummary[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
  onImportPack: (pack: any) => Promise<number>;
}

export function Sidebar({ conversations, activeId, stats, recentMemories, onSelect, onDelete, onNewChat, onImportPack }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [showImport, setShowImport] = useState(false);

  return (
    <>
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="fixed top-3 left-3 z-40 p-2 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      )}

      <AnimatePresence>
        {!collapsed && (
          <motion.aside
            initial={{ x: -260, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -260, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="w-[260px] h-screen bg-zinc-950 border-r border-zinc-800 flex flex-col fixed left-0 top-0 z-30"
          >
            <div className="flex items-center justify-between px-3 py-3 border-b border-zinc-800">
              <button
                onClick={onNewChat}
                className="flex items-center gap-1.5 text-[11px] text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Plus className="h-3 w-3" /> New Chat
              </button>
              <div className="flex items-center gap-1">
                <Link
                  to="/compound"
                  className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-emerald-400 transition-colors px-2 py-1.5 rounded-lg hover:bg-zinc-800"
                  title="Compound Markets"
                >
                  <TrendingUp className="h-3.5 w-3.5" />
                </Link>
                <Link
                  to="/compound/chat"
                  className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-emerald-400 transition-colors px-2 py-1.5 rounded-lg hover:bg-zinc-800"
                  title="Compound Chat"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                </Link>
                <button
                  onClick={() => setCollapsed(true)}
                  className="text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              </div>
            </div>

            <ConversationList
              conversations={conversations}
              activeId={activeId}
              onSelect={onSelect}
              onDelete={onDelete}
            />

            <MemoryPanel
              stats={stats}
              recent={recentMemories}
              onImport={() => setShowImport(true)}
            />
          </motion.aside>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showImport && (
          <MemoryImportModal
            onImport={onImportPack}
            onClose={() => setShowImport(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
