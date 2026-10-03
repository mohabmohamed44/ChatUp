'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MESSAGE_EVENTS,
  type Ack,
  type ClientMessageStatus,
  type Message,
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

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Initial load. Resets state so switching conversations never flashes stale messages.
  useEffect(() => {
    let cancelled = false;
    lastReadMessageIdRef.current = null;
    setMessages([]);
    setNextCursor(null);
    setError(null);
    setIsLoading(true);

    fetchMessageHistory(conversationId, { limit: PAGE_SIZE })
      .then((page) => {
        if (cancelled) return;
        setMessages(sortMessages(page.items));
        setNextCursor(page.nextCursor);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load messages');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, reloadToken]);

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

      setMessages((prev) => mergeMessages(prev, [incoming]));

      // Confirm delivery for messages sent by the other participant.
      if (!alreadyKnown && incoming.senderId !== currentUserId) {
        socket.emit(MESSAGE_EVENTS.new, { message: incoming }, () => {});
      }
    }

    function onStatus(payload: MessageStatusUpdate) {
      if (payload.conversationId !== conversationId) return;
      const affected = new Set(payload.messageIds);
      setMessages((prev) =>
        prev.map((message) => {
          if (!affected.has(message.id)) return message;
          if (STATUS_RANK[payload.status] <= STATUS_RANK[message.status]) return message;
          return { ...message, status: payload.status };
        }),
      );
    }

    socket.on(MESSAGE_EVENTS.new, onNew);
    socket.on(MESSAGE_EVENTS.status, onStatus);

    function onEdited(payload: { message: Message }) {
      const incoming = payload.message;
      if (incoming.conversationId !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === incoming.id ? { ...m, ...incoming } : m)),
      );
    }

    function onDeleted(payload: { message: Message }) {
      const incoming = payload.message;
      if (incoming.conversationId !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === incoming.id ? { ...m, ...incoming } : m)),
      );
    }

    socket.on(MESSAGE_EVENTS.edited, onEdited);
    socket.on(MESSAGE_EVENTS.deleted, onDeleted);

    function onPlayed(payload: MessagePlayedUpdate) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === payload.messageId ? { ...m, playedAt: payload.playedAt } : m,
        ),
      );
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

      setMessages((prev) => mergeMessages(prev, result.data.items));
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
    if (!nextCursor || isLoading || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const page = await fetchMessageHistory(conversationId, {
        before: nextCursor,
        limit: PAGE_SIZE,
      });
      setMessages((prev) => mergeMessages(prev, page.items));
      setNextCursor(page.nextCursor);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load earlier messages');
    } finally {
      setIsLoadingMore(false);
    }
  }, [conversationId, nextCursor, isLoading, isLoadingMore]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  const appendOptimistic = useCallback((message: ChatMessage) => {
    setMessages((prev) => mergeMessages(prev, [message]));
  }, []);

  const replaceOptimistic = useCallback((clientId: string, real: Message) => {
    setMessages((prev) =>
      mergeMessages(
        prev.filter((message) => message.clientId !== clientId),
        [real],
      ),
    );
  }, []);

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
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, body: newBody, editedAt: new Date().toISOString() }
            : m,
        ),
      );

      const ack = await editMessageRequest(messageId, newBody);
      if (!ack.ok) {
        // Rollback
        if (previous) {
          setMessages((prev) =>
            prev.map((m) => (m.id === messageId ? previous : m)),
          );
        }
        setError(ack.error.message);
      }
    },
    [],
  );

  const deleteMessageAction = useCallback(
    async (messageId: string) => {
      const previous = messagesRef.current.find((m) => m.id === messageId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                body: null,
                attachment: null,
                deletedAt: new Date().toISOString(),
              }
            : m,
        ),
      );

      const ack = await deleteMessageRequest(messageId);
      if (!ack.ok) {
        if (previous) {
          setMessages((prev) =>
            prev.map((m) => (m.id === messageId ? previous : m)),
          );
        }
        setError(ack.error.message);
      }
    },
    [],
  );

  const markPlayedAction = useCallback(
    async (messageId: string) => {
      const ack = await markPlayedRequest(messageId, conversationId);
      if (!ack.ok) {
        // silent: played tracking is best-effort
        console.warn('[played] failed', ack.error);
      }
    },
    [conversationId],
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