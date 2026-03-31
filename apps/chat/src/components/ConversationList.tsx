import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Trash2, MessageSquare } from 'lucide-react';
import type { Conversation } from '../lib/types';

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function groupByTime(convs: Conversation[]) {
  const now = Date.now();
  const day = 86400000;
  const groups: Record<string, Conversation[]> = {};

  for (const c of convs) {
    const age = now - new Date(c.updated_at).getTime();
    const label = age < day ? 'Today' : age < 2 * day ? 'Yesterday' : age < 7 * day ? 'Previous 7 Days' : 'Older';
    (groups[label] ||= []).push(c);
  }
  return groups;
}

export const ConversationList = memo(function ConversationList({ conversations, activeId, onSelect, onDelete }: Props) {
  const groups = useMemo(() => groupByTime(conversations), [conversations]);

  return (
    <div className="flex-1 overflow-y-auto px-2">
      {Object.entries(groups).map(([label, convs]) => (
        <div key={label} className="mb-3">
          <div className="text-[11px] tracking-widest uppercase text-zinc-500 px-2 py-1">{label}</div>
          {convs.map((conv, i) => (
            <motion.button
              key={conv.id}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03, type: 'spring', stiffness: 300, damping: 25 }}
              onClick={() => onSelect(conv.id)}
              className={`group w-full flex items-center gap-2 px-2 py-3 sm:py-2 rounded-lg text-left transition-colors text-[13px] ${
                conv.id === activeId
                  ? 'bg-blue-600/15 text-white border-l-2 border-blue-500'
                  : 'text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-200'
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 opacity-60" />
              <span className="truncate flex-1">{conv.title || 'New conversation'}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
                className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-2 sm:p-0.5 hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </motion.button>
          ))}
        </div>
      ))}
    </div>
  );
});
