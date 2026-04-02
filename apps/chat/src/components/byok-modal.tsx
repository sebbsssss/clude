import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Key, Trash2, CheckCircle, AlertCircle, Loader2, Shield, Plus, ChevronRight } from 'lucide-react';
import { BYOK_PROVIDERS, type BYOKProvider } from '../lib/types';

const PROVIDER_ORDER: BYOKProvider[] = ['anthropic', 'openai', 'google', 'xai', 'deepseek', 'minimax'];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Map of provider → decrypted key (truthy = saved). */
  keys: Partial<Record<BYOKProvider, string>>;
  loading: boolean;
  onSave: (provider: BYOKProvider, key: string) => Promise<void>;
  onRemove: (provider: BYOKProvider) => void;
}

export function BYOKModal({ open, onClose, keys, loading, onSave, onRemove }: Props) {
  const [editing, setEditing] = useState<BYOKProvider | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedProvider, setSavedProvider] = useState<BYOKProvider | null>(null);

  const savedCount = Object.keys(keys).length;

  const handleSave = async () => {
    if (!editing || !keyInput.trim()) return;
    setError('');
    setSaving(true);
    try {
      await onSave(editing, keyInput.trim());
      setSavedProvider(editing);
      setKeyInput('');
      setTimeout(() => {
        setSavedProvider(null);
        setEditing(null);
      }, 800);
    } catch (err: any) {
      setError(err.message || 'Failed to save key');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = (provider: BYOKProvider) => {
    onRemove(provider);
    if (editing === provider) {
      setEditing(null);
      setKeyInput('');
    }
  };

  const handleClose = () => {
    setEditing(null);
    setKeyInput('');
    setError('');
    setSavedProvider(null);
    onClose();
  };

  const startEditing = (provider: BYOKProvider) => {
    setEditing(provider);
    setKeyInput('');
    setError('');
    setSavedProvider(null);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-blue-400" />
                <span className="text-white font-medium text-sm">Bring Your Own Key</span>
                {savedCount > 0 && (
                  <span className="text-[11px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded-full">
                    {savedCount} saved
                  </span>
                )}
              </div>
              <button onClick={handleClose} className="text-zinc-400 hover:text-white transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Info banner */}
            <div className="px-5 pt-4 pb-2">
              <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-xs text-zinc-400">
                <Shield className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                <span>Keys are encrypted with your wallet and stored locally. The server never saves them.</span>
              </div>
            </div>

            {/* Provider list */}
            <div className="px-5 py-3 space-y-1">
              {PROVIDER_ORDER.map((provider) => {
                const info = BYOK_PROVIDERS[provider];
                const hasSaved = !!keys[provider];
                const isEditing = editing === provider;
                const justSaved = savedProvider === provider;

                return (
                  <div key={provider} className="rounded-lg overflow-hidden">
                    {/* Provider row */}
                    <button
                      onClick={() => hasSaved ? null : startEditing(isEditing ? null! : provider)}
                      className={`w-full px-3 py-2.5 flex items-center gap-3 text-left transition-colors rounded-lg ${
                        isEditing ? 'bg-zinc-800' :
                        hasSaved ? 'bg-zinc-800/40' :
                        'hover:bg-zinc-800/50'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] text-white">{info.name}</span>
                          {justSaved && (
                            <motion.span
                              initial={{ opacity: 0, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="text-emerald-400 text-[11px]"
                            >
                              Saved!
                            </motion.span>
                          )}
                        </div>
                        {hasSaved && (
                          <span className="text-[11px] text-zinc-500">Key encrypted & stored</span>
                        )}
                      </div>

                      {hasSaved ? (
                        <div className="flex items-center gap-2">
                          <CheckCircle className="h-4 w-4 text-emerald-400" />
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemove(provider); }}
                            className="text-zinc-500 hover:text-red-400 transition-colors p-1"
                            title="Remove key"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : isEditing ? (
                        <ChevronRight className="h-4 w-4 text-blue-400 rotate-90" />
                      ) : (
                        <Plus className="h-4 w-4 text-zinc-500" />
                      )}
                    </button>

                    {/* Expanded input */}
                    <AnimatePresence>
                      {isEditing && !hasSaved && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="px-3 pb-3 pt-1 space-y-2">
                            <input
                              type="password"
                              value={keyInput}
                              onChange={(e) => { setKeyInput(e.target.value); setError(''); }}
                              placeholder="Paste your API key"
                              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition-colors"
                              autoFocus
                              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                            />
                            {error && (
                              <div className="flex items-center gap-2 text-red-400 text-xs">
                                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                <span>{error}</span>
                              </div>
                            )}
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => { setEditing(null); setKeyInput(''); setError(''); }}
                                className="px-2.5 py-1 text-xs text-zinc-400 hover:text-white transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={handleSave}
                                disabled={!keyInput.trim() || saving || loading}
                                className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition-colors flex items-center gap-1.5"
                              >
                                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Key className="h-3 w-3" />}
                                Encrypt & Save
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
