import { useEffect } from 'react';

export function CcConfirmModal({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="cc-confirm" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="cc-confirm__card" onClick={(e) => e.stopPropagation()}>
        <h2 className="cc-confirm__title">{title}</h2>
        <p className="cc-confirm__body">{body}</p>
        <div className="cc-confirm__actions">
          <button type="button" className="cc-confirm__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={`cc-confirm__confirm${destructive ? ' cc-confirm__confirm--destructive' : ''}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
