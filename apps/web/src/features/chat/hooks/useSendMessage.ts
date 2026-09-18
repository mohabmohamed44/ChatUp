'use client';

import { useCallback } from 'react';
import type { Message, SendMessagePayload } from '@chatup/shared';
import { getSocket } from '@/shared/lib/socket';
import type { ChatMessage } from './useConversationMessages';

type Ack =
  | { ok: true; data: Message }
  | { ok: false; error: { code: string; message: string } };

/**
 * Sends a text message optimistically. Pass `retryClientId` to retry a failed
 * send: reusing the clientId keeps the server write idempotent, so a retry can
 * never create a duplicate message.
 */
export function useSendMessage(
  conversationId: string,
  currentUserId: string,
  onOptimistic: (message: ChatMessage) => void,
  onReplaced: (clientId: string, real: Message) => void,
  onFailed: (clientId: string) => void,
) {
  return useCallback(
    (body: string, retryClientId?: string) => {
      const socket = getSocket();
      const clientId = retryClientId ?? crypto.randomUUID();

      const optimistic: ChatMessage = {
        id: clientId,
        sequence: '0',
        conversationId,
        senderId: currentUserId,
        kind: 'text',
        body,
        attachment: null,
        status: 'pending',
        clientId,
        createdAt: new Date().toISOString(),
      };

      onOptimistic(optimistic);

      const payload: SendMessagePayload = {
        conversationId,
        clientId,
        kind: 'text',
        body,
      };

      socket.emit('message:send', payload, (ack: Ack) => {
        if (ack.ok) {
          onReplaced(clientId, ack.data);
        } else {
          onFailed(clientId);
        }
      });
    },
    [conversationId, currentUserId, onOptimistic, onReplaced, onFailed],
  );
}
