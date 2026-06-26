import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

interface PaletteItem {
  icon: string;
  label: string;
  hint: string;
  cat: string;
  run: () => void;
}

/** ⌘K command palette — navigate the five screens and trigger key actions. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const go = (path: string) => {
    navigate(path);
    onClose();
  };

  const items: PaletteItem[] = useMemo(
    () => [
      { icon: '◫', label: 'Overview', hint: 'The pulse, at a glance', cat: 'Go', run: () => go('/') },
      { icon: '◎', label: 'Explore', hint: 'Graph + memories + ask', cat: 'Go', run: () => go('/explore') },
      { icon: '▤', label: 'Wiki', hint: 'Curated knowledge', cat: 'Go', run: () => go('/wiki') },
      { icon: '↧', label: 'Export', hint: 'Get memories out, verifiably', cat: 'Go', run: () => go('/export') },
      { icon: '⚙', label: 'Settings', hint: 'Account & connection', cat: 'Go', run: () => go('/settings') },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((i) => i.label.toLowerCase().includes(q) || i.hint.toLowerCase().includes(q))
    : items;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'var(--scrim)', backdropFilter: 'blur(4px)',
        zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '14vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560, maxWidth: '92vw', background: 'var(--surface)', border: '1px solid var(--border-2)',
          borderRadius: 14, boxShadow: '0 24px 70px rgba(0,0,0,0.45)', overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '15px 18px', borderBottom: '1px solid var(--border)' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" style={{ stroke: 'var(--fg-3)', fill: 'none', strokeWidth: 1.8, flex: 'none' }}>
            <circle cx="11" cy="11" r="7" /><line x1="16" y1="16" x2="21" y2="21" />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search screens, actions…"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--fg)', fontSize: 15, fontFamily: 'var(--font-sans)' }}
          />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-3)', border: '1px solid var(--border-2)', borderRadius: 4, padding: '2px 6px' }}>ESC</span>
        </div>
        <div style={{ maxHeight: 340, overflowY: 'auto', padding: 8 }}>
          {filtered.map((p, i) => (
            <button
              key={i}
              className="palitem"
              onClick={p.run}
              style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderRadius: 9, padding: '11px 12px', cursor: 'pointer', transition: 'background .1s' }}
            >
              <span style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', color: 'var(--fg-2)', fontSize: 13 }}>{p.icon}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, color: 'var(--fg)' }}>{p.label}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-3)' }}>{p.hint}</span>
              </span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--fg-3)', flex: 'none' }}>{p.cat}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: '14px 12px', fontSize: 13, color: 'var(--fg-3)' }}>No matches.</div>
          )}
        </div>
      </div>
    </div>
  );
}
