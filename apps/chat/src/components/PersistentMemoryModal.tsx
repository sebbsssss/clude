import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, BookmarkPlus, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import type { PersistentMemory } from '../lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function PersistentMemoryModal({ open, onClose }: Props) {
  const [memories, setMemories] = useState<PersistentMemory[] | null>(null);
  const [max, setMax] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listPersistentMemories();
      setMemories(res.memories);
      setMax(res.max);
    } catch (err: any) {
      setError(err?.message || 'Failed to load');
      setMemories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on open; also refresh whenever a suggestion card saves one
  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  useEffect(() => {
    const onChange = () => { if (open) load(); };
    window.addEventListener('persistent-memory-changed', onChange);
    return () => window.removeEventListener('persistent-memory-changed', onChange);
  }, [open, load]);

  const handleDelete = async (id: number) => {
    setPendingDelete(id);
    try {
      await api.deletePersistentMemory(id);
      setMemories(prev => prev ? prev.filter(m => m.id !== id) : prev);
      window.dispatchEvent(new CustomEvent('persistent-memory-changed'));
    } catch (err: any) {
      setError(err?.message || 'Failed to delete');
    } finally {
      setPendingDelete(null);
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 4, scale: 0.98 }}
        transition={{ duration: 0.18 }}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] sm:w-[440px] max-h-[70vh] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2 text-sm text-white font-medium">
            <BookmarkPlus className="h-4 w-4 text-violet-400" />
            Permanent preferences
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 pt-3 pb-2">
          <p className="text-[12px] text-zinc-400 leading-snug">
            These rules are applied to every chat, automatically.
            {memories && ` ${memories.length} / ${max} used.`}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3 min-h-[120px]">
          {loading && !memories && (
            <div className="flex items-center justify-center py-8 text-zinc-500 text-[12px]">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
            </div>
          )}

          {error && (
            <div className="mx-2 my-2 flex items-center gap-2 text-[12px] text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-2.5 py-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">{error}</span>
              <button onClick={load} className="text-zinc-400 hover:text-zinc-200 underline">Retry</button>
            </div>
          )}

          {memories && memories.length === 0 && !loading && (
            <div className="text-center py-8 px-4">
              <p className="text-zinc-400 text-[13px]">No permanent preferences yet.</p>
              <p className="text-zinc-500 text-[12px] mt-1 leading-snug">
                When you tell me something you want remembered across chats — like
                “always respond in Japanese” — I’ll offer to save it here.
              </p>
            </div>
          )}

          {memories && memories.map((m) => (
            <div
              key={m.id}
              className="group flex items-start gap-2 px-2.5 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-white/95 leading-snug break-words">{m.summary}</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  {m.key && <span className="font-mono">{m.key}</span>}
                  {m.key && ' · '}
                  {new Date(m.created_at).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => handleDelete(m.id)}
                disabled={pendingDelete === m.id}
                title="Forget this preference"
                className="shrink-0 p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 disabled:opacity-100 transition-all"
              >
                {pendingDelete === m.id
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
