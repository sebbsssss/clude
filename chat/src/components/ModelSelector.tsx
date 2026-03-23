import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Zap, Shield, ChevronDown } from 'lucide-react';
import { useAuthContext } from '../hooks/AuthContext';
import { api } from '../lib/api';
import type { ChatModel } from '../lib/types';

// Fetch once per session — deduplicates concurrent mount calls
let _modelsPromise: Promise<ChatModel[]> | null = null;
function fetchModelsOnce(): Promise<ChatModel[]> {
  if (!_modelsPromise) {
    _modelsPromise = api.getModels().catch((err) => {
      _modelsPromise = null; // allow retry on error
      throw err;
    });
  }
  return _modelsPromise;
}

interface Props {
  selectedModel: string;
  onModelChange: (modelId: string) => void;
}

export function ModelSelector({ selectedModel, onModelChange }: Props) {
  const { authenticated, login } = useAuthContext();
  const [models, setModels] = useState<ChatModel[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    fetchModelsOnce().then(setModels).catch(console.error);
  }, []);

  // Force reset to free model if user logs out while a pro model is selected
  useEffect(() => {
    if (!authenticated && models.length > 0) {
      const selected = models.find((m) => m.id === selectedModel);
      if (selected && selected.tier === 'pro') {
        const freeModel = models.find((m) => m.tier === 'free') || models[0];
        onModelChange(freeModel.id);
      }
    }
  }, [authenticated, models, selectedModel, onModelChange]);

  const current = models.find((m) => m.id === selectedModel) || models.find((m) => m.default);

  const handleSelect = (model: ChatModel) => {
    if (model.tier === 'pro' && !authenticated) {
      login();
      return;
    }
    onModelChange(model.id);
    setOpen(false);
  };

  const privateModels = models.filter((m) => m.privacy === 'private');
  const anonymizedModels = models.filter((m) => m.privacy === 'anonymized');

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 text-white text-[11px] rounded-full px-3 h-7 min-w-[140px] transition-colors"
      >
        <Zap className="h-3 w-3 text-blue-400" />
        <span className="truncate">{current?.name || 'Select model'}</span>
        <ChevronDown className="h-3 w-3 ml-auto opacity-50" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="absolute bottom-full mb-2 left-0 w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl z-50 overflow-hidden"
          >
            <div className="px-3 py-1.5 text-[9px] tracking-widest uppercase text-zinc-500 border-b border-zinc-800 flex items-center gap-1.5">
              <Shield className="h-3 w-3" /> Private — Zero Data Retention
            </div>
            {privateModels.map((model) => (
              <ModelItem
                key={model.id}
                model={model}
                selected={model.id === selectedModel}
                locked={model.tier === 'pro' && !authenticated}
                onClick={() => handleSelect(model)}
              />
            ))}

            <div className="px-3 py-1.5 text-[9px] tracking-widest uppercase text-zinc-500 border-b border-zinc-800 border-t flex items-center gap-1.5">
              <Shield className="h-3 w-3 opacity-50" /> Anonymized — No Identity Attached
            </div>
            {anonymizedModels.map((model) => (
              <ModelItem
                key={model.id}
                model={model}
                selected={model.id === selectedModel}
                locked={model.tier === 'pro' && !authenticated}
                onClick={() => handleSelect(model)}
              />
            ))}

            <div className="px-3 py-2 border-t border-zinc-800 text-[9px] text-zinc-500">
              Private models cost up to <span className="text-blue-400">250x less</span> than direct API access
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ModelItem({ model, selected, locked, onClick }: {
  model: ChatModel;
  selected: boolean;
  locked: boolean;
  onClick: () => void;
}) {
  const costPerMsg = model.cost.input === 0 ? 'Free' :
    `~$${((model.cost.input + model.cost.output) * 0.0005).toFixed(4)}/msg`;

  return (
    <button
      onClick={onClick}
      className={`w-full px-3 py-2 flex items-center gap-2 text-left transition-colors ${
        selected ? 'bg-blue-600/15 text-white' :
        locked ? 'text-zinc-500 hover:bg-zinc-800/50' :
        'text-zinc-300 hover:bg-zinc-800'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-[11px] truncate ${locked ? 'opacity-50' : ''}`}>{model.name}</span>
          {locked && <Lock className="h-2.5 w-2.5 flex-shrink-0 text-zinc-600" />}
        </div>
        <div className="text-[9px] text-zinc-600 flex gap-2">
          <span>{(model.context / 1000).toFixed(0)}K ctx</span>
          <span>{costPerMsg}</span>
        </div>
      </div>
      {selected && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
    </button>
  );
}
