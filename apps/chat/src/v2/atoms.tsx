import { MEMORY_COLORS, type V2Memory } from './types';

// ──────────────────────────────────────────────────────────────────
// Atoms — wordmark, saved-today chip, hover citation popover.
// These match the BEM class names in chat-styles.css verbatim so the
// CSS cascade from the design bundle lights up without translation.
// ──────────────────────────────────────────────────────────────────

export function CcWordmark({ badge = 'Chat' }: { badge?: string | null }) {
  return (
    <div className="cc-wordmark">
      <span className="cc-wm">CLUDE</span>
      {badge && <span className="cc-badge">{badge}</span>}
    </div>
  );
}

export function CcSavingsChip({ saved = 12840 }: { saved?: number }) {
  return (
    <div className="cc-savedchip" title="Tokens saved today vs frontier baseline">
      <span className="cc-savedchip__val">−{saved.toLocaleString()}</span>
      <span className="cc-savedchip__lbl">tok saved · today</span>
    </div>
  );
}

export function CcSavedAllTimeChip({ saved }: { saved: number }) {
  return (
    <a className="cc-savedchip" href="/proof.html" target="_blank" rel="noopener" style={{ textDecoration: 'none' }} title="Total tokens Clude has saved, to date">
      <span className="cc-savedchip__val">−{saved.toLocaleString()}</span>
      <span className="cc-savedchip__lbl">tok saved · all-time</span>
    </a>
  );
}

export function CcCitation({ memory }: { memory: V2Memory | null | undefined }) {
  if (!memory) return null;
  return (
    <span className="cc-cite" data-type={memory.type}>
      <span>◈</span>
      <span className="cc-cite__pop">
        <span
          className="cc-cite__poplabel"
          style={{ color: MEMORY_COLORS[memory.type], display: 'block' }}
        >
          {memory.type.replace('_', '-')} · recalled
        </span>
        <span className="cc-cite__popcontent" style={{ display: 'block' }}>
          {memory.content}
        </span>
        <span className="cc-cite__popmeta" style={{ display: 'flex' }}>
          <span>imp {memory.importance.toFixed(2)}</span>
          <span>decay {memory.decay.toFixed(2)}</span>
          <span>× {memory.accessed}</span>
          <span>{memory.timestamp}</span>
        </span>
      </span>
    </span>
  );
}
