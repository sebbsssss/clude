import { CcSavingsChip, CcSavedAllTimeChip } from './atoms';
import { CcBalanceChip } from './CcBalanceChip';
import { CcModelPicker } from './CcModelPicker';
import type { V2Model } from './types';

export function CcTopbar({
  title,
  subtitle,
  savedToday,
  savedAllTime,
  balance,
  onTopUp,
  walletReady,
  models,
  model,
  onModelChange,
  onToggleMemory,
  memoryOpen,
  onToggleTheme,
  theme,
}: {
  title: string;
  subtitle: string;
  savedToday: number;
  savedAllTime?: number;
  balance: number | null;
  onTopUp: () => void;
  walletReady: boolean;
  models: V2Model[];
  model: string;
  onModelChange: (id: string) => void;
  onToggleMemory: () => void;
  memoryOpen: boolean;
  onToggleTheme: () => void;
  theme: 'light' | 'dark';
}) {
  return (
    <header className="cc-topbar">
      <div className="cc-topbar__left">
        <div>
          <div className="cc-topbar__title">{title}</div>
          <div className="cc-topbar__sub">{subtitle}</div>
        </div>
      </div>
      <div className="cc-topbar__right">
        {savedToday > 0 && <CcSavingsChip saved={savedToday} />}
        {savedAllTime != null && savedAllTime > 0 && <CcSavedAllTimeChip saved={savedAllTime} />}
        <CcBalanceChip balance={balance} onTopUp={onTopUp} walletReady={walletReady} />
        <CcModelPicker models={models} value={model} onChange={onModelChange} />
        <button
          type="button"
          onClick={onToggleTheme}
          title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
          style={{
            padding: '7px 10px',
            background: 'transparent',
            borderRadius: 2,
            border: '1px solid var(--line-strong)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            cursor: 'pointer',
            color: 'var(--fg-2)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontWeight: 600,
          }}
        >
          {theme === 'light' ? '◐ Light' : '◑ Dark'}
        </button>
        <button
          type="button"
          onClick={onToggleMemory}
          title="Toggle memory panel"
          style={{
            padding: '7px 10px',
            background: memoryOpen ? 'var(--brand-tint)' : 'transparent',
            borderRadius: 2,
            border: '1px solid var(--line-strong)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            cursor: 'pointer',
            color: memoryOpen ? 'var(--brand)' : 'var(--fg-2)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontWeight: 600,
          }}
        >
          ◈ Mem
        </button>
      </div>
    </header>
  );
}
