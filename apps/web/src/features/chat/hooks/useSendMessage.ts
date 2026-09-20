'use client';

import { useCallback } from 'react';
import {
  MESSAGE_EVENTS,
  type Attachment,
  type Message,
  type SendMessagePayload,
} from '@chatup/shared';
import { getSocket } from '@/shared/lib/socket';
import type { ChatMessage } from './useConversationMessages';

/**
 * What a caller can send. The composer produces text and image today;
 * voice is added tomorrow with the same shape.
 */
export type SendInput =
  | { kind: 'text'; body: string }
  | { kind: 'image'; attachmentId: string; localPreviewUrl?: string }
  | { kind: 'audio'; attachmentId: string; durationMs: number };

type Ack =
  | { ok: true; data: Message }
  | { ok: false; error: { code: string; message: string } };

/**
 * Builds a placeholder Attachment for the optimistic message so the image
 * preview renders instantly. The real signed URL arrives with the server ack
 * and replaces this whole message.
 */
function toOptimisticAttachment(input: SendInput): Attachment | null {
  if (input.kind === 'image' && input.localPreviewUrl) {
    return {
      id: input.attachmentId,
      kind: 'image',
      mimeType: '',
      sizeBytes: 0,
      url: input.localPreviewUrl,
      width: null,
      height: null,
      durationMs: null,
    };
  }
  return null;
}

/**
 * Maps the client-side input to the exact socket payload the backend expects.
 */
function toPayload(
  input: SendInput,
  conversationId: string,
  clientId: string,
): SendMessagePayload {
  if (input.kind === 'text') {
    return { conversationId, clientId, kind: 'text', body: input.body };
  }
  if (input.kind === 'image') {
    return {
      conversationId,
      clientId,
      kind: 'image',
      attachmentId: input.attachmentId,
    };
  }
  return {
    conversationId,
    clientId,
    kind: 'audio',
    attachmentId: input.attachmentId,
    durationMs: input.durationMs,
  };
}

/**
 * Sends a message optimistically. Pass `retryClientId` to retry a failed send:
 * reusing the clientId keeps the server write idempotent, so a retry can never
 * create a duplicate message.
 */
export function useSendMessage(
  conversationId: string,
  currentUserId: string,
  onOptimistic: (message: ChatMessage) => void,
  onReplaced: (clientId: string, real: Message) => void,
  onFailed: (clientId: string) => void,
) {
  return useCallback(
    (input: SendInput, retryClientId?: string) => {
      const socket = getSocket();
      const clientId = retryClientId ?? crypto.randomUUID();

      const optimistic: ChatMessage = {
        id: clientId,
        sequence: '0',
        conversationId,
        senderId: currentUserId,
        kind: input.kind,
        body: input.kind === 'text' ? input.body : null,
        attachment: toOptimisticAttachment(input),
        status: 'pending',
        clientId,
        createdAt: new Date().toISOString(),
      };

      onOptimistic(optimistic);

      const payload = toPayload(input, conversationId, clientId);

      socket.emit(MESSAGE_EVENTS.send, payload, (ack: Ack) => {
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