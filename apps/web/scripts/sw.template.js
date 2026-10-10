// apps/web/scripts/sw.template.js
//
// TEMPLATE — do not edit public/sw.js directly. It is generated at dev/build
// time by scripts/generate-sw.mjs from this template + env vars, because a
// service worker cannot read process.env / .env files (it is served as a
// static file and runs outside the Next.js build pipeline).

// ---------------------------------------------------------------------------
// 0. Notification click. Registered FIRST so it runs before the Firebase SDK's
//    own handler (which would otherwise swallow the event).
// ---------------------------------------------------------------------------
self.addEventListener('notificationclick', (event) => {
  event.stopImmediatePropagation();
  event.notification.close();

  const d = event.notification.data || {};
  const conversationId =
    d.conversationId ?? (d.FCM_MSG && d.FCM_MSG.data && d.FCM_MSG.data.conversationId);
  const path = conversationId ? `/conversations/${conversationId}` : '/';
  const targetUrl = new URL(path, self.location.origin).href;

  event.waitUntil(
    Promise.all([
      ackPush(d, 'clicked'),
      (async () => {
      const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = windowClients.find((c) => 'focus' in c);
      if (client) {
        try {
          await client.navigate(targetUrl);
        } catch (_) {
          /* navigate can fail for uncontrolled clients; focusing is still fine */
        }
        return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
      })(),
    ])
  );
});

// ---------------------------------------------------------------------------
// 0b. Push acknowledgement beacon. Reports back to the server that a
//     notification was displayed/clicked (observability beyond FCM accept).
//     Fire-and-forget with keepalive so it survives worker shutdown. The
//     endpoint accepts GET because a worker cannot read the CSRF cookie that
//     POST requires; the session cookie still authenticates the call.
// ---------------------------------------------------------------------------
function pushAckData(data) {
  if (!data) return null;
  if (data.messageId) return data;
  if (data.FCM_MSG && data.FCM_MSG.data) return data.FCM_MSG.data;
  return null;
}

function ackPush(data, status) {
  try {
    const d = pushAckData(data);
    if (!d || !d.messageId) return Promise.resolve();
    const url =
      '/api/notifications/push-ack?messageId=' +
      encodeURIComponent(d.messageId) +
      '&status=' +
      status;
    return fetch(url, { method: 'GET', keepalive: true }).catch(() => {});
  } catch (_) {
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// 1. Firebase background messaging
// ---------------------------------------------------------------------------
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: '__FIREBASE_API_KEY__',
  authDomain: '__FIREBASE_AUTH_DOMAIN__',
  projectId: '__FIREBASE_PROJECT_ID__',
  storageBucket: '__FIREBASE_STORAGE_BUCKET__',
  messagingSenderId: '__FIREBASE_MESSAGING_SENDER_ID__',
  appId: '__FIREBASE_APP_ID__',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = (payload && payload.data) || {};
  const notif = (payload && payload.notification) || {};
  // Server sends camelCase (senderId/senderName); accept snake_case too.
  // notification.title is already the sender's displayName (see queue.ts).
  const senderName =
    data.senderName || data.sender_name || (notif.title && notif.title.trim()) || '';
  const senderId = data.senderId || data.sender_id || '';

  console.log(`الإشعار مبعوث من: ${senderName} (ID: ${senderId})`);

  // NOTE (web): unlike Android, the browser does NOT auto-display a
  // notification when `notification` is present — the worker MUST call
  // showNotification itself, for every payload shape. The old
  // `if (!payload.notification)` guard meant the Firebase handler (the only
  // one that parses the sender) never displayed anything for real pushes,
  // leaving only the raw `push` listener below, which parsed the FCM
  // envelope with the wrong field names and fell back to generic text.
  const notificationTitle = senderName ? `رسالة من ${senderName}` : notif.title || 'New message';
  const notificationBody = notif.body || data.body || data.preview || '';

  // showNotification returns a promise but onBackgroundMessage is not an
  // ExtendableEvent — fire-and-forget is fine; keepalive covers the ack.
  void self.registration.showNotification(notificationTitle, {
    body: notificationBody,
    icon: '/icons/192.png',
    badge: '/icons/192.png',
    tag: data.conversationId || undefined,
    data: {
      conversationId: data.conversationId,
      messageId: data.messageId,
      senderId: senderId,
      senderName: senderName,
    },
  });
  // Confirm display. Fire-and-forget: there is no ExtendableEvent here,
  // keepalive keeps the beacon alive.
  void ackPush(payload.data, 'displayed');
});

// ---------------------------------------------------------------------------
// 2. App shell caching
// ---------------------------------------------------------------------------
const CACHE_NAME = 'chatup-shell-v2';
const SHELL_ASSETS = ['/', '/login', '/register', '/offline', '/no-connection.svg'];

self.addEventListener('install', (event) => {
  // allSettled: one missing URL must NOT fail the whole install, otherwise the
  // worker never activates and push never works.
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

// NOTE: no raw `self.addEventListener('push', ...)` here on purpose. The
// Firebase SDK owns the `push` event; a second handler would race with
// onBackgroundMessage and parse the FCM envelope with the wrong field names
// (`payload.title` instead of `payload.notification.title`), producing a
// generic "ChatUp / You have a new message" notification (or a duplicate).


self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept Socket.IO or API calls
  if (url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/api/')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline')));
  }
});
