import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { MemoryType } from '../lib/types';

const TYPE_ICONS: Record<MemoryType, string> = {
  episodic: 'E',
  semantic: 'S',
  procedural: 'P',
  self_model: 'I',
};

const TYPE_COLORS: Record<MemoryType, string> = {
  episodic: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  semantic: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  procedural: 'bg-green-500/20 text-green-400 border-green-500/30',
  self_model: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

interface MemoryDetail {
  id: number;
  memory_type: MemoryType;
  summary: string;
  content: string;
  importance: number;
}

interface Props {
  memoryIds?: number[];
  visible: boolean;
}

export function MemoryPills({ memoryIds, visible }: Props) {
  const [memories, setMemories] = useState<MemoryDetail[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    if (!visible || !memoryIds || memoryIds.length === 0) return;
    setMemories(memoryIds.map((id) => ({
      id,
      memory_type: 'semantic' as MemoryType,
      summary: `Memory #${id}`,
      content: '',
      importance: 0,
    })));
  }, [memoryIds, visible]);

  if (!visible || !memoryIds || memoryIds.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        className="flex flex-wrap gap-1 mt-1"
      >
        {memories.map((mem) => (
          <motion.button
            key={mem.id}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={() => setExpandedId(expandedId === mem.id ? null : mem.id)}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] border transition-colors ${TYPE_COLORS[mem.memory_type]}`}
          >
            <span className="font-bold">{TYPE_ICONS[mem.memory_type]}</span>
            <span className="truncate max-w-[120px]">{mem.summary}</span>
          </motion.button>
        ))}
      </motion.div>
    </AnimatePresence>
  );
}
