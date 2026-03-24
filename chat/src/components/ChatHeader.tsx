import { useState } from 'react';
import { Settings, LogOut, Key, Wallet } from 'lucide-react';
import { useAuthContext } from '../hooks/AuthContext';
import { useBalance } from '../hooks/useBalance';
import { TopUpModal } from './TopUpModal';
import { motion, AnimatePresence } from 'framer-motion';

function BalanceBadge({ balance, onClick }: { balance: number; onClick: () => void }) {
  const colorClass =
    balance >= 1
      ? 'text-green-400 border-green-500/30 bg-green-500/8 hover:bg-green-500/15'
      : balance >= 0.5
        ? 'text-yellow-400 border-yellow-500/30 bg-yellow-500/8 hover:bg-yellow-500/15'
        : 'text-red-400 border-red-500/30 bg-red-500/8 hover:bg-red-500/15';

  return (
    <button
      onClick={onClick}
      title="Click to top up USDC"
      className={`flex items-center gap-1 text-[10px] border rounded-full px-2 py-0.5 transition-colors ${colorClass}`}
    >
      <Wallet className="h-2.5 w-2.5" />
      ${balance.toFixed(2)}
    </button>
  );
}

export function ChatHeader() {
  const { authenticated, walletAddress, authMode, login, logout, loginWithApiKey } = useAuthContext();
  const { balance, pollUntilUpdated } = useBalance();
  const [showSettings, setShowSettings] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyError, setApiKeyError] = useState('');

  const handleApiKeySubmit = async () => {
    if (!apiKeyInput.trim()) return;
    setApiKeyError('');
    const valid = await loginWithApiKey(apiKeyInput.trim());
    if (!valid) setApiKeyError('Invalid API key');
    else setShowSettings(false);
  };

  const handleTopUpSuccess = (previousBalance: number) => {
    pollUntilUpdated(previousBalance);
  };

  return (
    <div className="flex items-center justify-end gap-2 px-4 py-2 relative">
      {authenticated ? (
        <>
          {/* Balance badge */}
          {balance !== null && (
            <BalanceBadge balance={balance.balance_usdc} onClick={() => setShowTopUp(true)} />
          )}

          {/* Wallet address / auth mode */}
          <span className="text-[10px] text-zinc-500">
            {walletAddress ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}` : authMode}
          </span>
          <button onClick={logout} className="text-zinc-500 hover:text-zinc-300 transition-colors" title="Sign out">
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <button
          onClick={login}
          className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors px-3 py-1 border border-blue-500/30 rounded-full"
        >
          Sign in
        </button>
      )}

      <button
        onClick={() => setShowSettings(!showSettings)}
        className="text-zinc-600 hover:text-zinc-400 transition-colors"
      >
        <Settings className="h-3.5 w-3.5" />
      </button>

      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute top-12 right-4 w-64 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 p-3"
          >
            <div className="text-[10px] text-zinc-400 mb-2 flex items-center gap-1">
              <Key className="h-3 w-3" /> Connect API Key
            </div>
            <div className="flex gap-1.5">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="clk_..."
                onKeyDown={(e) => e.key === 'Enter' && handleApiKeySubmit()}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-blue-500"
              />
              <button
                onClick={handleApiKeySubmit}
                className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] rounded transition-colors"
              >
                Go
              </button>
            </div>
            {apiKeyError && <p className="text-[9px] text-red-400 mt-1">{apiKeyError}</p>}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top-up modal */}
      <TopUpModal
        open={showTopUp}
        onClose={() => setShowTopUp(false)}
        currentBalance={balance?.balance_usdc ?? null}
        onSuccess={handleTopUpSuccess}
      />
    </div>
  );
}
