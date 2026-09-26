'use client';

import { useEffect, useState } from 'react';
import { getSocket } from '@/shared/lib/socket';

export type NetworkState = 'online' | 'offline' | 'reconnecting';

export function useNetworkStatus() {
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [socketConnected, setSocketConnected] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    function onOnline() { setBrowserOnline(true); }
    function onOffline() { setBrowserOnline(false); }

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const socket = getSocket();

    function onConnect() {
      setSocketConnected(true);
      setReconnecting(false);
    }
    function onDisconnect() {
      setSocketConnected(false);
    }
    function onReconnectAttempt() {
      setReconnecting(true);
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect_attempt', onReconnectAttempt);

    // Initial state
    setSocketConnected(socket.connected);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
    };
  }, []);

  // Combine: offline if browser is offline OR socket is disconnected
  let state: NetworkState = 'online';
  if (!browserOnline) state = 'offline';
  else if (!socketConnected) state = 'reconnecting';

  return { state, browserOnline, socketConnected };
}