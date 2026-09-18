'use client';

import { useEffect, useState } from 'react';
import { PRESENCE_EVENTS, type PresenceStatus, type PresenceUpdate } from '@chatup/shared';
import { getSocket } from '@/shared/lib/socket';

export type PresenceMap = Record<string, PresenceStatus>;

/**
 * Tracks online/offline status for the given users. Requests a snapshot on
 * connect and then follows live `presence:update` events.
 */
export function usePresence(userIds: string[]): PresenceMap {
  const [socket] = useState(getSocket);
  const [statuses, setStatuses] = useState<PresenceMap>({});

  const key = [...new Set(userIds)].sort().join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) return;

    function onUpdate(update: PresenceUpdate) {
      setStatuses((prev) =>
        prev[update.userId] === update.status ? prev : { ...prev, [update.userId]: update.status },
      );
    }

    function requestSnapshot() {
      socket.emit(PRESENCE_EVENTS.snapshot, ids);
    }

    socket.on(PRESENCE_EVENTS.update, onUpdate);
    socket.on('connect', requestSnapshot);
    if (socket.connected) requestSnapshot();

    return () => {
      socket.off(PRESENCE_EVENTS.update, onUpdate);
      socket.off('connect', requestSnapshot);
    };
  }, [key, socket]);

  return statuses;
}
