'use client';

import { useState } from 'react';
import { Mic, Pause, Play, Send, Trash2 } from 'lucide-react';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { useImageUpload } from '../hooks/useImageUpload';

interface Props {
  conversationId: string;
  onRecorded: (attachmentId: string, durationMs: number, previewUrl: string) => void;
  disabled?: boolean;
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VoiceRecorder({
  conversationId,
  onRecorded,
  disabled = false,
}: Props) {
  const {
    state,
    isPaused,
    elapsedMs,
    recording,
    error,
    start,
    stop,
    pause,
    resume,
    cancel,
    reset,
    discardDraft,
  } = useVoiceRecorder(conversationId);

  const {
    uploadAudio,
    uploading,
    progress,
    error: uploadError,
  } = useImageUpload();

  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSend() {
    if (!recording) return;
    setLocalError(null);

    const file = new File([recording.blob], 'voice.webm', {
      type: recording.mimeType,
    });
    const result = await uploadAudio(file, Math.round(recording.durationMs));

    if (!result) {
      setLocalError(uploadError ?? 'Upload failed');
      return;
    }

    onRecorded(
      result.attachmentId,
      Math.round(recording.durationMs),
      recording.previewUrl,
    );
    // reset() also clears the persisted IndexedDB draft.
    reset();
  }

  if (state === 'idle') {
    return (
      <div className="flex items-center gap-1">
        {error && (
          <span className="mr-1 max-w-40 truncate text-xs text-red-600" title={error}>
            {error}
          </span>
        )}
        <button
          type="button"
          onClick={start}
          disabled={disabled}
          aria-label="Record voice message"
          className="rounded-full p-2.5 text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Mic className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    );
  }

  if (state === 'recording' || state === 'paused') {
    return (
      <div className="absolute inset-x-3 bottom-3 z-40 flex min-w-0 items-center gap-2 rounded-full bg-white px-3 py-2 shadow-lg ring-1 ring-slate-200 sm:gap-3 sm:px-4">
        <span
          className={`h-3 w-3 rounded-full ${isPaused ? 'bg-amber-500' : 'animate-pulse bg-red-500'}`}
          aria-hidden="true"
        />
        <span className="font-mono text-sm tabular-nums">
          {formatDuration(elapsedMs)}
        </span>
        <span className="text-xs text-slate-500">
          {isPaused ? 'Paused' : 'Recording…'}
        </span>
        <div className="flex-1" />
        {error && (
          <span className="hidden text-xs text-red-600 sm:block" role="alert">
            {error}
          </span>
        )}
        <button
          type="button"
          onClick={isPaused ? resume : pause}
          aria-label={isPaused ? 'Resume recording' : 'Pause recording'}
          title={isPaused ? 'Resume' : 'Pause'}
          className="rounded-full p-2 text-slate-600 hover:bg-slate-100"
        >
          {isPaused ? (
            <Play className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Pause className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={cancel}
          aria-label="Cancel recording"
          className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void stop()}
          aria-label="Stop recording"
          className="rounded-full bg-indigo-600 p-2 text-white hover:bg-indigo-500"
        >
          <Send className="h-4 w-4 rtl:-scale-x-100" />
        </button>
      </div>
    );
  }

  // Preview state
  return (
    <div className="absolute inset-x-3 bottom-3 z-40 flex min-w-0 items-center gap-2 rounded-full bg-white px-3 py-2 shadow-lg ring-1 ring-slate-200 sm:gap-3 sm:px-4">
      <audio
        src={recording?.previewUrl}
        controls
        className="h-8 min-w-0 flex-1"
      />
      <button
        type="button"
        onClick={() => void discardDraft()}
        aria-label="Discard"
        className="shrink-0 rounded-full p-2 text-slate-500 hover:bg-slate-100"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={handleSend}
        disabled={uploading}
        aria-label="Send voice message"
        className="shrink-0 rounded-full bg-indigo-600 p-2 text-white hover:bg-indigo-500 disabled:opacity-40"
      >
        {uploading ? `${progress}%` : <Send className="h-4 w-4 rtl:-scale-x-100" />}
      </button>
      {(error || localError) && (
        <span className="absolute -top-6 rounded bg-red-50 px-2 py-1 text-xs text-red-700 ltr:left-3 rtl:right-3">
          {localError ?? error}
        </span>
      )}
    </div>
  );
}
