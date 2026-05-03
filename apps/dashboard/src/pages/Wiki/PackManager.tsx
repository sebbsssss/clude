import { useEffect, useRef } from 'react';
import { ALL_PACKS, type MemoryPack } from './wiki-packs';

interface PackManagerProps {
  installed: string[];
  onToggle: (packId: string) => void;
  onClose: () => void;
}

// Slide-down panel listing every available memory pack with Install /
// Installed states. The Compliance pack is the showcase example.
export function PackManager({ installed, onToggle, onClose }: PackManagerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="wk-packs" role="dialog" aria-label="Memory packs">
      <div className="wk-packs__head">
        <div>
          <div className="wk-packs__eyebrow">MEMORY PACKS</div>
          <div className="wk-packs__title">Install verticals to scaffold your wiki</div>
        </div>
        <button className="wk-packs__close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <p className="wk-packs__intro">
        A pack defines topics, section templates, and rules that auto-categorise your memories.
        Install one and your agent starts routing relevant conversations into the right place automatically.
      </p>

      <div className="wk-packs__list">
        {ALL_PACKS.map((pack) => (
          <PackRow
            key={pack.id}
            pack={pack}
            installed={installed.includes(pack.id)}
            onToggle={() => onToggle(pack.id)}
          />
        ))}
      </div>
    </div>
  );
}

function PackRow({ pack, installed, onToggle }: { pack: MemoryPack; installed: boolean; onToggle: () => void }) {
  return (
    <div className={`wk-pack ${installed ? 'is-installed' : ''}`}>
      <div className="wk-pack__head">
        <div>
          <div className="wk-pack__vendor">
            {pack.vendor} · {pack.vertical} · v{pack.version}
          </div>
          <div className="wk-pack__name">{pack.name}</div>
        </div>
        <button
          className={`wk-pack__action ${installed ? 'is-installed' : ''}`}
          onClick={onToggle}
          disabled={pack.installedByDefault}
          title={pack.installedByDefault ? 'Default pack — always installed' : undefined}
        >
          {pack.installedByDefault
            ? '✓ Default'
            : installed
              ? 'Uninstall'
              : '+ Install'}
        </button>
      </div>
      <p className="wk-pack__desc">{pack.description}</p>
      <div className="wk-pack__topics">
        <span className="wk-pack__topics-label">Topics</span>
        <div className="wk-pack__topic-list">
          {pack.topics.map((t) => (
            <span key={t.id} className="wk-pack__topic-chip">
              <span className="wk-pack__topic-dot" style={{ background: t.color }} />
              {t.name}
            </span>
          ))}
        </div>
      </div>
      <div className="wk-pack__rules">
        <span className="wk-pack__rules-label">Auto-categorises memories matching</span>
        <span className="wk-pack__rules-text">
          {pack.rules.flatMap((r) => r.keywords).slice(0, 8).join(' · ')}
          {pack.rules.flatMap((r) => r.keywords).length > 8 ? '…' : ''}
        </span>
      </div>
    </div>
  );
}
