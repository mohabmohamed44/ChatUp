'use client';

import { useCallback, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { MessagePayload } from 'firebase/messaging';
import { useAuth } from '@/features/auth';
import { useFcmToken } from '@/features/notifications/hooks/useFcmToken';
import { useIncomingMessageAlerts } from '@/features/notifications/hooks/useIncomingMessageAlerts';
import { alertIncomingMessage } from '@/features/notifications/lib/alertIncomingMessage';
import { useToast } from '@/shared/providers/ToastProvider';
import { InstallPrompt } from '@/shared/components/InstallPrompt';

/**
 * Registers for push + shows foreground messages as in-app toasts.
 * Rendered only for logged-in users so guests never get a permission prompt.
 *
 * Two alert paths share alertIncomingMessage (deduped by message id):
 * - socket (online users, including hidden tabs): see useIncomingMessageAlerts
 * - FCM onMessage (foreground push, mostly offline->online transitions)
 */
function PushNotifications({ currentUserId }: { currentUserId: string }) {
  const { showToast } = useToast();
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const viewingConversationId = params?.id;

  const openConversation = useCallback(
    (conversationId: string) => router.push(`/conversations/${conversationId}`),
    [router],
  );

  useIncomingMessageAlerts({
    currentUserId,
    activeConversationId: viewingConversationId,
    showToast,
    onOpenConversation: openConversation,
  });

  const handleForegroundMessage = useCallback(
    (payload: MessagePayload) => {
      const toast = ({ title, body, conversationId }: { title: string; body?: string; conversationId?: string }) => {
        const message = body ? `${title}: ${body}` : title;
        showToast(message, {
          variant: 'info',
          duration: 4000,
          ...(conversationId ? { onClick: () => openConversation(conversationId) } : {}),
        });
      };

      void alertIncomingMessage({
        messageId: payload.data?.messageId,
        conversationId: payload.data?.conversationId,
        title:
          payload.data?.senderName?.trim()
            ? `Message from: ${payload.data.senderName.trim()}`
            : payload.notification?.title?.trim() || payload.data?.title?.trim() || 'New message',
        body: payload.notification?.body?.trim() ?? payload.data?.body?.trim(),
        activeConversationId: viewingConversationId,
        showToast: toast,
      });
    },
    [showToast, openConversation, viewingConversationId],
  );

  const { permission, supported, enable } = useFcmToken({
    onForegroundMessage: handleForegroundMessage,
  });

  return (
    <>
      {/* iOS/Android require permission from a user gesture, so this banner
          is the only place requestPermission() is triggered (via enable). */}
      {supported && permission === 'default' && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-lg bg-slate-900 px-4 py-3 text-white shadow-lg">
            <p className="text-sm">Get notified about new messages</p>
            <button
              type="button"
              onClick={() => void enable()}
              className="rounded bg-white px-3 py-1 text-sm font-medium text-slate-900"
            >
              Enable notifications
            </button>
          </div>
        </div>
      )}
      {supported && permission === 'denied' && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <p className="max-w-sm rounded-lg bg-slate-900 px-4 py-3 text-center text-xs text-white shadow-lg">
            Notifications are blocked. Re-enable them in your browser or phone
            settings to get new-message alerts.
          </p>
        </div>
      )}
      {!supported && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <p className="max-w-sm rounded-lg bg-slate-900 px-4 py-3 text-center text-xs text-white shadow-lg">
            On iPhone, tap Share, then Add to Home Screen, then open chatUp from
            the Home Screen to enable notifications.
          </p>
        </div>
      )}
    </>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-sm opacity-60">Loading…</p>
      </div>
    );
  }

  if (!user) return null;

  return (
    <>
      <PushNotifications currentUserId={user.id} />
      <InstallPrompt />
      {children}
    </>
  );
}
