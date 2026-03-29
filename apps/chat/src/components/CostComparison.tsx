import { motion, AnimatePresence } from 'framer-motion';
import { X, TrendingDown, Shield, ShieldOff } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

const COMPARISONS = [
  { provider: 'Clude', model: 'Kimi K2 Thinking', cost: 'Free', perMsg: 0, privacy: 'private' as const, note: 'Zero data retention' },
  { provider: 'Clude', model: 'Llama 3.3 70B', cost: '$0.20/M', perMsg: 0.0002, privacy: 'private' as const, note: 'Zero data retention' },
  { provider: 'Clude', model: 'DeepSeek V3.2', cost: '$0.20/M', perMsg: 0.0002, privacy: 'private' as const, note: 'Zero data retention' },
  { divider: true },
  { provider: 'Clude', model: 'Claude Sonnet 4.6', cost: '$3–15/M', perMsg: 0.009, privacy: 'anonymized' as const, note: 'Via Venice proxy' },
  { provider: 'Clude', model: 'GPT-5.4', cost: '$2–8/M', perMsg: 0.005, privacy: 'anonymized' as const, note: 'Via Venice proxy' },
  { divider: true },
  { provider: 'Direct', model: 'Claude Opus 4.6', cost: '$15–75/M', perMsg: 0.045, privacy: 'direct' as const, note: 'Anthropic API direct' },
  { provider: 'Direct', model: 'GPT-5.4', cost: '$2–8/M', perMsg: 0.005, privacy: 'direct' as const, note: 'OpenAI API direct' },
] as const;

export function CostComparison({ open, onClose }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed z-50 bg-zinc-900 border border-zinc-700 shadow-2xl p-5 max-md:bottom-0 max-md:left-0 max-md:right-0 max-md:rounded-t-2xl max-md:max-h-[90vh] max-md:overflow-y-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[360px] md:rounded-xl"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-sm text-white font-medium">
                <TrendingDown className="h-4 w-4 text-green-400" /> Cost + Privacy Comparison
              </div>
              <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-1">
              {COMPARISONS.map((c, i) => {
                if ('divider' in c) {
                  return <div key={i} className="border-t border-zinc-800 my-2" />;
                }
                const isClude = c.provider === 'Clude';
                const isPrivate = c.privacy === 'private';
                return (
                  <div key={i} className={`flex items-center justify-between text-[11px] py-1.5 px-2 rounded ${
                    isClude && isPrivate ? 'bg-green-500/5' : ''
                  }`}>
                    <div className="flex items-center gap-2">
                      {isPrivate ? (
                        <Shield className="w-3 h-3 text-green-400 shrink-0" />
                      ) : (
                        <ShieldOff className="w-3 h-3 text-zinc-600 shrink-0" />
                      )}
                      <div>
                        <span className={isClude ? 'text-zinc-200 font-medium' : 'text-zinc-400'}>{c.model}</span>
                        <span className="text-zinc-600 ml-1.5 text-[9px]">{c.note}</span>
                      </div>
                    </div>
                    <span className={`font-mono text-[10px] ${
                      c.cost === 'Free' ? 'text-green-400 font-bold' :
                      isClude && isPrivate ? 'text-green-400/80' :
                      'text-zinc-500'
                    }`}>{c.cost}</span>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 pt-3 border-t border-zinc-800">
              <div className="text-[10px] text-zinc-500 space-y-1">
                <p><Shield className="w-3 h-3 text-green-400 inline mr-1" />Private models run on Venice infrastructure. Zero data retention — your prompts are never stored or trained on.</p>
                <p className="text-green-400/70 font-medium">Clude retrieves your memories at near-zero cost. The same recall on GPT-5 or Claude Opus would cost 100–250x more per message.</p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
