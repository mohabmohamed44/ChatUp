'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Attachment } from '@chatup/shared';
import { getMediaUrl } from '../api';
import { ImageLightbox } from './ImageLightbox';

export function ImageMessage({ attachment }: { attachment: Attachment }) {
  const [src, setSrc] = useState(attachment.url);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const refreshed = useRef(false);

  useEffect(() => {
    setSrc(attachment.url);
    refreshed.current = false;
  }, [attachment.url, attachment.id]);

  const onError = useCallback(async () => {
    if (refreshed.current) return;
    refreshed.current = true;
    try {
      const fresh = await getMediaUrl(attachment.id);
      if (fresh.url) setSrc(fresh.url);
    } catch {
      // image stays broken; no further retry
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
          <div className="flex h-40 w-60 items-center justify-center bg-black/10 text-xs">
            Loading…
          </div>
        )}
        <img
          src={src}
          alt="Shared image"
          onLoad={() => setLoaded(true)}
          onError={onError}
          className={`max-h-72 w-full rounded-lg object-cover ${loaded ? 'block' : 'hidden'}`}
        />
      </button>

      {open && <ImageLightbox url={src} onClose={() => setOpen(false)} />}
    </>
  );
}