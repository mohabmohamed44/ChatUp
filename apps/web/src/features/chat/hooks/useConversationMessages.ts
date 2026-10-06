'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MESSAGE_EVENTS,
  type Ack,
  type ClientMessageStatus,
  type Message,
  type MessageDeliveryStatus,
  type MessagePlayedUpdate,
  type MessageStatusUpdate,
  type Page,
} from '@chatup/shared';
import { getSocket } from '@/shared/lib/socket';
import { fetchMessageHistory } from '../api';
import {
  editMessage as editMessageRequest,
  deleteMessage as deleteMessageRequest,
  markPlayed as markPlayedRequest,
} from '../api';
import { cacheMessages, getCachedMessages } from '@/shared/lib/cache';

const PAGE_SIZE = 30;
const SYNC_PAGE_LIMIT = 50;
const MAX_SYNC_ROUNDS = 5;
const OPTIMISTIC_SEQUENCE = 0n;

/**
 * A message as held by the client. Server messages always carry a delivery
 * status; optimistic messages may still be pending or failed.
 */
export type ChatMessage = Omit<Message, 'status'> & { status: ClientMessageStatus };

const STATUS_RANK: Record<ClientMessageStatus, number> = {
  pending: 0,
  failed: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

function sequenceValue(sequence: string): bigint {
  try {
    return BigInt(sequence);
  } catch {
    return OPTIMISTIC_SEQUENCE;
  }
}

function isConfirmed(message: ChatMessage): boolean {
  return sequenceValue(message.sequence) > OPTIMISTIC_SEQUENCE;
}

/**
 * Confirmed messages are ordered by sequence. Optimistic messages have no
 * sequence yet, so they stay at the end in insertion order.
 */
function sortMessages(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => {
    const aSequence = sequenceValue(a.sequence);
    const bSequence = sequenceValue(b.sequence);
    if (aSequence === OPTIMISTIC_SEQUENCE && bSequence === OPTIMISTIC_SEQUENCE) return 0;
    if (aSequence === OPTIMISTIC_SEQUENCE) return 1;
    if (bSequence === OPTIMISTIC_SEQUENCE) return -1;
    return aSequence < bSequence ? -1 : aSequence > bSequence ? 1 : 0;
  });
}

function withHighestStatus(next: ChatMessage, previous: ChatMessage | undefined): ChatMessage {
  if (previous && STATUS_RANK[previous.status] > STATUS_RANK[next.status]) {
    return { ...next, status: previous.status };
  }
  return next;
}

/**
 * Deduplicates by id and clientId (replacing optimistic entries) and never
 * downgrades a status that already progressed further.
 */
function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  const idByClientId = new Map<string, string>();

  for (const message of current) {
    byId.set(message.id, message);
    if (message.clientId) idByClientId.set(message.clientId, message.id);
  }

  for (const message of incoming) {
    if (message.clientId) {
      const previousId = idByClientId.get(message.clientId);
      if (previousId && previousId !== message.id) byId.delete(previousId);
      idByClientId.set(message.clientId, message.id);
    }
    byId.set(message.id, withHighestStatus(message, byId.get(message.id)));
  }

  return sortMessages([...byId.values()]);
}

function toCacheable(messages: ChatMessage[]): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    if (m.status === 'pending' || m.status === 'failed') continue;
    out.push({ ...m, status: m.status as MessageDeliveryStatus });
  }
  return out;
}

function persistMessages(conversationId: string, messages: ChatMessage[]): void {
  void cacheMessages(conversationId, toCacheable(messages));
}

export function useConversationMessages(conversationId: string, currentUserId: string) {
  const [socket] = useState(getSocket);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const messagesRef = useRef<ChatMessage[]>([]);
  const lastReadMessageIdRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  const conversationIdRef = useRef(conversationId);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
    // A new conversation gets a fresh load cycle; never let an in-flight
    // older-history fetch from the previous chat touch this one.
    loadingMoreRef.current = false;
    setIsLoadingMore(false);
  }, [conversationId]);

  // Initial load. Resets state so switching conversations never flashes stale messages.
  // 1. Hydrate from cache first for instant open, 2. then fetch fresh.
  useEffect(() => {
    let cancelled = false;
    lastReadMessageIdRef.current = null;
    setMessages([]);
    setNextCursor(null);
    setError(null);
    setIsLoading(true);

    getCachedMessages(conversationId)
      .then((cached) => {
        if (cancelled || cached.length === 0) return;
        setMessages(sortMessages(cached));
        setIsLoading(false);
      })
      .catch(() => {
        // Cache failures never break the app; the server fetch below still runs.
      });

    // 2. Fetch fresh from the server
    fetchMessageHistory(conversationId, { limit: PAGE_SIZE })
      .then((page) => {
        if (cancelled) return;
        const fresh = sortMessages(page.items);
        setMessages(fresh);
        setNextCursor(page.nextCursor);
        persistMessages(conversationId, fresh);
      })
      .catch((err) => {
        if (!cancelled) {
          // Only show error if we had no cache
          if (messagesRef.current.length === 0) {
            setError(err instanceof Error ? err.message : 'Failed to load');
          }
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, currentUserId, reloadToken]);

  // Live message and status updates.
  useEffect(() => {
    function onNew(payload: { message: Message }) {
      const incoming = payload.message;
      if (incoming.conversationId !== conversationId) return;

      const alreadyKnown = messagesRef.current.some(
        (message) =>
          message.id === incoming.id ||
          (incoming.clientId !== null && message.clientId === incoming.clientId),
      );

      setMessages((prev) => {
        const next = mergeMessages(prev, [incoming]);
        persistMessages(conversationId, next);
        return next;
      });

      // Confirm delivery for messages sent by the other participant.
      if (!alreadyKnown && incoming.senderId !== currentUserId) {
        socket.emit(MESSAGE_EVENTS.new, { message: incoming }, () => {});
      }
    }

    function onStatus(payload: MessageStatusUpdate) {
      if (payload.conversationId !== conversationId) return;
      const affected = new Set(payload.messageIds);
      setMessages((prev) => {
        const next = prev.map((message) => {
          if (!affected.has(message.id)) return message;
          const nextStatus =
            STATUS_RANK[payload.status] > STATUS_RANK[message.status]
              ? payload.status
              : message.status;
          return {
            ...message,
            status: nextStatus,
            deliveredAt:
              payload.status === 'delivered' || payload.status === 'read'
                ? (message.deliveredAt ?? payload.at)
                : message.deliveredAt,
            readAt:
              payload.status === 'read' ? (message.readAt ?? payload.at) : message.readAt,
          };
        });
        persistMessages(conversationId, next);
        return next;
      });
    }

    socket.on(MESSAGE_EVENTS.new, onNew);
    socket.on(MESSAGE_EVENTS.status, onStatus);

    function onEdited(payload: { message: Message }) {
      const incoming = payload.message;
      if (incoming.conversationId !== conversationId) return;
      setMessages((prev) => {
        const next = prev.map((m) => (m.id === incoming.id ? { ...m, ...incoming } : m));
        persistMessages(conversationId, next);
        return next;
      });
    }

    function onDeleted(payload: { message: Message }) {
      const incoming = payload.message;
      if (incoming.conversationId !== conversationId) return;
      setMessages((prev) => {
        const next = prev.map((m) => (m.id === incoming.id ? { ...m, ...incoming } : m));
        persistMessages(conversationId, next);
        return next;
      });
    }

    socket.on(MESSAGE_EVENTS.edited, onEdited);
    socket.on(MESSAGE_EVENTS.deleted, onDeleted);

    function onPlayed(payload: MessagePlayedUpdate) {
      setMessages((prev) => {
        const next = prev.map((m) =>
          m.id === payload.messageId
            ? { ...m, playedAt: m.playedAt ?? payload.playedAt }
            : m,
        );
        persistMessages(conversationId, next);
        return next;
      });
    }

    socket.on(MESSAGE_EVENTS.played, onPlayed);

    return () => {
      socket.off(MESSAGE_EVENTS.new, onNew);
      socket.off(MESSAGE_EVENTS.status, onStatus);
      socket.off(MESSAGE_EVENTS.edited, onEdited);
      socket.off(MESSAGE_EVENTS.deleted, onDeleted);
      socket.off(MESSAGE_EVENTS.played, onPlayed);
    };
  }, [conversationId, currentUserId, socket]);

  // Missed-message recovery: pull everything newer than the newest confirmed
  // message, following the cursor until the server has nothing left.
  const syncMissed = useCallback(async () => {
    const confirmed = messagesRef.current.filter(isConfirmed);
    const newestConfirmed = confirmed.at(-1);
    if (!newestConfirmed) return;

    let afterSequence: string | null = newestConfirmed.sequence;

    for (let round = 0; round < MAX_SYNC_ROUNDS && afterSequence; round += 1) {
      const result = await new Promise<Ack<Page<Message>> | null>((resolve) => {
        socket.emit(
          MESSAGE_EVENTS.sync,
          { conversationId, afterSequence, limit: SYNC_PAGE_LIMIT },
          (response) => resolve(response),
        );
      });

      if (!result || !result.ok || result.data.items.length === 0) return;

      setMessages((prev) => {
        const next = mergeMessages(prev, result.data.items);
        persistMessages(conversationId, next);
        return next;
      });
      afterSequence = result.data.nextCursor;
    }
  }, [conversationId, socket]);

  useEffect(() => {
    function onConnect() {
      void syncMissed();
    }

    socket.on('connect', onConnect);
    if (socket.connected) void syncMissed();

    return () => {
      socket.off('connect', onConnect);
    };
  }, [socket, syncMissed]);

  // Read receipts: only mark as read while the tab is visible, and never
  // re-send the same receipt.
  const markRead = useCallback(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

    const latestIncoming = messagesRef.current.findLast(
      (message) => isConfirmed(message) && message.senderId !== currentUserId,
    );
    if (!latestIncoming) return;
    if (lastReadMessageIdRef.current === latestIncoming.id) return;

    lastReadMessageIdRef.current = latestIncoming.id;
    socket.emit(
      MESSAGE_EVENTS.read,
      { conversationId, upToMessageId: latestIncoming.id },
      (result) => {
        if (!result.ok) lastReadMessageIdRef.current = null;
      },
    );
  }, [conversationId, currentUserId, socket]);

  useEffect(() => {
    if (!isLoading) markRead();
  }, [messages, isLoading, markRead]);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') markRead();
    }

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [markRead]);

  const loadMore = useCallback(async () => {
    // Ref guard (not just state): rapid scroll events + button clicks can
    // otherwise fire duplicate fetches for the same cursor before the
    // re-render flips `isLoadingMore`.
    if (!nextCursor || isLoading || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    const startedFor = conversationId;
    const cursor = nextCursor;
    try {
      const page = await fetchMessageHistory(startedFor, {
        before: cursor,
        limit: PAGE_SIZE,
      });
      // The user may have switched conversations while the fetch was in
      // flight — drop the result instead of merging it into the wrong chat.
      if (conversationIdRef.current !== startedFor) return;
      setMessages((prev) => {
        const next = mergeMessages(prev, page.items);
        persistMessages(startedFor, next);
        return next;
      });
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (err: unknown) {
      if (conversationIdRef.current !== startedFor) return;
      setError(err instanceof Error ? err.message : 'Failed to load earlier messages');
    } finally {
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [conversationId, nextCursor, isLoading]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  const appendOptimistic = useCallback(
    (message: ChatMessage) => {
      setMessages((prev) => mergeMessages(prev, [message]));
    },
    [],
  );

  const replaceOptimistic = useCallback(
    (clientId: string, real: Message) => {
      setMessages((prev) => {
        const next = mergeMessages(
          prev.filter((message) => message.clientId !== clientId),
          [real],
        );
        persistMessages(conversationIdRef.current, next);
        return next;
      });
    },
    [],
  );

  const markFailed = useCallback((clientId: string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.clientId === clientId ? { ...message, status: 'failed' } : message,
      ),
    );
  }, []);

  const editMessageAction = useCallback(
    async (messageId: string, newBody: string) => {
      // Optimistic update
      const previous = messagesRef.current.find((m) => m.id === messageId);
      const cid = conversationIdRef.current;
      setMessages((prev) => {
        const next = prev.map((m) =>
          m.id === messageId
            ? { ...m, body: newBody, editedAt: new Date().toISOString() }
            : m,
        );
        persistMessages(cid, next);
        return next;
      });

      const ack = await editMessageRequest(messageId, newBody);
      if (!ack.ok) {
        // Rollback
        if (previous) {
          setMessages((prev) => {
            const next = prev.map((m) => (m.id === messageId ? previous : m));
            persistMessages(cid, next);
            return next;
          });
        }
        setError(ack.error.message);
      } else {
        persistMessages(cid, messagesRef.current);
      }
    },
    [],
  );

  const deleteMessageAction = useCallback(
    async (messageId: string) => {
      const previous = messagesRef.current.find((m) => m.id === messageId);
      const cid = conversationIdRef.current;
      setMessages((prev) => {
        const next = prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                body: null,
                attachment: null,
                deletedAt: new Date().toISOString(),
              }
            : m,
        );
        persistMessages(cid, next);
        return next;
      });

      const ack = await deleteMessageRequest(messageId);
      if (!ack.ok) {
        if (previous) {
          setMessages((prev) => {
            const next = prev.map((m) => (m.id === messageId ? previous : m));
            persistMessages(cid, next);
            return next;
          });
        }
        setError(ack.error.message);
      } else {
        persistMessages(cid, messagesRef.current);
      }
    },
    [],
  );

  const markPlayedAction = useCallback(
    async (messageId: string) => {
      const previous = messagesRef.current.find((m) => m.id === messageId);
      if (!previous || previous.playedAt || previous.senderId === currentUserId) return;

      const playedAt = new Date().toISOString();
      const cid = conversationIdRef.current;
      setMessages((prev) => {
        const next = prev.map((m) => (m.id === messageId ? { ...m, playedAt } : m));
        persistMessages(cid, next);
        return next;
      });

      const ack = await markPlayedRequest(messageId, conversationId);
      if (!ack.ok) {
        setMessages((prev) => {
          const next = prev.map((m) => (m.id === messageId ? previous : m));
          persistMessages(cid, next);
          return next;
        });
        console.warn('[played] failed', ack.error);
      } else {
        persistMessages(cid, messagesRef.current);
      }
    },
    [conversationId, currentUserId],
  );

  return {
    messages,
    isLoading,
    isLoadingMore,
    error,
    hasMore: nextCursor !== null,
    loadMore,
    reload,
    markRead,
    appendOptimistic,
    replaceOptimistic,
    markFailed,
    editMessage: editMessageAction,
    deleteMessage: deleteMessageAction,
    markPlayed: markPlayedAction,
  };
}