'use client';

import { useEffect, useState } from 'react';
import { WifiOff, Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

const DEBOUNCE_MS = 1500;

export function ConnectionBanner() {
  const { state } = useNetworkStatus();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (state === 'online') {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const isOffline = state === 'offline';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-hidden={!visible}
      className={cn(
        'overflow-hidden transition-[max-height] duration-300 ease-out',
        visible ? 'max-h-12' : 'max-h-0',
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center gap-2 px-4 py-2 text-sm text-white',
          isOffline ? 'bg-red-600' : 'bg-amber-600',
        )}
      >
        {isOffline ? (
          <>
            <WifiOff className="h-4 w-4" aria-hidden="true" />
            <span>No internet connection</span>
          </>
        ) : (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>Reconnecting…</span>
          </>
        )}
      </div>
    </div>
  );
}