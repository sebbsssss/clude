import { useState } from 'react';
import { CcWordmark } from './atoms';
import { V2_THREAD_GROUPS } from './data';
import type { V2Thread } from './types';

function shortWallet(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function CcSidebar({
  user,
  walletAddress,
  threads,
  onNewChat,
  onSelect,
  onLogout,
}: {
  user: { name?: string; email?: string } | null;
  walletAddress: string | null;
  threads: V2Thread[];
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onLogout: () => void;
}) {
  const grouped = V2_THREAD_GROUPS.map((g) => ({
    ...g,
    items: threads.filter((t) => t.group === g.id),
  })).filter((g) => g.items.length > 0);

  const initials = ((user?.name || user?.email || 'SK').slice(0, 2) || 'SK').toUpperCase();

  // Wallet copy button: brief "copied" state.
  const [copied, setCopied] = useState(false);
  const copyWallet = async () => {
    if (!walletAddress) return;
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  return (
    <aside className="cc-side">
      <div className="cc-side__head">
        <CcWordmark badge="Chat" />
        <button type="button" className="cc-side__newbtn" onClick={onNewChat}>
          <span className="cc-plus">+</span> New chat
        </button>
      </div>
      <div className="cc-side__scroll">
        {grouped.length === 0 ? (
          <div className="cc-side__group" style={{ opacity: 0.6 }}>No conversations yet</div>
        ) : (
          grouped.map((g) => (
            <div key={g.id}>
              <div className="cc-side__group">{g.label}</div>
              {g.items.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`cc-thread ${t.active ? 'is-active' : ''}`}
                  onClick={() => onSelect(t.id)}
                >
                  <span className="cc-thread__dot" />
                  <span className="cc-thread__title">{t.title}</span>
                  <span className="cc-thread__meta">{t.meta}</span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
      <div className="cc-side__foot">
        <div className="cc-profile">
          <div className="cc-profile__avatar">{initials}</div>
          <div style={{ minWidth: 0 }}>
            <div className="cc-profile__name">{user?.name || 'Guest'}</div>
            <div className="cc-profile__email">{user?.email || ''}</div>
          </div>
          <button type="button" className="cc-profile__btn" onClick={onLogout} title="Sign out">
            ⏻
          </button>
        </div>
        {walletAddress && (
          <button
            type="button"
            onClick={copyWallet}
            title={copied ? 'Copied!' : `Copy: ${walletAddress}`}
            style={{
              marginTop: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '6px 10px',
              border: '1px solid var(--line)',
              borderRadius: 2,
              background: 'transparent',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.04em',
              color: 'var(--fg-3)',
              cursor: 'pointer',
              width: '100%',
              textAlign: 'left',
            }}
          >
            <span style={{ color: 'var(--fg-3)' }}>◇ wallet</span>
            <span style={{ color: 'var(--fg-2)', fontFeatureSettings: '"tnum" 1' }}>
              {copied ? '✓ copied' : shortWallet(walletAddress)}
            </span>
          </button>
        )}
      </div>
    </aside>
  );
}
