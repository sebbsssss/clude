import { useEffect, useRef, useState } from 'react';

interface SharePopoverProps {
  topicId: string;
  topicName: string;
  onClose: () => void;
}

// Simple share popover: builds a public-looking URL for the topic, copy
// button, an access-mode toggle. The link is never actually published in
// the showcase build — clicking copy puts the URL on the clipboard so the
// behaviour is real, but no /share route exists yet.
export function SharePopover({ topicId, topicName, onClose }: SharePopoverProps) {
  const [copied, setCopied] = useState(false);
  const [access, setAccess] = useState<'view' | 'comment'>('view');
  const ref = useRef<HTMLDivElement>(null);

  const url = `${window.location.origin}/share/${topicId}`;

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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Older browsers / blocked clipboard — fall back silently.
    }
  };

  return (
    <div className="wk-share" ref={ref} role="dialog" aria-label={`Share ${topicName}`}>
      <div className="wk-share__head">
        <div>
          <div className="wk-share__eyebrow">SHARE</div>
          <div className="wk-share__title">{topicName}</div>
        </div>
        <button className="wk-share__close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="wk-share__url-row">
        <input className="wk-share__url" value={url} readOnly onFocus={(e) => e.currentTarget.select()} />
        <button
          className={`wk-share__copy ${copied ? 'is-copied' : ''}`}
          onClick={handleCopy}
        >
          {copied ? '✓ Copied' : 'Copy link'}
        </button>
      </div>
      <div className="wk-share__hint">Anyone with this link can view this topic.</div>

      <div className="wk-share__access">
        <span className="wk-share__access-label">Access</span>
        <div className="wk-share__access-options">
          <button
            className={`wk-share__access-opt ${access === 'view' ? 'is-active' : ''}`}
            onClick={() => setAccess('view')}
          >
            <span aria-hidden>◐</span> View only
          </button>
          <button
            className={`wk-share__access-opt ${access === 'comment' ? 'is-active' : ''}`}
            onClick={() => setAccess('comment')}
          >
            <span aria-hidden>✎</span> Can comment
          </button>
        </div>
      </div>

      <div className="wk-share__footer">
        <div className="wk-share__footer-line">
          <span className="wk-share__footer-glyph">◇</span>
          Shared topics keep updating live as your agent collects new notes.
        </div>
        <div className="wk-share__footer-line">
          <span className="wk-share__footer-glyph">◐</span>
          Memories from <strong>private</strong> conversations are excluded automatically.
        </div>
      </div>
    </div>
  );
}
