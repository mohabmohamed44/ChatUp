'use client';

import { LIMITS } from '@chatup/shared';
import { useCallback, useState } from 'react';

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const entry = document.cookie.split('; ').find((part) => part.startsWith(`${name}=`));
  if (!entry) return undefined;
  return decodeURIComponent(entry.slice(name.length + 1));
}

export type UploadState = {
  uploading: boolean;
  progress: number;
  error: string | null;
};

type UploadResult = { attachmentId: string };

/**
 * Uploads a file via XHR so upload progress is available.
 * fetch() does not expose upload progress, which is why XHR is used here.
 */
function uploadWithProgress(
  file: File,
  kind: 'image' | 'audio',
  durationMs: number | undefined,
  onProgress: (percent: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    if (durationMs !== undefined) {
      form.append('durationMs', String(durationMs));
    }

    const xhr = new XMLHttpRequest();
    // Use relative /api via Next.js rewrites (same as apiFetch) to avoid CORS
    // and ensure session cookies are sent same-origin.
    xhr.open('POST', `/api/media/${kind}`);
    xhr.withCredentials = true;
    const csrfToken = readCookie(LIMITS.CSRF_COOKIE_NAME);
    if (csrfToken) {
      xhr.setRequestHeader(LIMITS.CSRF_HEADER_NAME, csrfToken);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText) as {
            attachment: { id: string };
          };
          resolve({ attachmentId: parsed.attachment.id });
        } catch {
          reject(new Error('Invalid upload response'));
        }
        return;
      }

      let message = `Upload failed (${xhr.status})`;
      try {
        const parsed = JSON.parse(xhr.responseText) as {
          error?: { message?: string };
        };
        message = parsed?.error?.message ?? message;
      } catch {
        // Response was not JSON — keep the generic message
      }
      reject(new Error(message));
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));

    xhr.send(form);
  });
}

export function useImageUpload() {
  const [state, setState] = useState<UploadState>({
    uploading: false,
    progress: 0,
    error: null,
  });

  /**
   * Uploads an image. Returns `{ attachmentId }` on success, `null` on failure.
   * Progress and error state are exposed through the hook's return value.
   */
  const upload = useCallback(
    async (file: File): Promise<UploadResult | null> => {
      setState({ uploading: true, progress: 0, error: null });

      try {
        const result = await uploadWithProgress(file, 'image', undefined, (percent) => {
          setState((prev) => ({ ...prev, progress: percent }));
        });

        setState({ uploading: false, progress: 100, error: null });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        setState({ uploading: false, progress: 0, error: message });
        return null;
      }
    },
    [],
  );

  /**
   * Uploads audio. Same shape as `upload`, but requires `durationMs` because the
   * backend enforces a maximum recording length.
   */
  const uploadAudio = useCallback(
    async (file: File, durationMs: number): Promise<UploadResult | null> => {
      setState({ uploading: true, progress: 0, error: null });

      try {
        const result = await uploadWithProgress(file, 'audio', durationMs, (percent) => {
          setState((prev) => ({ ...prev, progress: percent }));
        });

        setState({ uploading: false, progress: 100, error: null });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        setState({ uploading: false, progress: 0, error: message });
        return null;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setState({ uploading: false, progress: 0, error: null });
  }, []);

  return { ...state, upload, uploadAudio, reset };
}