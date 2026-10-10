'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

/**
 * Chrome/Edge install banner. Safari and Firefox don't fire
 * beforeinstallprompt — there the PWA installs via share menu /
 * "Add to Home Screen" instead.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!deferred || dismissed) return null;

  return (
    <div className="fixed bottom-4 end-4 z-50 rounded-lg bg-slate-900 px-4 py-3 text-white shadow-lg">
      <p className="text-sm">Install ChatUp for a better experience</p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => {
            void deferred.prompt();
            setDismissed(true);
          }}
          className="rounded bg-white px-3 py-1 text-sm text-slate-900"
        >
          Install
        </button>
        <button onClick={() => setDismissed(true)} className="rounded px-3 py-1 text-sm opacity-70">
          Later
        </button>
      </div>
    </div>
  );
}
