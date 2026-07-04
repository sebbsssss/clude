import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuthContext } from '../hooks/AuthContext';
import { AgentSelector } from './AgentSelector';
import { useTheme } from '../hooks/useTheme';
import { CommandPalette } from './CommandPalette';

/* ── Nav glyphs (Lucide-style line icons, 1.8px stroke via .navi svg) ── */
const OverviewIcon = (
  <svg width="19" height="19" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
);
const ExploreIcon = (
  <svg width="19" height="19" viewBox="0 0 24 24"><circle cx="5" cy="6" r="2.2" /><circle cx="19" cy="8" r="2.2" /><circle cx="11" cy="18" r="2.2" /><line x1="7" y1="6.6" x2="17" y2="7.6" /><line x1="6.2" y1="7.9" x2="10" y2="16" /><line x1="17.4" y1="9.4" x2="12.2" y2="16.6" /></svg>
);
const WikiIcon = (
  <svg width="19" height="19" viewBox="0 0 24 24"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 0 4 21.5z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 1 1.5 1.5z" /></svg>
);
const ExportIcon = (
  <svg width="19" height="19" viewBox="0 0 24 24"><path d="M12 3v11" /><path d="M8 11l4 4 4-4" /><path d="M5 20h14" /></svg>
);
const SettingsIcon = (
  <svg width="19" height="19" viewBox="0 0 24 24"><line x1="4" y1="8" x2="20" y2="8" /><circle cx="9" cy="8" r="2.3" style={{ fill: 'var(--sidebar)' }} /><line x1="4" y1="16" x2="20" y2="16" /><circle cx="15" cy="16" r="2.3" style={{ fill: 'var(--sidebar)' }} /></svg>
);

const NAV: Array<{ path: string; label: string; icon: React.ReactNode }> = [
  { path: '/', label: 'Overview', icon: OverviewIcon },
  { path: '/explore', label: 'Explore', icon: ExploreIcon },
  { path: '/wiki', label: 'Wiki', icon: WikiIcon },
  { path: '/export', label: 'Export', icon: ExportIcon },
  { path: '/settings', label: 'Settings', icon: SettingsIcon },
];

/* Constellation — a private nav entry shown ONLY to the ansem@clude.io account
 * (his 38k-memory bull constellation; the route itself is gated too). */
const ANSEM_EMAIL = 'ansem@clude.io';
const ConstellationIcon = (
  <svg width="19" height="19" viewBox="0 0 24 24"><circle cx="6" cy="5" r="1.6" /><circle cx="18" cy="5" r="1.6" /><circle cx="12" cy="11" r="2.2" /><circle cx="8" cy="19" r="1.6" /><circle cx="16" cy="19" r="1.6" /><line x1="7" y1="6.2" x2="10.6" y2="9.6" /><line x1="17" y1="6.2" x2="13.4" y2="9.6" /><line x1="10.8" y1="12.8" x2="8.6" y2="17.6" /><line x1="13.2" y1="12.8" x2="15.4" y2="17.6" /></svg>
);

function ThemeButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '6px 0', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none', cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        background: active ? 'var(--surface-2)' : 'transparent',
        color: active ? 'var(--fg)' : 'var(--fg-3)',
        transition: 'background .12s, color .12s',
      }}
    >
      {label}
    </button>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { walletAddress, email, logout } = useAuthContext();
  const { isDark, toggle } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // ⌘K / Esc — global command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const displayName = email
    ? email
    : walletAddress
      ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`
      : 'Account';

  return (
    <div style={{ display: 'flex', minHeight: '100vh', width: '100%', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--font-sans)' }}>
      <aside
        style={{
          width: 240, flex: 'none', background: 'var(--sidebar)', borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', padding: '18px 14px', position: 'sticky', top: 0, height: '100vh',
        }}
      >
        {/* Wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px 18px' }}>
          <img src="/dashboard/Clude-Icon-Blue.svg" style={{ width: 22, height: 22, display: 'block' }} alt="Clude" />
          <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--fg)' }}>Clude</span>
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent-text)', background: 'var(--accent-soft)', padding: '3px 7px', borderRadius: 5 }}>Brain</span>
        </div>

        {/* Agent switcher (preserves existing switching logic) */}
        <AgentSelector />

        {/* Primary nav */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 8 }}>
          {NAV.map((n) => (
            <NavLink
              key={n.path}
              to={n.path}
              end={n.path === '/'}
              className="navi"
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 12, padding: '9px 11px', borderRadius: 9,
                fontSize: 13.5, textDecoration: 'none', fontFamily: 'var(--font-sans)',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? 'var(--fg)' : 'var(--fg-2)',
                background: isActive ? 'var(--surface-2)' : 'transparent',
                transition: 'background .12s, color .12s',
              })}
            >
              {n.icon}{n.label}
            </NavLink>
          ))}
          {(email || '').toLowerCase() === ANSEM_EMAIL && (
            <NavLink
              to="/constellation"
              className="navi"
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 12, padding: '9px 11px', borderRadius: 9,
                fontSize: 13.5, textDecoration: 'none', fontFamily: 'var(--font-sans)',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? '#3ddc73' : 'var(--fg-2)',
                background: isActive ? 'rgba(61,220,115,0.09)' : 'transparent',
                transition: 'background .12s, color .12s',
              })}
            >
              {ConstellationIcon}Constellation
            </NavLink>
          )}
        </nav>

        {/* Search / palette */}
        <button
          className="gbtn"
          onClick={() => setPaletteOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14, background: 'transparent', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 11px', cursor: 'pointer', color: 'var(--fg-3)', fontFamily: 'var(--mono)', fontSize: 11.5, transition: 'background .12s' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" style={{ stroke: 'currentColor', fill: 'none', strokeWidth: 1.8 }}><circle cx="11" cy="11" r="7" /><line x1="16" y1="16" x2="21" y2="21" /></svg>
          Search
          <span style={{ marginLeft: 'auto', border: '1px solid var(--border-2)', borderRadius: 4, padding: '1px 5px', fontSize: 10 }}>⌘K</span>
        </button>

        {/* Footer: theme toggle + account */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 14 }}>
          <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: 3 }}>
            <ThemeButton label="Dark" active={isDark} onClick={() => { if (!isDark) toggle(); }} />
            <ThemeButton label="Light" active={!isDark} onClick={() => { if (isDark) toggle(); }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#10b981,#4466ff)', flex: 'none' }} />
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</span>
            </span>
            <button onClick={logout} title="Sign out" style={{ background: 'none', border: 'none', cursor: 'pointer', flex: 'none', display: 'flex', padding: 0 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" style={{ stroke: 'var(--fg-3)', fill: 'none', strokeWidth: 1.8 }}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            </button>
          </div>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0, background: 'var(--bg)' }}>{children}</main>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
