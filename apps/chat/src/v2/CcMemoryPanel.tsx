import { MEMORY_COLORS, type V2Memory } from './types';

export function CcMemoryPanel({
  recalled,
  other,
  totals,
  onClose,
  showCitations,
  onToggleCitations,
}: {
  recalled: V2Memory[];
  other: V2Memory[];
  totals: { stored: number; savedTokToday: number };
  onClose: () => void;
  showCitations: boolean;
  onToggleCitations: (v: boolean) => void;
}) {
  const isEmpty = recalled.length === 0 && other.length === 0;
  return (
    <aside className="cc-mempanel" role="dialog" aria-label="Memory inspector">
      <div className="cc-mempanel__head">
        <div className="cc-mempanel__headrow">
          <div>
            <div className="cc-mempanel__title">◈ Memory inspector</div>
            <div className="cc-mempanel__sub">Used in current thread · decay-weighted</div>
          </div>
          <button
            type="button"
            className="cc-mempanel__close"
            onClick={onClose}
            aria-label="Close inspector"
          >
            ×
          </button>
        </div>
        <label className="cc-mempanel__toggle">
          <input
            type="checkbox"
            checked={showCitations}
            onChange={(e) => onToggleCitations(e.target.checked)}
          />
          <span>Show inline citations in messages</span>
        </label>
      </div>
      <div className="cc-mempanel__scroll">
        {isEmpty ? (
          <div
            style={{
              padding: '32px 20px',
              textAlign: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--fg-3)',
              letterSpacing: '0.04em',
              lineHeight: 1.7,
            }}
          >
            <div style={{ marginBottom: 6, color: 'var(--fg-2)' }}>◇ no memories yet</div>
            <div>
              Memories form as you chat. Once you've sent a few messages, recalled
              and background memories will appear here.
            </div>
          </div>
        ) : (
          <>
            {recalled.length > 0 && (
              <div className="cc-mempanel__group">
                <span>Recalled · this reply</span>
                <span style={{ color: 'var(--brand)' }}>{recalled.length}</span>
              </div>
            )}
            {recalled.map((m) => (
              <MemoryRow key={m.id} m={m} recalled />
            ))}
            {other.length > 0 && (
              <div className="cc-mempanel__group">
                <span>Background · not used</span>
                <span style={{ color: 'var(--fg-3)' }}>{other.length}</span>
              </div>
            )}
            {other.map((m) => (
              <MemoryRow key={m.id} m={m} />
            ))}
          </>
        )}
      </div>
      <div className="cc-mempanel__foot">
        <div className="cc-mempanel__stat">
          <span className="cc-mempanel__stat__k">Total stored</span>
          <span className="cc-mempanel__stat__v">{totals.stored.toLocaleString()}</span>
        </div>
        {totals.savedTokToday > 0 && (
          <div className="cc-mempanel__stat">
            <span className="cc-mempanel__stat__k">Saved today</span>
            <span className="cc-mempanel__stat__v" style={{ color: 'var(--clude-semantic)' }}>
              −{totals.savedTokToday.toLocaleString()} tok
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}

function MemoryRow({ m, recalled }: { m: V2Memory; recalled?: boolean }) {
  return (
    <div className={`cc-mempanel__item ${recalled ? 'is-recalled' : ''}`}>
      <div className="cc-mempanel__itemhead" style={{ color: MEMORY_COLORS[m.type] }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: MEMORY_COLORS[m.type],
            display: 'inline-block',
          }}
        />
        {m.type.replace('_', '-')}
      </div>
      <div className="cc-mempanel__itemcontent">{m.content}</div>
      <div className="cc-mempanel__itemmeta">
        <span>imp {m.importance.toFixed(2)}</span>
        <span>·</span>
        <span>decay {m.decay.toFixed(2)}</span>
        {recalled && (
          <>
            <span>·</span>
            <span>{m.timestamp}</span>
          </>
        )}
      </div>
    </div>
  );
}
