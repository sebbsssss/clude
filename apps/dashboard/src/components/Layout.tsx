import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../hooks/AuthContext';
import { AgentSelector } from './AgentSelector';
import { useTheme } from '../hooks/useTheme';
import { api } from '../lib/api';
import styles from './Layout.module.css';

const NAV_ITEMS = [
  { path: '/', label: 'Overview', icon: '◉' },
  { path: '/timeline', label: 'Timeline', icon: '▤' },
  { path: '/entities', label: 'Entities', icon: '◎' },
  { path: '/brain', label: 'Brain', icon: '◈' },
  { path: '/decay', label: 'Decay', icon: '◇' },
  { path: '/packs', label: 'Memory Packs', icon: '▦' },
  { path: '/settings', label: 'Settings', icon: '⚙' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { walletAddress, email, logout } = useAuthContext();
  const navigate = useNavigate();
  const { isDark, toggle } = useTheme();
  const [chatOpen, setChatOpen] = useState(false);
  const [hasUploadAccess, setHasUploadAccess] = useState(false);


  // Check if wallet has access to file upload feature
  useEffect(() => {
    if (walletAddress) {
      api.checkUploadAccess().then(setHasUploadAccess).catch(() => setHasUploadAccess(false));
    }
  }, [walletAddress]);

  const displayName = email
    ? email
    : walletAddress
      ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
      : '';

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <a href="https://clude.io" target="_blank" rel="noopener">CLUDE</a>
          <span className={styles.badge}>Dashboard</span>
        </div>

        <div style={{ padding: '0 8px', marginBottom: 12 }}>
          <button
            onClick={() => navigate('/setup')}
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 10,
              letterSpacing: 2,
              textTransform: 'uppercase',
              padding: '10px 14px',
              background: 'var(--blue)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              width: '100%',
              fontWeight: 700,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
          >
            + New Agent
          </button>
        </div>

        <AgentSelector />

        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
              }
              end={item.path === '/'}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
          {hasUploadAccess && (
            <NavLink
              to="/file-memory"
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
              }
            >
              <span className={styles.navIcon}>▧</span>
              File Memory
            </NavLink>
          )}
        </nav>

        <div className={styles.sidebarFooter}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div className={styles.wallet} style={{ marginBottom: 0 }}>
              <span className={styles.walletDot} />
              {displayName}
            </div>
            <button
              onClick={toggle}
              title={isDark ? 'Light mode' : 'Dark mode'}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 14,
                padding: '2px 4px',
                color: 'var(--text-faint)',
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-faint)'; }}
            >
              {isDark ? '☀' : '◑'}
            </button>
          </div>
          <button onClick={logout} className={styles.logoutBtn}>
            Sign Out
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        {children}
      </main>

      {/* Floating chat button */}
      <button
        onClick={() => setChatOpen(!chatOpen)}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: chatOpen ? 'var(--text-faint)' : 'var(--blue)',
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
          fontSize: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          zIndex: 1001,
          transition: 'background 0.2s, transform 0.2s',
          transform: chatOpen ? 'rotate(45deg)' : 'none',
        }}
        title={chatOpen ? 'Close chat' : 'Chat with Clude'}
      >
        {chatOpen ? '✕' : '💬'}
      </button>

      {/* Chat slide-out panel */}
      {chatOpen && (
        <div
          style={{
            position: 'fixed',
            bottom: 84,
            right: 24,
            width: 400,
            height: 'calc(100vh - 120px)',
            maxHeight: 700,
            borderRadius: 16,
            overflow: 'hidden',
            boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
            zIndex: 1000,
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          <iframe
            src="/chat/"
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              background: '#000',
            }}
            title="Clude Chat"
          />
        </div>
      )}
    </div>
  );
}
