'use client';

import {useCallback, useEffect, useState, useRef} from 'react';
import { LIMITS } from "@chatup/shared";
import { saveVoiceDraft, getVoiceDraft, clearVoiceDraft } from '@/shared/lib/drafts';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'preview';

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

export function useVoiceRecorder(conversationId: string) {
    const [state, setState] = useState<RecorderState>('idle');
    const [elapsedMs, setElapsedMs] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [recording, setRecording] = useState<VoiceRecording | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const startedAtRef = useRef<number>(0);
    const accumulatedMsRef = useRef<number>(0);
    const timerRef = useRef<number | null>(null);
    // The conversation the in-progress recording belongs to. This can differ
    // from the `conversationId` prop for a moment while switching chats.
    const activeDraftIdRef = useRef<string | null>(null);
    const stateRef = useRef<RecorderState>('idle');
    const conversationIdRef = useRef(conversationId);

    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    useEffect(() => {
        conversationIdRef.current = conversationId;
    }, [conversationId]);


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

    const totalElapsed = useCallback(() => {
        if (stateRef.current === 'paused') return accumulatedMsRef.current;
        if (stateRef.current === 'recording') {
            return accumulatedMsRef.current + (Date.now() - startedAtRef.current);
        }
        return accumulatedMsRef.current;
    }, []);

    const startTimer = useCallback(() => {
        clearTimer();
        const maxMs = LIMITS.RECORDING_MAX_SECONDS * 1000;
        timerRef.current = window.setInterval(() => {
            const delta = totalElapsed();
            setElapsedMs(delta);
            if (delta >= maxMs) {
                const recorder = mediaRecorderRef.current;
                // Auto-stop at the limit; the stop() onstop handler finalizes.
                if (recorder && recorder.state !== 'inactive') {
                    try {
                        recorder.stop();
                    } catch {
                        // ignore — onstop handles cleanup
                    }
                }
            }
        }, 100);
    }, [clearTimer, totalElapsed]);

    const stop = useCallback((): Promise<VoiceRecording | null> => {
      return new Promise((resolve) => {
        const recorder = mediaRecorderRef.current;
        if (!recorder || recorder.state === 'inactive') {
          resolve(null);
          return;
        }
        
        // Capture the paused state up-front: MediaRecorder.state is 'paused'
        // while paused, and totalElapsed() depends on live state.
        const wasPaused = recorder.state === 'paused';
        const draftId = activeDraftIdRef.current ?? conversationIdRef.current;

        recorder.onstop = () => {
          clearTimer();
          cleanupStream();

          // If paused, all audio is already in accumulatedMsRef.
          // If recording, include the final segment.
          const durationMs = wasPaused
            ? accumulatedMsRef.current
            : accumulatedMsRef.current + (Date.now() - startedAtRef.current);
          accumulatedMsRef.current = 0;
          const mimeType = recorder.mimeType || 'audio/webm';
          const blob = new Blob(chunksRef.current, { type: mimeType });
          chunksRef.current = [];
          activeDraftIdRef.current = null;

          if (blob.size === 0) {
            setState('idle');
            resolve(null);
            return;
          }

          // Persist the draft so it survives a tab close or navigation.
          // Fire-and-forget: do not block the preview on the IndexedDB write.
          void saveVoiceDraft(draftId, blob, mimeType, durationMs).catch((err) => {
            console.warn('[voice] failed to save draft', err);
          });

          const previewUrl = URL.createObjectURL(blob);
          const result: VoiceRecording = { blob, mimeType, durationMs, previewUrl };
          setRecording((prev) => {
            if (prev) URL.revokeObjectURL(prev.previewUrl);
            return result;
          });
          setElapsedMs(durationMs);
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

            // A new recording supersedes any stored preview draft.
            activeDraftIdRef.current = conversationIdRef.current;
            void clearVoiceDraft(conversationIdRef.current).catch(() => {});

            accumulatedMsRef.current = 0;
            startedAtRef.current = Date.now();
            setState('recording');
            startTimer();
            recorder.start();
        } catch (error) {
            activeDraftIdRef.current = null;
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
    }, [cleanupStream, startTimer]);

    const pause = useCallback(() => {
        const recorder = mediaRecorderRef.current;
        if (stateRef.current !== 'recording' || !recorder || recorder.state !== 'recording') return;
        try {
            accumulatedMsRef.current += Date.now() - startedAtRef.current;
            setElapsedMs(accumulatedMsRef.current);
            clearTimer();
            recorder.pause();
            setState('paused');
        } catch {
            // ignore — stay in recording state
        }
    }, [clearTimer]);

    const resume = useCallback(() => {
        const recorder = mediaRecorderRef.current;
        if (stateRef.current !== 'paused' || !recorder || recorder.state !== 'paused') return;
        try {
            startedAtRef.current = Date.now();
            recorder.resume();
            setState('recording');
            startTimer();
        } catch {
            // ignore — stay paused
        }
    }, [startTimer]);

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
        const draftId = activeDraftIdRef.current ?? conversationIdRef.current;
        void clearVoiceDraft(draftId).catch(() => {});
        // Also clear the prop conversation (covers preview drafts).
        if (draftId !== conversationIdRef.current) {
            void clearVoiceDraft(conversationIdRef.current).catch(() => {});
        }
        chunksRef.current = [];
        accumulatedMsRef.current = 0;
        activeDraftIdRef.current = null;
        cleanupStream();
        setRecording((prev) => {
          if (prev) URL.revokeObjectURL(prev.previewUrl);
          return null;
        });
        setElapsedMs(0);
        setState('idle');
      }, [clearTimer, cleanupStream]);

      const reset = useCallback(() => {
        const draftId = activeDraftIdRef.current ?? conversationIdRef.current;
        void clearVoiceDraft(draftId).catch(() => {});
        if (draftId !== conversationIdRef.current) {
            void clearVoiceDraft(conversationIdRef.current).catch(() => {});
        }
        accumulatedMsRef.current = 0;
        activeDraftIdRef.current = null;
        setRecording((prev) => {
          if (prev) URL.revokeObjectURL(prev.previewUrl);
          return null;
        });
        setElapsedMs(0);
        setState('idle');
      }, []);

      const restoreDraft = useCallback(async (): Promise<boolean> => {
        try {
          const draft = await getVoiceDraft(conversationId);
          if (!draft) return false;
          // Never clobber a live recording with a stored preview.
          if (stateRef.current === 'recording' || stateRef.current === 'paused') return false;
          setRecording((prev) => {
            if (prev) URL.revokeObjectURL(prev.previewUrl);
            return null;
          });
          const previewUrl = URL.createObjectURL(draft.blob);
          setRecording({
            blob: draft.blob,
            mimeType: draft.mimeType,
            durationMs: draft.durationMs,
            previewUrl,
          });
          setElapsedMs(draft.durationMs);
          setState('preview');
          return true;
        } catch (err) {
          console.warn('[voice] failed to restore draft', err);
          return false;
        }
      }, [conversationId]);

      const discardDraft = useCallback(async () => {
        try {
          await clearVoiceDraft(conversationId);
        } catch (err) {
          console.warn('[voice] failed to clear draft', err);
        }
        cancel();
      }, [cancel, conversationId]);

      // Restore this conversation's preview draft on mount / chat switch.
      useEffect(() => {
        let cancelled = false;
        // If we arrived here with an in-progress recording for another chat,
        // finalize it silently as that chat's draft instead of losing it.
        const pendingRecorder = mediaRecorderRef.current;
        const pendingDraftId = activeDraftIdRef.current;
        const wasActive =
            pendingRecorder &&
            pendingRecorder.state !== 'inactive' &&
            pendingDraftId &&
            pendingDraftId !== conversationId;

        const load = async () => {
            if (wasActive && pendingRecorder && pendingDraftId) {
                await new Promise<void>((resolve) => {
                    const rec = pendingRecorder;
                    // Freeze elapsed into accumulated so duration is right
                    // even if we were paused.
                    if (stateRef.current === 'recording') {
                        accumulatedMsRef.current += Date.now() - startedAtRef.current;
                    }
                    const durationMs = accumulatedMsRef.current;
                    const mimeType = rec.mimeType || 'audio/webm';
                    rec.onstop = () => {
                        clearTimer();
                        cleanupStream();
                        const blob = new Blob(chunksRef.current, { type: mimeType });
                        chunksRef.current = [];
                        accumulatedMsRef.current = 0;
                        activeDraftIdRef.current = null;
                        if (blob.size > 0) {
                            void saveVoiceDraft(pendingDraftId, blob, mimeType, durationMs).catch((err) => {
                                console.warn('[voice] failed to save draft', err);
                            });
                        }
                        if (!cancelled) setState('idle');
                        resolve();
                    };
                    try {
                        rec.stop();
                    } catch {
                        resolve();
                    }
                });
            }
            if (cancelled) return;
            // Clear stale in-memory preview, then load this chat's draft.
            setRecording((prev) => {
              if (prev) URL.revokeObjectURL(prev.previewUrl);
              return null;
            });
            setElapsedMs(0);
            setError(null);
            if (!wasActive) setState('idle');
            try {
              const draft = await getVoiceDraft(conversationId);
              if (cancelled || !draft) return;
              // Don't clobber a recording the user just started.
              if (stateRef.current === 'recording' || stateRef.current === 'paused') return;
              const previewUrl = URL.createObjectURL(draft.blob);
              setRecording((prev) => {
                if (prev) URL.revokeObjectURL(prev.previewUrl);
                return {
                  blob: draft.blob,
                  mimeType: draft.mimeType,
                  durationMs: draft.durationMs,
                  previewUrl,
                };
              });
              setElapsedMs(draft.durationMs);
              setState('preview');
            } catch (err) {
              console.warn('[voice] failed to restore draft', err);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
      }, [conversationId, clearTimer, cleanupStream]);

      // Cleanup on unmount: persist an in-progress recording as a draft
      // instead of dropping it, then release hardware.
      useEffect(() => {
        return () => {
          const recorder = mediaRecorderRef.current;
          const draftId = activeDraftIdRef.current ?? conversationIdRef.current;
          if (recorder && recorder.state !== 'inactive') {
            if (stateRef.current === 'recording') {
                accumulatedMsRef.current += Date.now() - startedAtRef.current;
            }
            const durationMs = accumulatedMsRef.current;
            const mimeType = recorder.mimeType || 'audio/webm';
            recorder.onstop = () => {
              cleanupStream();
              const blob = new Blob(chunksRef.current, { type: mimeType });
              chunksRef.current = [];
              if (blob.size > 0) {
                void saveVoiceDraft(draftId, blob, mimeType, durationMs).catch(() => {});
              }
            };
            try {
              recorder.stop();
            } catch {
              cleanupStream();
            }
          } else {
            clearTimer();
            cleanupStream();
          }
          // NB: preview object URLs are revoked by the component's own
          // restore effect / cancel / reset; revoking here would break
          // StrictMode remounts that expect the draft to survive.
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      return {
        state,
        isPaused: state === 'paused',
        isRecording: state === 'recording' || state === 'paused',
        elapsedMs,
        recording,
        error,
        start,
        stop,
        pause,
        resume,
        cancel,
        reset,
        restoreDraft,
        discardDraft,
      };
}
