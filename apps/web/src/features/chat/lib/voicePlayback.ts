'use client';

// WhatsApp-like behavior: only one voice message plays at a time across the
// whole app, and playback stops when the chat is closed / switched.

let current: HTMLAudioElement | null = null;

export function requestExclusivePlay(audio: HTMLAudioElement): void {
  if (current && current !== audio && !current.paused) {
    try {
      current.pause();
    } catch {
      // ignore
    }
  }
  current = audio;
}

export function releaseAudio(audio: HTMLAudioElement): void {
  if (current === audio) current = null;
}

export function stopAllVoicePlayback(): void {
  if (current) {
    try {
      current.pause();
    } catch {
      // ignore
    }
    current = null;
  }
}
