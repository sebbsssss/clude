import { useEffect, useRef, useState, useCallback } from 'react';
import { CcAttachmentStrip, type Upload } from './CcAttachmentStrip';
import { api } from '../lib/api';
import type { AttachmentMeta, AttachmentMime } from '../lib/types';

const MAX_FILES = 8;
const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT_MIMES: AttachmentMime[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function CcComposer({
  onSend,
  disabled,
  vision,
  conversationId,
}: {
  onSend: (text: string, attachments: AttachmentMeta[]) => void | Promise<void>;
  disabled?: boolean;
  vision: boolean;
  conversationId: string;
}) {
  const [val, setVal] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-grow textarea up to 200px (preserved from previous implementation)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [val]);

  // Revoke blob URLs on unmount
  useEffect(() => {
    return () => {
      uploads.forEach((u) => u.previewUrl && URL.revokeObjectURL(u.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear pending uploads when switching to a non-vision model
  useEffect(() => {
    if (!vision && uploads.length > 0) {
      uploads.forEach((u) => u.previewUrl && URL.revokeObjectURL(u.previewUrl));
      setUploads([]);
      setNotice("Image attachments cleared — selected model doesn't support images.");
      const t = setTimeout(() => setNotice(null), 4000);
      return () => clearTimeout(t);
    }
  }, [vision]);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      if (!vision) return;
      const accepted: File[] = [];
      const rejections: string[] = [];
      for (const f of Array.from(files)) {
        if (!ACCEPT_MIMES.includes(f.type as AttachmentMime)) {
          rejections.push(`${f.name}: unsupported format`);
          continue;
        }
        if (f.size > MAX_BYTES) {
          rejections.push(`${f.name}: over 20MB`);
          continue;
        }
        accepted.push(f);
      }

      setUploads((prev) => {
        const remaining = MAX_FILES - prev.length;
        if (accepted.length > remaining) {
          rejections.push(`Only ${remaining} more image(s) allowed (max ${MAX_FILES})`);
        }
        const toUpload = accepted.slice(0, remaining);
        const next: Upload[] = toUpload.map((file) => ({
          id: crypto.randomUUID(),
          name: file.name,
          status: 'uploading',
          previewUrl: URL.createObjectURL(file),
        }));

        // Kick off uploads (after state update)
        next.forEach((u, i) => {
          api
            .uploadChatImage(toUpload[i], conversationId)
            .then((meta) => {
              setUploads((curr) =>
                curr.map((c) => (c.id === u.id ? { ...c, status: 'ready', meta } : c)),
              );
            })
            .catch((err) => {
              setUploads((curr) =>
                curr.map((c) =>
                  c.id === u.id ? { ...c, status: 'error', error: String(err?.message || err) } : c,
                ),
              );
            });
        });

        return [...prev, ...next];
      });

      if (rejections.length > 0) {
        setNotice(rejections.join('; '));
        const t = setTimeout(() => setNotice(null), 4000);
        // best effort — no cleanup mgmt for setTimeout in this branch
        void t;
      }
    },
    [vision, conversationId],
  );

  const removeUpload = useCallback((id: string) => {
    setUploads((prev) => {
      const target = prev.find((u) => u.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((u) => u.id !== id);
    });
  }, []);

  const allReady = uploads.every((u) => u.status === 'ready');
  const canSubmit = !disabled && allReady && (val.trim().length > 0 || uploads.length > 0);

  const submit = () => {
    if (!canSubmit) return;
    const attachments = uploads.map((u) => u.meta!).filter(Boolean);
    const text = val.trim();
    setVal('');
    uploads.forEach((u) => u.previewUrl && URL.revokeObjectURL(u.previewUrl));
    setUploads([]);
    onSend(text, attachments);
  };

  // Drag-and-drop on the box
  const onDragOver: React.DragEventHandler = (e) => {
    if (!vision) return;
    e.preventDefault();
    setDragActive(true);
  };
  const onDragLeave: React.DragEventHandler = () => setDragActive(false);
  const onDrop: React.DragEventHandler = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (!vision) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  return (
    <div className="cc-composer">
      <div className="cc-composer__inner">
        <CcAttachmentStrip uploads={uploads} onRemove={removeUpload} />
        <div
          className={`cc-composer__box${dragActive ? ' cc-composer__box--drag' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {vision && (
            <button
              type="button"
              className="cc-composer__attach"
              aria-label="Attach images"
              title="Attach images"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || uploads.length >= MAX_FILES}
            >
              {/* Paperclip — matches the stroke weight of Claude.ai's composer */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.75"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_MIMES.join(',')}
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files);
              e.target.value = ''; // allow re-selecting same file
            }}
          />
          <textarea
            ref={ref}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Message Clude"
            rows={1}
            disabled={disabled}
          />
          <button
            type="button"
            className="cc-composer__send"
            disabled={!canSubmit}
            onClick={submit}
          >
            Send ↗
          </button>
        </div>
        <div className="cc-composer__foot">
          <div className="cc-composer__footleft">
            <span>◈ memory · on</span>
            <span className="cc-composer__subhint">memories update in the background</span>
            {notice && <span className="cc-composer__notice">· {notice}</span>}
          </div>
          <div className="cc-composer__footright">
            <span className="cc-composer__foothint">⏎ send</span>
          </div>
        </div>
      </div>
    </div>
  );
}
