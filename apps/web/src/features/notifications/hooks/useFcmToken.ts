'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { onMessage, onRegistered, register, type MessagePayload } from 'firebase/messaging';
import { getMessagingInstance } from '@/shared/lib/firebase/firebase';
import { apiFetch } from '@/shared/lib/api';

interface UseFcmTokenOptions {
  onForegroundMessage?: (payload: MessagePayload) => void;
}

type PermissionState = NotificationPermission | 'unsupported';

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function useFcmToken(options: UseFcmTokenOptions = {}) {
  const { onForegroundMessage } = options;
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Start as 'default' on server and client; real value is set in an effect
  // (avoids a hydration mismatch).
  const [permission, setPermission] = useState<PermissionState>('default');

  const onForegroundMessageRef = useRef(onForegroundMessage);
  useEffect(() => {
    onForegroundMessageRef.current = onForegroundMessage;
  }, [onForegroundMessage]);

  const lastUploaded = useRef<string | null>(null);
  const registeredUnsub = useRef<(() => void) | null>(null);

  const obtainToken = useCallback(async () => {
    const m = await getMessagingInstance();
    if (!m) throw new Error('Push messaging is not supported in this browser');

    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    if (!vapidKey) throw new Error('Missing NEXT_PUBLIC_FIREBASE_VAPID_KEY');

    const swRegistration = await navigator.serviceWorker.register('/sw.js');
    // If the worker install fails (for example precache errors), `ready` never
    // resolves. Fail loudly instead of hanging forever.
    await withTimeout(
      navigator.serviceWorker.ready,
      10_000,
      'Service worker did not activate. Check DevTools > Application > Service Workers for install errors.',
    );

    // FID-based identity: the server sends pushes via `fids`
    // (FidMulticastMessage), so upload the Firebase Installation ID — NOT a
    // legacy registration token. `register()` guarantees the `onRegistered`
    // callback fires with the current FID (also on FID rotation/refresh).
    // The value is stored in the Session `fid` column, overwriting any legacy
    // value (the server dedups it across sessions).
    registeredUnsub.current?.();
    const fid = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        registeredUnsub.current?.();
        registeredUnsub.current = null;
        reject(new Error('No FCM installation ID returned'));
      }, 10_000);
      registeredUnsub.current = onRegistered(m, (installationId) => {
        clearTimeout(timeout);
        resolve(installationId);
      });
      void register(m, {
        vapidKey,
        serviceWorkerRegistration: swRegistration,
      }).catch((err: unknown) => {
        clearTimeout(timeout);
        reject(err instanceof Error ? err : new Error('FCM registration failed'));
      });
    });
    registeredUnsub.current?.();
    registeredUnsub.current = null;
    setToken(fid);

    if (lastUploaded.current !== fid) {
      lastUploaded.current = fid;
      await apiFetch('/auth/profile', {
        method: 'PATCH',
        body: { fid },
      }).catch((uploadError: unknown) => {
        // Allow a retry on the next call if the upload failed.
        lastUploaded.current = null;
        console.warn('Failed to upload FCM registration', uploadError);
      });
    }
  }, []);

  // Call ONLY from a click handler (iOS requires a user gesture).
  const enable = useCallback(async () => {
    try {
      setError(null);
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') {
        setError('Notification permission was not granted');
        return;
      }
      await obtainToken();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to enable notifications');
    }
  }, [obtainToken]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const supported =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'Notification' in window &&
      'PushManager' in window;

    if (!supported) {
      setPermission('unsupported');
      return;
    }
    setPermission(Notification.permission);

    void (async () => {
      const m = await getMessagingInstance();
      if (!m) return;

      const unsub = onMessage(m, (payload) => {
        onForegroundMessageRef.current?.(payload);
      });
      // If we unmounted while awaiting, unsubscribe immediately (no leak).
      if (cancelled) {
        unsub();
        return;
      }
      unsubscribe = unsub;

      if (Notification.permission === 'granted') {
        try {
          await obtainToken();
        } catch (e: unknown) {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : 'Failed to register for push');
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [obtainToken]);

  return { token, error, permission, supported: permission !== 'unsupported', enable };
}