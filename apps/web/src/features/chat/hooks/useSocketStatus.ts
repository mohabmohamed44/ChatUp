'use client';

import { useEffect, useState } from 'react';
import { getSocket } from '@/shared/lib/socket';

/** Live socket connection state, used to show a reconnecting banner. */
export function useSocketStatus(): { isConnected: boolean } {
  const [socket] = useState(getSocket);
  const [isConnected, setIsConnected] = useState(socket.connected);

  useEffect(() => {
    function onConnect() {
      setIsConnected(true);
    }

    function onDisconnect() {
      setIsConnected(false);
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setIsConnected(socket.connected);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket]);

  return { isConnected };
}
