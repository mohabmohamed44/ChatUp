# ChatUp Known Limitations — PWA Push Notifications

See also: [`push-notifications.md`](./push-notifications.md) (architecture),
[`../issues/pwa-notifications.md`](./issues/pwa-notifications.md) (issue record).

## 1. Platform behavior matrix

| Platform            | Foreground (app focused)                              | Background (minimized/closed)                                          | Home Screen install required                    |
| ------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------- |
| Linux Chrome tab    | In-app toast (Socket.IO/FCM `onMessage` path)         | OS notification via service worker                                     | No                                              |
| Linux Chrome PWA    | In-app toast only, no OS banner (correct suppression) | **OS notification** via `alertIncomingMessage` + SW `showNotification` | No (but separate OS permission needed — see §2) |
| Android Chrome PWA  | In-app toast only when genuinely focused              | OS notification                                                        | No                                              |
| iOS Safari tab      | N/A — push unsupported in tabs                        | N/A                                                                    | **Yes (iOS 16.4+)**                             |
| iOS Home Screen PWA | In-app toast only when focused                        | OS notification                                                        | Yes                                             |

**Documented limitation:** iOS Safari tabs cannot receive push notifications at
all. This is an Apple platform restriction (Web Push requires Home Screen
install on iOS 16.4+), not a ChatUp bug. The app renders guidance
("On iPhone, tap Share, then Add to Home Screen…") when push is unsupported.

## 2. PWA install + OS permission setup (Linux)

Chrome tabs and installed PWAs use **different permission scopes**: granting
notification permission in a tab does **not** grant it to the installed PWA —
the OS treats the PWA as a distinct application.

1. Install ChatUp as a PWA (Chrome → ⋮ → Save and share → Install, or the
   in-app install prompt).
2. Open the installed PWA and grant the notification permission when prompted
   (the "Enable notifications" banner calls `Notification.requestPermission()`
   from a user gesture, which iOS/Android require).
3. Sanity-check the OS path from the PWA's DevTools console:
   ```javascript
   new Notification('Test', { body: 'OS permission check' });
   ```
4. If nothing appears, open **System Settings → Notifications → ChatUp** and
   enable it. If ChatUp is not listed, uninstall the PWA
   (`chrome://apps` → right-click → Remove) and reinstall, granting the OS
   permission when prompted.
5. GNOME setting: **Settings → Notifications → ChatUp → Show Message Content
   in Popups → ON**, otherwise notifications may arrive without body text.

## 3. Implementation notes (the `visibilityState` fix)

- Both foreground alert paths (FCM `onMessage` in `(app)/layout.tsx` and the
  socket `message:new` path in `useIncomingMessageAlerts.ts`) funnel through
  one helper: `alertIncomingMessage`
  (`apps/web/src/features/notifications/lib/alertIncomingMessage.ts`),
  deduped by message id.
- The helper treats the page as visible only when
  `document.visibilityState === 'visible' && document.hasFocus()`. Hidden,
  minimized, unfocused, or locked-screen pages fall through to
  `registration.showNotification(...)` (tag = conversation id, so rapid
  messages collapse instead of stacking), which is what fixes the
  minimized-PWA case where Firebase's foreground heuristic fires
  `onMessage` instead of `onBackgroundMessage`.
- `sw.js` (generated from `apps/web/scripts/sw.template.js`) must keep:
  - **No raw `push` listener** — the Firebase SDK owns the `push` event; a
    second handler races `onBackgroundMessage` and produces generic or
    duplicate notifications.
  - **Fetch early-return** for `/socket.io/` and `/api/` so realtime and API
    traffic are never intercepted.
- Registration uses the custom worker: `register(messaging, { vapidKey,
serviceWorkerRegistration })` with `/sw.js` (FID-based `fid` upload via
  `PATCH /auth/profile`), equivalent to the `getToken(..., {
serviceWorkerRegistration })` pattern.
