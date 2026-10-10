'use client';

import { useEffect } from 'react';

/**
 * Registers the app-shell service worker (public/sw.js). Runs once in the
 * browser; failures (private mode, unsupported browser) are ignored so the
 * app works without offline caching.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Offline caching is best-effort; the app works without it.
      });
    };
    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
