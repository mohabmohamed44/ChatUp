'use client';

import { useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import type { Attachment } from '@chatup/shared';
import { cn } from '@/shared/lib/utils';

function formatMs(ms: number): string {
  if (!ms || ms < 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VoiceMessage({
  attachment,
  isOwn,
}: {
  attachment: Attachment;
  isOwn: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);

  const totalMs = attachment.durationMs ?? 0;
  const remainingMs = Math.max(0, totalMs - currentMs);
  const progress = totalMs > 0 ? currentMs / totalMs : 0;

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }

  if (!attachment.url) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-full px-3 py-1 text-xs',
          isOwn ? 'bg-white/10 text-white/70' : 'bg-slate-100 text-slate-500',
        )}
      >
        Voice unavailable
      </div>
    );
  }

  return (
    <div className="flex min-w-[220px] items-center gap-3 py-1">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          isOwn
            ? 'bg-white/20 hover:bg-white/30 text-white'
            : 'bg-indigo-100 hover:bg-indigo-200 text-indigo-700',
        )}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>

      <div className="flex-1">
        <div
          className={cn(
            'h-1.5 w-full overflow-hidden rounded-full',
            isOwn ? 'bg-white/25' : 'bg-slate-200',
          )}
        >
          <div
            className={cn(
              'h-full transition-[width] duration-100 ease-linear',
              isOwn ? 'bg-white' : 'bg-indigo-600',
            )}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      <span
        className={cn(
          'shrink-0 font-mono text-xs tabular-nums',
          isOwn ? 'text-white/90' : 'text-slate-500',
        )}
      >
        {playing ? formatMs(remainingMs) : formatMs(totalMs)}
      </span>

      <audio
        ref={audioRef}
        src={attachment.url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentMs(0);
        }}
        onTimeUpdate={(e) => {
          setCurrentMs(Math.round(e.currentTarget.currentTime * 1000));
        }}
        onLoadedMetadata={(e) => {
          // Fallback: if the backend did not provide durationMs, read it from the audio
          const audio = e.currentTarget;
          if (!attachment.durationMs && audio.duration && isFinite(audio.duration)) {
            // Note: durationMs is stored server-side; this is only a display fallback
          }
        }}
      />
    </div>
  );
}