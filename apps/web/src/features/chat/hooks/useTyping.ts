'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LIMITS, PRESENCE_EVENTS, type TypingUpdatePayload } from '@chatup/shared';
import { getSocket } from '@/shared/lib/socket';

/**
 * Typing indicators for a conversation. Outgoing events are throttled and
 * incoming indicators expire automatically if the other side stops typing.
 */
export function useTyping(conversationId: string, currentUserId: string) {
  const [socket] = useState(getSocket);
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const lastEmitRef = useRef(0);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    setTypingUserIds([]);
  }, [conversationId]);

  useEffect(() => {
    const timers = timersRef.current;

    function clearTimer(userId: string) {
      const timer = timers.get(userId);
      if (timer) {
        clearTimeout(timer);
        timers.delete(userId);
      }
    }

    function onUpdate(payload: TypingUpdatePayload) {
      if (payload.conversationId !== conversationId) return;
      if (payload.userId === currentUserId) return;

      setTypingUserIds((prev) => {
        if (payload.isTyping) {
          return prev.includes(payload.userId) ? prev : [...prev, payload.userId];
        }
        return prev.filter((id) => id !== payload.userId);
      });

      clearTimer(payload.userId);
      if (payload.isTyping) {
        const timer = setTimeout(() => {
          timers.delete(payload.userId);
          setTypingUserIds((prev) => prev.filter((id) => id !== payload.userId));
        }, LIMITS.TYPING_INDICATOR_TTL_MS);
        timers.set(payload.userId, timer);
      }
    }

    socket.on(PRESENCE_EVENTS.typingUpdate, onUpdate);

    return () => {
      socket.off(PRESENCE_EVENTS.typingUpdate, onUpdate);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, [conversationId, currentUserId, socket]);

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastEmitRef.current < LIMITS.TYPING_EMIT_THROTTLE_MS) return;
    lastEmitRef.current = now;
    socket.emit(PRESENCE_EVENTS.typingStart, { conversationId });
  }, [conversationId, socket]);

  return { typingUserIds, notifyTyping };
}
