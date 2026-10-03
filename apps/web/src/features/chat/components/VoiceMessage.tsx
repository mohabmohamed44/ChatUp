'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Play, Pause } from 'lucide-react';
import type { Attachment } from '@chatup/shared';
import { cn } from '@/shared/lib/utils';
import {
  releaseAudio,
  requestExclusivePlay,
  stopAllVoicePlayback,
} from '../lib/voicePlayback';

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
  playedAt,
  playedTitle,
  onPlayed,
}: {
  attachment: Attachment;
  isOwn: boolean;
  playedAt: string | null;
  playedTitle?: string;
  onPlayed?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const hasReported = useRef(playedAt !== null);

  // WhatsApp-style: incoming unplayed notes show a blue mic. After listen
  // (or for the sender once the recipient has listened) it turns muted.
  const played = playedAt !== null;

  useEffect(() => {
    if (playedAt) hasReported.current = true;
  }, [playedAt]);

  const totalMs = attachment.durationMs ?? 0;
  const remainingMs = Math.max(0, totalMs - currentMs);
  const progress = totalMs > 0 ? currentMs / totalMs : 0;

  function reportPlayed() {
    if (hasReported.current || isOwn) return;
    hasReported.current = true;
    onPlayed?.();
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      // Pause any other voice message before starting this one (WhatsApp behavior).
      requestExclusivePlay(audio);
      void audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }

  // Stop playback when the message unmounts (chat closed or conversation
  // switched) so audio never keeps playing in the background.
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audio) {
        try {
          audio.pause();
        } catch {
          // ignore
        }
        releaseAudio(audio);
      } else {
        stopAllVoicePlayback();
      }
    };
  }, []);

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
      <span
        title={played ? playedTitle ?? 'Played' : undefined}
        aria-label={played ? playedTitle ?? 'Played' : undefined}
        className="inline-flex shrink-0 items-center"
      >
        <Mic
          className={cn(
            'h-4 w-4',
            isOwn ? (played ? 'text-sky-300' : 'text-white/60') : 'text-slate-400',
          )}
          aria-hidden="true"
        />
      </span>
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
              isOwn ? (played ? 'bg-sky-300' : 'bg-white') : 'bg-indigo-600',
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
        onPlay={(e) => {
          // Covers native controls / programmatic play: keep playback exclusive.
          requestExclusivePlay(e.currentTarget);
          setPlaying(true);
          reportPlayed();
        }}
        onPause={(e) => {
          releaseAudio(e.currentTarget);
          setPlaying(false);
        }}
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