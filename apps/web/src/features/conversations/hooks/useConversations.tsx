'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { ConversationSummary } from '@chatup/shared';
import { getSocket } from '@/shared/lib/socket';
import { listConversations } from '../api';

export interface ConversationsValue {
  conversations: ConversationSummary[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const ConversationsContext = createContext<ConversationsValue | null>(null);

function useConversationsState(): ConversationsValue {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const { conversations: next } = await listConversations();
      setConversations(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    const socket = getSocket();

    function upsert(payload: { conversation: ConversationSummary }) {
      setConversations((prev) => {
        const index = prev.findIndex((item) => item.id === payload.conversation.id);
        const next =
          index >= 0
            ? prev.map((item) =>
                item.id === payload.conversation.id ? payload.conversation : item,
              )
            : [payload.conversation, ...prev];
        return [...next].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
      });
    }

    socket.on('conversation:created', upsert);
    socket.on('conversation:updated', upsert);

    return () => {
      socket.off('conversation:created', upsert);
      socket.off('conversation:updated', upsert);
    };
  }, []);

  return { conversations, isLoading, error, refetch };
}

export function ConversationsProvider({ children }: { children: ReactNode }) {
  const value = useConversationsState();
  return <ConversationsContext.Provider value={value}>{children}</ConversationsContext.Provider>;
}

export function useConversations(): ConversationsValue {
  const context = useContext(ConversationsContext);
  if (!context) {
    throw new Error('useConversations must be used within a ConversationsProvider');
  }
  return context;
}
