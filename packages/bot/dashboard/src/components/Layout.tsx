import { NavLink, useLocation } from 'react-router-dom';
import { useAuthContext } from '../hooks/AuthContext';
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
  const location = useLocation();
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
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.wallet}>
            <span className={styles.walletDot} />
            {displayName}
          </div>
          <button onClick={logout} className={styles.logoutBtn}>
            Sign Out
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        {children}
      </main>
    </div>
  );
}
