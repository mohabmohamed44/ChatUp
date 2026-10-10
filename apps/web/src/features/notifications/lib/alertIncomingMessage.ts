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
  
    const pageVisible = document.visibilityState === 'visible' && document.hasFocus();
  
    if (pageVisible) {
      if (a.conversationId && a.conversationId === a.activeConversationId) return;
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
        await reg.showNotification(a.title, {
          body: a.body ?? '',
          icon: '/icons/192.png',
          badge: '/icons/192.png',
          tag: a.conversationId, // collapses repeated messages from one chat
          data: { conversationId: a.conversationId },
        });
      } catch (err) {
        console.warn('Could not show notification', err);
      }
    }
  }