import type { AttachmentMeta } from '../lib/types';

export interface Upload {
  id: string;
  name: string;
  status: 'uploading' | 'ready' | 'error';
  previewUrl?: string;
  meta?: AttachmentMeta;
  error?: string;
}

export function CcAttachmentStrip({
  uploads,
  onRemove,
}: {
  uploads: Upload[];
  onRemove: (id: string) => void;
}) {
  if (uploads.length === 0) return null;
  return (
    <ul className="cc-attstrip" role="list">
      {uploads.map((u) => (
        <li key={u.id} className={`cc-attstrip__tile cc-attstrip__tile--${u.status}`}>
          {u.previewUrl ? (
            <img src={u.previewUrl} alt={u.name} className="cc-attstrip__img" />
          ) : (
            <div className="cc-attstrip__placeholder" aria-hidden />
          )}
          {u.status === 'uploading' && <span className="cc-attstrip__spinner" aria-label="Uploading" />}
          {u.status === 'error' && (
            <span className="cc-attstrip__err" title={u.error || 'Upload failed'}>!</span>
          )}
          <button
            type="button"
            aria-label={`Remove ${u.name}`}
            className="cc-attstrip__remove"
            onClick={() => onRemove(u.id)}
          >×</button>
        </li>
      ))}
    </ul>
  );
}
