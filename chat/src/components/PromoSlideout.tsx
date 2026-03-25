import { useEffect, useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const PROMO_SEEN_KEY = 'clude_promo_seen';

interface PromoSlideoutProps {
  /** Only show for authenticated users with an active promo balance */
  show: boolean;
}

export function PromoSlideout({ show }: PromoSlideoutProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!show) return;
    if (localStorage.getItem(PROMO_SEEN_KEY)) return;
    // Brief delay so the UI settles before the slideout appears
    const t = setTimeout(() => setVisible(true), 800);
    return () => clearTimeout(t);
  }, [show]);

  const dismiss = () => {
    localStorage.setItem(PROMO_SEEN_KEY, '1');
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="fixed bottom-6 right-6 w-72 bg-zinc-900 border border-violet-500/30 rounded-xl shadow-2xl z-50 p-4"
          role="dialog"
          aria-label="Free promo announcement"
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-violet-400 shrink-0" />
              <span className="text-[11px] font-semibold text-violet-300">Free · Limited Time</span>
            </div>
            <button
              onClick={dismiss}
              aria-label="Dismiss"
              className="text-zinc-500 hover:text-zinc-300 transition-colors -mt-0.5 ml-2 shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Body */}
          <p className="text-[12px] text-zinc-300 leading-relaxed mb-3">
            As part of our launch, <span className="text-white font-medium">Clude Chat is free for a limited time.</span>{' '}
            You have <span className="text-violet-300 font-medium">$5 of free usage</span> across all models.
          </p>

          {/* CTA */}
          <button
            onClick={dismiss}
            className="w-full py-1.5 text-[11px] font-medium text-violet-200 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 rounded-lg transition-colors"
          >
            Got it, let's go
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
