import { isPageTrulyVisible } from './pageVisibility';

export interface IncomingMessageAlert {
  messageId?: string;
  conversationId?: string;
  title: string;
  body?: string;
  /** Conversation the user is currently looking at (from your router/state). */
  activeConversationId?: string | null;
  /** Your toast implementation (sonner, react-hot-toast, shadcn, custom...). */
  showToast: (t: { title: string; body?: string; conversationId?: string }) => void;
}

const seen = new Set<string>();

/** DOM lib lags the Notifications spec: `renotify` is valid at runtime. */
interface ShowNotificationOptions extends NotificationOptions {
  renotify?: boolean;
}

// Collapsed-tray counter per conversation. The OS notification reuses one
// `tag` per conversation (so the tray doesn't spam), which means follow-up
// messages silently replace the first banner unless we re-alert (renotify)
// and show the count in the body.
const unseenByConversation = new Map<string, number>();

/** Reset the collapsed-tray counter (call when the user opens the conversation). */
export function resetAlertCount(conversationId?: string | null): void {
  if (!conversationId) return;
  unseenByConversation.delete(conversationId);
}

function remember(id: string): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > 200) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  return true;
}

export async function alertIncomingMessage(a: IncomingMessageAlert): Promise<void> {
  if (typeof window === 'undefined') return;
  if (a.messageId && !remember(a.messageId)) return; // already alerted

  // True-visibility (not just the getter): a minimized Linux PWA can report
  // visible + focused, in which case a blur event newer than the last focus
  // flips this to hidden and the OS branch below runs. See pageVisibility.ts.
  const pageVisible = isPageTrulyVisible();

  if (pageVisible) {
    if (a.conversationId && a.conversationId === a.activeConversationId) {
      // User is looking at this chat: inline render covers it, counter restarts.
      resetAlertCount(a.conversationId);
      return;
    }
    a.showToast({ title: a.title, body: a.body, conversationId: a.conversationId });
    return;
  }

  // Page is hidden/unfocused: show an OS-level notification via the service worker.
  if (
    'Notification' in window &&
    Notification.permission === 'granted' &&
    'serviceWorker' in navigator
  ) {
    try {
      const reg = await navigator.serviceWorker.ready;
      // Collapse per conversation (one tray slot) but re-alert every message:
      // without `renotify`, same-tag replacements on Android/Windows are
      // silent — only the first banner buzzes and follow-ups look "missing".
      const unseen = (a.conversationId && unseenByConversation.get(a.conversationId)) || 0;
      const count = unseen + 1;
      if (a.conversationId) unseenByConversation.set(a.conversationId, count);
      const body = count > 1 && a.body ? `${a.body} • ${count} new messages` : (a.body ?? '');
      const options: ShowNotificationOptions = {
        body,
        icon: '/icons/192.png',
        badge: '/icons/192.png',
        tag: a.conversationId ?? a.messageId, // one slot per chat, falls back to per-message
        renotify: true,
        data: { conversationId: a.conversationId, messageId: a.messageId },
      };
      await reg.showNotification(a.title, options);
    } catch (err) {
      console.warn('Could not show notification', err);
    }
  }
}
