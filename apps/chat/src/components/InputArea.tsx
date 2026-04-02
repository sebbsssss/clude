import { useState, useCallback, memo } from 'react';
import { motion } from 'framer-motion';
import { LiquidMetal, PulsingBorder } from '@paper-design/shaders-react';
import { Brain, Send, Square } from 'lucide-react';
import { Button } from './ui/button.tsx';
import { Textarea } from './ui/textarea.tsx';
import { ModelSelector } from './ModelSelector';
import type { BYOKProvider } from '../lib/types';

const MODEL_STORAGE_KEY = 'chat_selected_model';

interface Props {
  isStreaming: boolean;
  balance: number | null;
  hasMessages: boolean;
  showMemoryPills: boolean;
  onToggleMemoryPills: () => void;
  onSend: (content: string, model: string) => void;
  onStop: () => void;
  byokProviders: Set<BYOKProvider>;
  onOpenBYOK: () => void;
}

export const InputArea = memo(function InputArea({
  isStreaming,
  balance,
  hasMessages,
  showMemoryPills,
  onToggleMemoryPills,
  onSend,
  onStop,
  byokProviders,
  onOpenBYOK,
}: Props) {
  const [isFocused, setIsFocused] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem(MODEL_STORAGE_KEY) || 'kimi-k2-thinking',
  );

  const handleModelChange = useCallback((model: string) => {
    setSelectedModel(model);
    localStorage.setItem(MODEL_STORAGE_KEY, model);
  }, []);

  const handleSend = useCallback(() => {
    if (!inputValue.trim() || isStreaming) return;
    const content = inputValue.trim();
    setInputValue('');
    onSend(content, selectedModel);
  }, [inputValue, isStreaming, selectedModel, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Welcome state — only when no messages */}
      {!hasMessages && (
        <motion.div
          className="flex flex-row items-center mb-2 gap-1"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3 }}
        >
          <motion.div
            id="circle-ball"
            className="relative flex items-center justify-center z-10"
            animate={{
              y: isFocused ? 30 : 0,
              opacity: isFocused ? 0 : 100,
              filter: isFocused ? 'blur(4px)' : 'blur(0px)',
              rotate: isFocused ? 180 : 0,
            }}
            transition={{ duration: 0.5, type: 'spring', stiffness: 200, damping: 20 }}
          >
            <div className="z-10 absolute bg-white/5 h-8 w-8 rounded-full backdrop-blur-[3px]">
              <div className="h-[1.5px] w-[1.5px] bg-white rounded-full absolute top-3 left-3 blur-[0.8px]" />
              <div className="h-[1.5px] w-[1.5px] bg-white rounded-full absolute top-2 left-5 blur-[0.6px]" />
              <div className="h-[1.5px] w-[1.5px] bg-white rounded-full absolute top-6 left-1.5 blur-[0.8px]" />
              <div className="h-[1.5px] w-[1.5px] bg-white rounded-full absolute top-4 left-6.5 blur-[0.6px]" />
              <div className="h-[1.5px] w-[1.5px] bg-white rounded-full absolute top-5.5 left-5 blur-[0.8px]" />
            </div>
            <LiquidMetal
              style={{ height: 56, width: 56, filter: 'blur(10px)', position: 'absolute' }}
              colorBack="hsl(0, 0%, 0%, 0)"
              colorTint="hsl(220, 100%, 45%)"
              repetition={4} softness={0.5} shiftRed={0.05} shiftBlue={0.6}
              distortion={0.1} contour={1} shape="circle"
              offsetX={0} offsetY={0} scale={0.58} rotation={50} speed={5}
            />
            <LiquidMetal
              style={{ height: 56, width: 56 }}
              colorBack="hsl(0, 0%, 0%, 0)"
              colorTint="hsl(220, 100%, 45%)"
              repetition={4} softness={0.5} shiftRed={0.05} shiftBlue={0.6}
              distortion={0.1} contour={1} shape="circle"
              offsetX={0} offsetY={0} scale={0.58} rotation={50} speed={5}
            />
          </motion.div>

          <motion.p
            className="text-white/40 text-[13px] font-light z-10"
            animate={{
              y: isFocused ? 30 : 0,
              opacity: isFocused ? 0 : 100,
              filter: isFocused ? 'blur(4px)' : 'blur(0px)',
            }}
            transition={{ duration: 0.5, type: 'spring', stiffness: 200, damping: 20 }}
          >
            Hey there! I'm here to help with anything you need
          </motion.p>
        </motion.div>
      )}

      {/* Input container */}
      <div className="relative overflow-visible">
        <motion.div
          className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none overflow-visible"
          initial={{ opacity: 0 }}
          animate={{ opacity: isFocused ? 1 : 0 }}
          transition={{ duration: 0.8 }}
          style={{ overflow: 'visible' }}
        >
          <PulsingBorder
            style={{ height: '146.5%', minWidth: '143%', position: 'absolute' }}
            colorBack="hsl(0, 0%, 0%)"
            roundness={0.18} thickness={0} softness={0} intensity={0.3}
            bloom={2} spots={2} spotSize={0.25} pulse={0}
            smoke={0.35} smokeSize={0.4} scale={0.7} rotation={0}
            offsetX={0} offsetY={0} speed={1}
            colors={[
              'hsl(220, 100%, 30%)',
              'hsl(210, 100%, 50%)',
              'hsl(230, 60%, 20%)',
              'hsl(215, 100%, 40%)',
              'hsl(230, 80%, 8%)',
            ]}
          />
        </motion.div>

        <motion.div
          className="relative bg-[#040404] rounded-xl p-3 z-10"
          animate={{ borderColor: isFocused ? '#1E50E6' : '#3D3D3D' }}
          transition={{ duration: 0.6, delay: 0.1 }}
          style={{ borderWidth: '1px', borderStyle: 'solid' }}
        >
          <div className="relative mb-4">
            <Textarea
              placeholder="Ask me anything..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="min-h-[60px] resize-none bg-transparent border-none text-white text-[13px] placeholder:text-zinc-500 focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none [&:focus]:ring-0 [&:focus]:outline-none [&:focus-visible]:ring-0 [&:focus-visible]:outline-none"
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggleMemoryPills}
                className={`h-11 w-11 sm:h-7 sm:w-7 rounded-full bg-zinc-800 hover:bg-zinc-700 p-0 ${showMemoryPills ? 'text-blue-400 hover:text-blue-300' : 'text-zinc-100 hover:text-white'}`}
              >
                <Brain className="h-3.5 w-3.5" />
              </Button>
              <ModelSelector selectedModel={selectedModel} onModelChange={handleModelChange} byokProviders={byokProviders} onOpenBYOK={onOpenBYOK} />
            </div>

            <div className="flex items-center gap-2">
              {isStreaming ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onStop}
                  className="h-11 w-11 sm:h-8 sm:w-8 rounded-full bg-red-600/25 hover:bg-red-600/35 text-red-400 p-0"
                >
                  <Square className="h-4 w-4" />
                </Button>
              ) : balance !== null && balance <= 0 ? (
                <button
                  onClick={() => {}}
                  className="h-11 sm:h-8 px-3 rounded-full bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-xs font-medium transition-colors"
                >
                  Top Up to continue
                </button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSend}
                  disabled={!inputValue.trim()}
                  className="h-11 w-11 sm:h-8 sm:w-8 rounded-full bg-blue-600/25 hover:bg-blue-600/35 text-blue-500 p-0 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
});
