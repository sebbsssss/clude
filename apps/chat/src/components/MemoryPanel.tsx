import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, ChevronDown, Upload, ExternalLink } from 'lucide-react';
import type { MemoryStats, MemorySummary, MemoryType } from '../lib/types';

interface Props {
  stats: MemoryStats | null;
  recent: MemorySummary[];
  onImport: () => void;
}

const TYPE_LABELS: Record<MemoryType, { label: string; color: string }> = {
  episodic: { label: 'Episodic', color: 'text-blue-400' },
  semantic: { label: 'Semantic', color: 'text-indigo-400' },
  procedural: { label: 'Procedural', color: 'text-green-400' },
  self_model: { label: 'Self Model', color: 'text-purple-400' },
};

export function MemoryPanel({ stats, recent, onImport }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [expandedType, setExpandedType] = useState<MemoryType | null>(null);

  if (!stats) return null;

  return (
    <div className="border-t border-zinc-800 px-2 py-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors"
      >
        <Brain className="h-3.5 w-3.5 text-blue-400" />
        <span>Your Memory</span>
        <span className="text-zinc-600 ml-auto mr-1">{stats.total}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-2 py-1 space-y-1">
              {(Object.keys(TYPE_LABELS) as MemoryType[]).map((type) => {
                const count = stats.byType[type] || 0;
                if (count === 0) return null;
                const typeRecent = recent.filter((m) => m.memory_type === type);
                return (
                  <div key={type}>
                    <button
                      onClick={() => setExpandedType(expandedType === type ? null : type)}
                      className="w-full flex items-center gap-2 py-0.5 text-[10px]"
                    >
                      <span className={TYPE_LABELS[type].color}>{TYPE_LABELS[type].label}</span>
                      <span className="text-zinc-600 ml-auto">{count}</span>
                    </button>
                    <AnimatePresence>
                      {expandedType === type && typeRecent.length > 0 && (
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: 'auto' }}
                          exit={{ height: 0 }}
                          className="overflow-hidden pl-3"
                        >
                          {typeRecent.slice(0, 5).map((m) => (
                            <div key={m.id} className="text-[9px] text-zinc-500 py-0.5 truncate">
                              {m.summary || 'Untitled memory'}
                            </div>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>

            <div className="px-2 py-1.5 flex gap-2">
              <button
                onClick={onImport}
                className="flex items-center gap-1 text-[9px] text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Upload className="h-2.5 w-2.5" /> Import Pack
              </button>
              <a
                href="/dashboard"
                target="_blank"
                className="flex items-center gap-1 text-[9px] text-zinc-500 hover:text-zinc-400 transition-colors ml-auto"
              >
                Dashboard <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
