import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Shield, ChevronDown, Key, CheckCircle, Lock } from 'lucide-react';
import { useAuthContext } from '../hooks/AuthContext';
import { api } from '../lib/api';
import type { ChatModel, BYOKProvider } from '../lib/types';

// Dedup concurrent mount calls, expire after 60s so deploys propagate
let _modelsPromise: Promise<ChatModel[]> | null = null;
let _modelsFetchedAt = 0;
function fetchModelsOnce(): Promise<ChatModel[]> {
  if (!_modelsPromise || Date.now() - _modelsFetchedAt > 60_000) {
    _modelsFetchedAt = Date.now();
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
  /** Set of providers for which the user has a BYOK key saved. */
  byokProviders: Set<BYOKProvider>;
  onOpenBYOK: () => void;
}

export function ModelSelector({ selectedModel, onModelChange, byokProviders, onOpenBYOK }: Props) {
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

  const current = models.find((m) => m.id === selectedModel)
    || models.find((m) => m.default);

  const availableBYOKModels = useMemo(
    () => models.filter(m => m.requiresByok && m.byokProvider && byokProviders.has(m.byokProvider)),
    [models, byokProviders],
  );

  // Force reset to free model if user logs out while a pro/byok model is selected
  useEffect(() => {
    if (!authenticated && models.length > 0 && current) {
      if (current.tier === 'pro' || current.requiresByok) {
        const freeModel = models.find((m) => m.tier === 'free') || models[0];
        onModelChange(freeModel.id);
      }
    }
  }, [authenticated, models, selectedModel, onModelChange, current]);

  // Reset to default if the selected BYOK model's provider key was removed
  useEffect(() => {
    if (models.length > 0 && current?.requiresByok && current.byokProvider && !byokProviders.has(current.byokProvider)) {
      const defaultModel = models.find((m) => (m as any).default) || models.find((m) => m.tier === 'free') || models[0];
      onModelChange(defaultModel.id);
    }
  }, [models, current, byokProviders, onModelChange]);

  const handleSelect = (model: ChatModel) => {
    if (model.tier === 'pro' && !authenticated) {
      login();
      return;
    }
    // BYOK models require auth
    if (model.requiresByok && !authenticated) {
      login();
      return;
    }
    onModelChange(model.id);
    setOpen(false);
  };

  const privateModels = useMemo(() => models.filter((m) => !m.requiresByok && m.privacy === 'private'), [models]);
  const anonymizedModels = useMemo(() => models.filter((m) => !m.requiresByok && m.privacy === 'anonymized'), [models]);

  const currentName = current ? current.name : 'Select model';

  // Guest mode: show fixed model label, no dropdown
  if (!authenticated) {
    return (
      <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-700 text-white text-[13px] rounded-full px-3 h-11 sm:h-8 min-w-[120px] sm:min-w-[150px]">
        <Zap className="h-3.5 w-3.5 text-blue-400" />
        <span className="truncate">Kimi K2</span>
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 text-white text-[13px] rounded-full px-3 h-11 sm:h-8 min-w-[120px] sm:min-w-[150px] transition-colors"
      >
        {current?.requiresByok ? (
          <Key className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <Zap className="h-3.5 w-3.5 text-blue-400" />
        )}
        <span className="truncate">{currentName}</span>
        <ChevronDown className="h-3.5 w-3.5 ml-auto opacity-50" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="absolute bottom-full mb-2 left-0 w-[calc(100vw-2rem)] sm:w-80 max-w-80 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl z-50 overflow-hidden max-h-[min(420px,60vh)] overflow-y-auto"
          >
            {/* BYOK section */}
            {availableBYOKModels.length > 0 && (
              <>
                <div className="px-3 py-1.5 text-[11px] tracking-widest uppercase text-emerald-400 border-b border-zinc-800 flex items-center gap-1.5">
                  <Key className="h-3.5 w-3.5" /> Your Keys — Direct to Provider
                </div>
                {availableBYOKModels.map((model) => (
                  <ModelItem
                    key={model.id}
                    model={model}
                    selected={model.id === selectedModel}
                    onClick={() => handleSelect(model)}
                  />
                ))}
              </>
            )}

            {/* Manage Keys button */}
            <div className={`px-3 py-1.5 border-b border-zinc-800 ${availableBYOKModels.length > 0 ? 'border-t' : ''}`}>
              <button
                onClick={(e) => { e.stopPropagation(); setOpen(false); onOpenBYOK(); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-[12px] text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800/50 rounded-md transition-colors"
              >
                <Key className="h-3 w-3" />
                {byokProviders.size > 0 ? `Manage Keys (${byokProviders.size})` : 'Bring Your Own Key'}
              </button>
            </div>

            {/* OpenRouter: Private models */}
            <div className="px-3 py-1.5 text-[11px] tracking-widest uppercase text-zinc-400 border-b border-zinc-800 flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5" /> Private — Zero Data Retention
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

            {/* OpenRouter: Anonymized models */}
            <div className="px-3 py-1.5 text-[11px] tracking-widest uppercase text-zinc-400 border-b border-zinc-800 border-t flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 opacity-50" /> Anonymized — No Identity Attached
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

            <div className="px-3 py-2 border-t border-zinc-800 text-[11px] text-zinc-400">
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
  locked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={locked}
      onClick={onClick}
      className={`w-full px-3 py-2 flex items-center gap-2 text-left transition-colors ${
        selected ? (model.requiresByok ? 'bg-emerald-600/15 text-white' : 'bg-blue-600/15 text-white') : 'text-zinc-300 hover:bg-zinc-800'
      } ${locked ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] truncate">{model.name}</span>
          {model.tier === 'pro' && !model.requiresByok && <Zap className="h-3 w-3 text-blue-400 fill-blue-400/20" />}
          {locked && <Lock className="h-3 w-3 text-zinc-500" />}
          {model.requiresByok && <Key className="h-3 w-3 text-emerald-400/70" />}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-zinc-500">
          <span className="uppercase">{model.context >= 1000000 ? `${model.context / 1000000}M` : `${model.context / 1000}K`} context</span>
          <span>•</span>
          <span>{model.requiresByok ? 'Your API Key' : (model.tier === 'pro' ? 'Pro Plan' : 'Free Tier')}</span>
        </div>
      </div>
      {selected && (
        <CheckCircle className={`h-4 w-4 ${model.requiresByok ? 'text-emerald-400' : 'text-blue-400'}`} />
      )}
    </button>
  );
}
