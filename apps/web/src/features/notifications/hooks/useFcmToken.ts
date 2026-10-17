'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getApp } from 'firebase/app';
import { deleteInstallations, getInstallations } from 'firebase/installations';
import {
  deleteToken,
  onMessage,
  onRegistered,
  register,
  type Messaging,
  type MessagePayload,
} from 'firebase/messaging';
import { getMessagingInstance } from '@/shared/lib/firebase/firebase';
import { apiFetch } from '@/shared/lib/api';

interface UseFcmTokenOptions {
  onForegroundMessage?: (payload: MessagePayload) => void;
}

type PermissionState = NotificationPermission | 'unsupported';

// The reset-once path below must never run in a loop: mark it per page load
// (module scope survives across mounts within the same page load).
let fcmResetAttempted = false;

/**
 * Request FCM registration and wait for the resulting Firebase Installation ID
 * (FID). Self-contained: it owns its timeout and `onRegistered` subscription,
 * so it can be safely retried by the stale-state reset path below.
 */
async function obtainFid(
  m: Messaging,
  swRegistration: ServiceWorkerRegistration,
  vapidKey: string,
): Promise<string> {
  let unregister: (() => void) | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unregister?.();
        unregister = undefined;
        reject(new Error('No FCM installation ID returned'));
      }, 10_000);
      unregister = onRegistered(m, (installationId) => {
        clearTimeout(timeout);
        resolve(installationId);
      });
      void register(m, {
        vapidKey,
        serviceWorkerRegistration: swRegistration,
      }).catch((err: unknown) => {
        clearTimeout(timeout);
        unregister = undefined;
        reject(err instanceof Error ? err : new Error('FCM registration failed'));
      });
    });
  } finally {
    unregister?.();
  }
}

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
    let fid: string;
    try {
      fid = await obtainFid(m, swRegistration, vapidKey);
    } catch (err) {
      if (fcmResetAttempted) throw err;
      fcmResetAttempted = true;
      // A stale Firebase installation/subscription (e.g. created under an
      // older config, another project, or a rotated VAPID key) surfaces as a
      // 401 from fcmregistrations.googleapis.com. Reset the local Firebase
      // state ONCE per page load and retry — never loop, never rethrow past
      // the single retry.
      await deleteToken(m).catch(() => {});
      await deleteInstallations(getInstallations(getApp())).catch(() => {});
      fid = await obtainFid(m, swRegistration, vapidKey);
    }
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
      console.warn('[push] registration failed', e);
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
            console.warn('[push] registration failed', e);
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
