'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Attachment } from '@chatup/shared';
import { getMediaUrl } from '../api';
import { ImageLightbox } from './ImageLightbox';

interface Props {
  attachment: Attachment;
}

export function ImageMessage({ attachment }: Props) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [src, setSrc] = useState<string | null>(attachment.url);
  const refreshed = useRef(false);

  useEffect(() => {
    setSrc(attachment.url);
    refreshed.current = false;
    setLoaded(false);
  }, [attachment.url, attachment.id]);

  const handleError = useCallback(async () => {
    if (refreshed.current) return;
    refreshed.current = true;
    try {
      const fresh = await getMediaUrl(attachment.id);
      if (fresh.url) setSrc(fresh.url);
    } catch {
      // keep existing src; fallback UI will show if still broken
    }
  }, [attachment.id]);

  if (!src) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded bg-slate-100 text-xs text-slate-500">
        Image unavailable
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block overflow-hidden rounded-lg"
      >
        {!loaded && (
          <div className="flex h-40 w-60 items-center justify-center bg-slate-100 text-xs text-slate-500">
            Loading…
          </div>
        )}
        <img
          src={src}
          alt="Shared image"
          onLoad={() => setLoaded(true)}
          onError={handleError}
          className={`max-h-72 max-w-xs rounded-lg object-cover ${loaded ? 'block' : 'hidden'}`}
        />
      </button>

      {open && (
        <ImageLightbox
          url={src}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}