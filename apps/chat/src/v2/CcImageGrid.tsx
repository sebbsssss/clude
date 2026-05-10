import { useEffect, useState } from 'react';
import type { AttachmentMeta } from '../lib/types';

export function CcImageGrid({ images }: { images: AttachmentMeta[] }) {
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!images.length) return null;
  return (
    <>
      <div className="cc-imggrid" data-count={Math.min(images.length, 8)}>
        {images.map((img, i) => (
          <button
            key={`${img.storage_path}-${i}`}
            type="button"
            className="cc-imggrid__cell"
            onClick={() => setOpen(i)}
          >
            <img src={img.url} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      {open !== null && (
        <div
          className="cc-lightbox"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
        >
          <img src={images[open].url} alt="" />
        </div>
      )}
    </>
  );
}
