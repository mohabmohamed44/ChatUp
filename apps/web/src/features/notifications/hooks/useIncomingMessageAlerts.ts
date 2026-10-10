'use client';

import { useEffect } from 'react';
import { MESSAGE_EVENTS, type Message } from '@chatup/shared';
import { getSocket } from '@/shared/lib/socket';
import { alertIncomingMessage } from '../lib/alertIncomingMessage';

interface UseIncomingMessageAlertsOptions {
  currentUserId: string | null | undefined;
  activeConversationId?: string | null;
  showToast: (message: string, options?: { variant?: 'success' | 'error' | 'info' | 'warning'; duration?: number; onClick?: () => void }) => void;
  onOpenConversation?: (conversationId: string) => void;
}

function previewFor(message: Message): string {
  if (message.deletedAt) return 'Message deleted';
  if (message.kind === 'text') return message.body?.slice(0, 160) || 'New message';
  return `[${message.kind}]`;
}

/**
 * Global socket alert path. The server intentionally skips FCM push for
 * online users, so a tab that is open but hidden/unfocused would otherwise
 * stay silent. This hook covers that case:
 * - focused tab, other conversation -> in-app toast
 * - hidden/minimized/unfocused tab -> OS notification via service worker
 * Already-open conversation is skipped (messages render inline).
 * Deduped by message id with the FCM foreground path.
 */
export function useIncomingMessageAlerts({
  currentUserId,
  activeConversationId,
  showToast,
  onOpenConversation,
}: UseIncomingMessageAlertsOptions) {
  useEffect(() => {
    if (!currentUserId) return;
    const socket = getSocket();

    function onNew(payload: { message: Message; senderName?: string }) {
      const message = payload.message;
      if (!message || message.senderId === currentUserId) return;
      const senderName = payload.senderName?.trim() || '';

      void alertIncomingMessage({
        messageId: message.id,
        conversationId: message.conversationId,
        title: senderName ? `Message from: ${senderName}` : 'New message',
        body: previewFor(message),
        activeConversationId,
        showToast: ({ title, body, conversationId }) => {
          const text = body ? `${title}: ${body}` : title;
          showToast(text, {
            variant: 'info',
            duration: 4000,
            ...(conversationId && onOpenConversation
              ? { onClick: () => onOpenConversation(conversationId) }
              : {}),
          });
        },
      });
    }

    socket.on(MESSAGE_EVENTS.new, onNew);
    return () => {
      socket.off(MESSAGE_EVENTS.new, onNew);
    };
  }, [currentUserId, activeConversationId, showToast, onOpenConversation]);
}
