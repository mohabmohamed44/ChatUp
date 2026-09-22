'use client';

import {useCallback, useEffect, useState, useRef} from 'react';
import { LIMITS } from "@chatup/shared";

export type RecorderState = 'idle' | 'recording' | 'preview';

export type VoiceRecording = {
    blob: Blob;
    mimeType: string;
    durationMs: number;
    previewUrl: string;
};

function pickMimeType(): string {
    const candidates = [
        'audio/webm;codecs:opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs:opus'
    ];

    if (typeof MediaRecorder === 'undefined') return '';
    for (const type of candidates) {
        if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
}

export function useVoiceRecorder() {
    const [state, setState] = useState<RecorderState>('idle');
    const [elapsedMs, setElapsedMs] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [recording, setRecording] = useState<VoiceRecording | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const startedAtRef = useRef<number>(0);
    const timerRef = useRef<number | null>(null);


    const cleanupStream = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }
    }, []);

    const clearTimer = useCallback(() => {
        if (timerRef.current !== null) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const stop = useCallback((): Promise<VoiceRecording | null> => {
        return new Promise((resolve) => {
          const recorder = mediaRecorderRef.current;
          if (!recorder || recorder.state === 'inactive') {
            resolve(null);
            return;
          }
    
          recorder.onstop = () => {
            clearTimer();
            cleanupStream();
    
            const durationMs = Date.now() - startedAtRef.current;
            const mimeType = recorder.mimeType || 'audio/webm';
            const blob = new Blob(chunksRef.current, { type: mimeType });
            chunksRef.current = [];
    
            if (blob.size === 0) {
              setState('idle');
              resolve(null);
              return;
            }
    
            const previewUrl = URL.createObjectURL(blob);
            const result: VoiceRecording = { blob, mimeType, durationMs, previewUrl };
            setRecording(result);
            setState('preview');
            resolve(result);
          };
    
          recorder.stop();
        });
      }, [clearTimer, cleanupStream]);
    
    const start = useCallback(async() => {
        setError(null);
        setRecording((prev) => {
            if (prev) URL.revokeObjectURL(prev.previewUrl);
            return null;
        });
        setElapsedMs(0);

        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            setError('Recording is not supported in this browser');
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({audio: true});
            streamRef.current = stream;

            const mimeType = pickMimeType();
            const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            mediaRecorderRef.current = recorder;

            chunksRef.current = [];
            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) chunksRef.current.push(event.data);
            };

            const maxMs = LIMITS.RECORDING_MAX_SECONDS * 1000;
            startedAtRef.current = Date.now();
            setState('recording');

            timerRef.current = window.setInterval(() => {
                const now = Date.now();
                const delta = now - startedAtRef.current;
                setElapsedMs(delta);
                if (delta >= maxMs) {
                    void stop();
                }
            }, 100);
            recorder.start();
        } catch (error) {
            cleanupStream();
            const name = error instanceof Error ? error.name : '';
            if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
                setError('Microphone access denied');
            } else if (name === 'NotFoundError') {
                setError('No microphone found');
            } else {
                setError('Failed to start recording');
            }
        } 
    }, [cleanupStream, stop]);

    const cancel = useCallback(() => {
        clearTimer();
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state !== 'inactive') {
          recorder.onstop = null;
          try {
            recorder.stop();
          } catch {
            // ignore
          }
        }
        chunksRef.current = [];
        cleanupStream();
        setRecording((prev) => {
          if (prev) URL.revokeObjectURL(prev.previewUrl);
          return null;
        });
        setElapsedMs(0);
        setState('idle');
      }, [clearTimer, cleanupStream]);
    
      const reset = useCallback(() => {
        setRecording((prev) => {
          if (prev) URL.revokeObjectURL(prev.previewUrl);
          return null;
        });
        setElapsedMs(0);
        setState('idle');
      }, []);
    
      // Cleanup on unmount
      useEffect(() => {
        return () => {
          clearTimer();
          cleanupStream();
          if (recording?.previewUrl) URL.revokeObjectURL(recording.previewUrl);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
    
      return {
        state,
        elapsedMs,
        recording,
        error,
        start,
        stop,
        cancel,
        reset,
      };
}