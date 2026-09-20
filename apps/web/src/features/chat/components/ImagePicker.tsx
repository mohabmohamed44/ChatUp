'use client';

import { useRef, useState } from 'react';
import { LIMITS } from '@chatup/shared';
import { ImageIcon, X } from 'lucide-react';
import { useImageUpload } from '../hooks/useImageUpload';

interface Props {
  onUploaded: (attachmentId: string, localPreviewUrl: string) => void;
  disabled?: boolean;
}

export function ImagePicker({ onUploaded, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploading, progress, error, upload, reset } = useImageUpload();
  const [preview, setPreview] = useState<string | null>(null);

  function openPicker() {
    inputRef.current?.click();
  }

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please choose an image file');
      return;
    }

    const MAX = LIMITS.IMAGE_MAX_BYTES;
    if (file.size > MAX) {
      alert(`Image must be under ${Math.round(MAX / (1024 * 1024))} MB`);
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setPreview(previewUrl);

    const result = await upload(file);

    if (result) {
      // Pass the preview URL up so the chat bubble renders instantly.
      // Do NOT revoke it here — the optimistic message owns it now.
      onUploaded(result.attachmentId, previewUrl);
      setPreview(null);
      reset();
    } else {
      // Upload failed — clean up the local URL and close the modal.
      URL.revokeObjectURL(previewUrl);
      setPreview(null);
      reset();
    }

    if (inputRef.current) inputRef.current.value = '';
  }

  function cancel() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    reset();
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled || uploading}
        className="rounded-full p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
        aria-label="Attach image"
      >
        <ImageIcon className="h-5 w-5" />
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleChange}
        className="hidden"
      />

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium">Uploading image…</p>
              <button onClick={cancel} className="p-1" aria-label="Cancel">
                <X className="h-4 w-4" />
              </button>
            </div>
            <img
              src={preview}
              alt="preview"
              className="mb-3 max-h-60 w-full rounded object-contain"
            />
            <div className="h-2 w-full overflow-hidden rounded bg-slate-200">
              <div
                className="h-full bg-violet-600 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}